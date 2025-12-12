# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate, add_days, today

from flexitime.tests.test_utils import (
	create_test_employee,
	create_test_work_pattern,
	create_test_presence_types,
	create_test_roll_call_entry,
	create_test_weekly_entry,
	get_test_monday,
	cleanup_test_data
)


class TestWeeklyEntry(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Weekly Entry Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		# Clean up entries before each test
		frappe.db.sql("""
			DELETE FROM `tabWeekly Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_create_weekly_entry(self):
		"""Test basic Weekly Entry creation"""
		monday = get_test_monday()

		entry = create_test_weekly_entry(self.employee.name, monday)

		self.assertEqual(entry.employee, self.employee.name)
		self.assertEqual(str(entry.week_start), str(monday))
		self.assertEqual(str(entry.week_end), str(add_days(monday, 6)))
		self.assertEqual(len(entry.daily_entries), 7)

	def test_week_start_must_be_monday(self):
		"""Test that week_start must be a Monday"""
		tuesday = add_days(get_test_monday(), 1)

		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Weekly Entry",
				"employee": self.employee.name,
				"week_start": tuesday
			}).insert()

	def test_week_end_auto_calculated(self):
		"""Test that week_end is auto-calculated from week_start"""
		monday = get_test_monday()

		doc = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": monday
		})

		# Add daily entries
		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
		for i in range(7):
			doc.append("daily_entries", {
				"date": add_days(monday, i),
				"day_of_week": days[i],
				"expected_hours": 8 if i < 5 else 0,
				"actual_hours": 8 if i < 5 else 0
			})

		doc.insert()

		self.assertEqual(str(doc.week_end), str(add_days(monday, 6)))

	def test_totals_calculation(self):
		"""Test that totals are correctly calculated"""
		monday = get_test_monday()

		doc = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": monday
		})

		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
		for i in range(7):
			expected = 8 if i < 5 else 0  # 8 hours Mon-Fri
			actual = 9 if i < 5 else 0    # 9 hours Mon-Fri (1 hour overtime each day)
			doc.append("daily_entries", {
				"date": add_days(monday, i),
				"day_of_week": days[i],
				"expected_hours": expected,
				"actual_hours": actual
			})

		doc.insert()

		# Check calculations
		self.assertEqual(doc.total_expected_hours, 40)  # 5 days * 8 hours
		self.assertEqual(doc.total_actual_hours, 45)    # 5 days * 9 hours
		self.assertEqual(doc.weekly_delta, 5)           # 45 - 40 = 5 hours overtime

	def test_daily_entry_difference_calculation(self):
		"""Test that daily entry difference is calculated"""
		monday = get_test_monday()

		doc = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": monday
		})

		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
		for i in range(7):
			doc.append("daily_entries", {
				"date": add_days(monday, i),
				"day_of_week": days[i],
				"expected_hours": 8 if i < 5 else 0,
				"actual_hours": 10 if i == 0 else (8 if i < 5 else 0)  # 10 hours on Monday
			})

		doc.insert()

		# Monday should have +2 difference
		monday_entry = doc.daily_entries[0]
		self.assertEqual(monday_entry.difference, 2)

	def test_running_balance_calculation(self):
		"""Test running balance calculation from previous weeks"""
		monday = get_test_monday(-1)  # Previous week
		current_monday = get_test_monday()

		# Create previous week entry with +5 delta
		prev_entry = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": monday
		})

		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
		for i in range(7):
			prev_entry.append("daily_entries", {
				"date": add_days(monday, i),
				"day_of_week": days[i],
				"expected_hours": 8 if i < 5 else 0,
				"actual_hours": 9 if i < 5 else 0  # +1 hour each day
			})

		prev_entry.insert()
		prev_entry.submit()

		self.assertEqual(prev_entry.weekly_delta, 5)
		self.assertEqual(prev_entry.running_balance, 5)

		# Create current week entry
		curr_entry = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": current_monday
		})

		for i in range(7):
			curr_entry.append("daily_entries", {
				"date": add_days(current_monday, i),
				"day_of_week": days[i],
				"expected_hours": 8 if i < 5 else 0,
				"actual_hours": 7 if i < 5 else 0  # -1 hour each day
			})

		curr_entry.insert()

		# Current week should show previous balance of 5
		self.assertEqual(curr_entry.previous_balance, 5)
		self.assertEqual(curr_entry.weekly_delta, -5)
		self.assertEqual(curr_entry.running_balance, 0)  # 5 + (-5) = 0

	def test_sync_roll_call_entries(self):
		"""Test that Weekly Entry syncs from Roll Call"""
		monday = get_test_monday()

		# Create roll call entries
		create_test_roll_call_entry(self.employee.name, monday, "office")
		create_test_roll_call_entry(self.employee.name, add_days(monday, 1), "home")
		create_test_roll_call_entry(self.employee.name, add_days(monday, 2), "vacation", source="Leave")

		# Create weekly entry
		entry = create_test_weekly_entry(self.employee.name, monday)

		# Check that presence types were synced
		self.assertEqual(entry.daily_entries[0].presence_type, "office")
		self.assertEqual(entry.daily_entries[1].presence_type, "home")
		self.assertEqual(entry.daily_entries[2].presence_type, "vacation")

	def test_submit_updates_employee_balance(self):
		"""Test that submitting updates employee's flexitime balance"""
		monday = get_test_monday()

		doc = frappe.get_doc({
			"doctype": "Weekly Entry",
			"employee": self.employee.name,
			"week_start": monday
		})

		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
		for i in range(7):
			doc.append("daily_entries", {
				"date": add_days(monday, i),
				"day_of_week": days[i],
				"expected_hours": 8 if i < 5 else 0,
				"actual_hours": 10 if i < 5 else 0  # +2 hours each day
			})

		doc.insert()
		doc.submit()

		# Check employee balance was updated
		balance = frappe.db.get_value("Employee", self.employee.name, "custom_flexitime_balance")
		self.assertEqual(balance, 10)  # +2 * 5 days = +10

	def test_locked_entry_cannot_be_edited(self):
		"""Test that locked entries cannot be edited"""
		monday = get_test_monday()

		entry = create_test_weekly_entry(self.employee.name, monday, submit=True)
		entry.db_set("is_locked", 1)
		entry.reload()

		# Try to edit
		frappe.set_user("test@example.com")  # Non-HR user

		with self.assertRaises(frappe.ValidationError):
			entry.daily_entries[0].actual_hours = 99
			entry.save()

		frappe.set_user("Administrator")

	def test_get_week_data_api(self):
		"""Test the get_week_data API endpoint"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import get_week_data

		monday = get_test_monday()

		# Create some roll call entries
		create_test_roll_call_entry(self.employee.name, monday, "office")
		create_test_roll_call_entry(self.employee.name, add_days(monday, 1), "home")

		result = get_week_data(self.employee.name, str(monday))

		self.assertIn("days", result)
		self.assertIn("previous_balance", result)
		self.assertEqual(len(result["days"]), 7)

		# Check first day (Monday)
		self.assertEqual(result["days"][0]["day_of_week"], "Monday")
		self.assertEqual(result["days"][0]["presence_type"], "office")

	def test_create_weekly_entry_api(self):
		"""Test the create_weekly_entry API endpoint"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import create_weekly_entry

		monday = get_test_monday()

		entry_name = create_weekly_entry(self.employee.name, str(monday))

		entry = frappe.get_doc("Weekly Entry", entry_name)
		self.assertEqual(len(entry.daily_entries), 7)
		self.assertEqual(str(entry.week_start), str(monday))

	def test_create_weekly_entry_returns_existing(self):
		"""Test that create_weekly_entry returns existing entry if one exists"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import create_weekly_entry

		monday = get_test_monday()

		# Create first entry
		first_name = create_weekly_entry(self.employee.name, str(monday))

		# Try to create again - should return same entry
		second_name = create_weekly_entry(self.employee.name, str(monday))

		self.assertEqual(first_name, second_name)


class TestWeeklyEntryExpectedHours(IntegrationTestCase):
	"""Test expected hours calculation based on presence types"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Expected Hours Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		frappe.db.sql("""
			DELETE FROM `tabWeekly Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_system_type_expected_zero(self):
		"""Test that system types (weekend, holiday) have 0 expected hours"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Weekend type should be 0
		expected = calculate_expected_hours(self.employee.name, add_days(monday, 5), "weekend")
		self.assertEqual(expected, 0)

		# Holiday type should be 0
		expected = calculate_expected_hours(self.employee.name, monday, "holiday")
		self.assertEqual(expected, 0)

	def test_working_type_uses_pattern_hours(self):
		"""Test that working types use hours from work pattern"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Office on Monday should use work pattern hours (8)
		expected = calculate_expected_hours(self.employee.name, monday, "office")
		self.assertEqual(expected, 8)

	def test_regular_leave_expected_zero(self):
		"""Test that regular leave types have 0 expected hours (neutral balance)"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Vacation should be 0 (neutral)
		expected = calculate_expected_hours(self.employee.name, monday, "vacation")
		self.assertEqual(expected, 0)

		# Sick should be 0 (neutral)
		expected = calculate_expected_hours(self.employee.name, monday, "sick")
		self.assertEqual(expected, 0)

	def test_flex_off_uses_pattern_hours(self):
		"""Test that flex_off uses pattern hours (deducts from balance)"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Flex off should use pattern hours (deducts from balance)
		expected = calculate_expected_hours(self.employee.name, monday, "flex_off")
		self.assertEqual(expected, 8)

	def test_half_day_leave_halves_hours(self):
		"""Test that half-day leave halves the expected hours"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Half-day vacation should be half of pattern hours
		expected = calculate_expected_hours(self.employee.name, monday, "vacation", is_half_day=True)
		self.assertEqual(expected, 4)  # 8 / 2 = 4

	def test_half_day_flex_off_halves_hours(self):
		"""Test that half-day flex_off halves the expected hours"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		# Half-day flex_off should be half of pattern hours
		expected = calculate_expected_hours(self.employee.name, monday, "flex_off", is_half_day=True)
		self.assertEqual(expected, 4)  # 8 / 2 = 4

	def test_no_presence_type_returns_zero(self):
		"""Test that None presence type returns 0"""
		from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

		monday = get_test_monday()

		expected = calculate_expected_hours(self.employee.name, monday, None)
		self.assertEqual(expected, 0)


class TestWeeklyExpectedHoursWithLeaves(IntegrationTestCase):
	"""Test weekly expected hours calculation with leaves and holidays"""
	
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Weekly Entry Employee Leaves")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)
		
		# Set base weekly hours to 40 in Company
		company = frappe.db.get_value("Employee", cls.employee.name, "company")
		if company:
			frappe.db.set_value("Company", company, "base_weekly_hours", 40)
			frappe.db.commit()
	
	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()
	
	def setUp(self):
		# Clean up entries before each test
		frappe.db.sql("""
			DELETE FROM `tabWeekly Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabLeave Application`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()
	
	def test_100_percent_fte_regular_leave_reduces_expected(self):
		"""Test that 100% FTE with 1 regular leave day reduces weekly expected by daily_avg"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		monday = get_test_monday()
		friday = add_days(monday, 4)
		
		# Create approved leave application for Friday
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": "Vacation Leave",
			"from_date": friday,
			"to_date": friday,
			"status": "Approved"
		})
		leave_app.insert()
		leave_app.submit()
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, work days: 5, daily_avg: 8h
		# Expected: 40h - (1 leave × 8h) = 32h
		self.assertAlmostEqual(expected, 32.0, places=1)
	
	def test_80_percent_fte_regular_leave_reduces_expected(self):
		"""Test that 80% FTE with 1 regular leave day reduces weekly expected proportionally"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		# Update work pattern to 80% FTE
		pattern = frappe.get_doc("Employee Work Pattern", self.work_pattern.name)
		pattern.fte_percentage = 80
		pattern.save()
		frappe.db.commit()
		
		monday = get_test_monday()
		friday = add_days(monday, 4)
		
		# Create approved leave application for Friday
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": "Sick Leave",
			"from_date": friday,
			"to_date": friday,
			"status": "Approved"
		})
		leave_app.insert()
		leave_app.submit()
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, FTE: 80% → 32h, work days: 5, daily_avg: 6.4h
		# Expected: 32h - (1 leave × 6.4h) = 25.6h
		self.assertAlmostEqual(expected, 25.6, places=1)
	
	def test_half_day_leave_reduces_by_half(self):
		"""Test that half-day leave reduces expected by half of daily average"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		monday = get_test_monday()
		friday = add_days(monday, 4)
		
		# Create approved half-day leave application for Friday
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": "Vacation Leave",
			"from_date": friday,
			"to_date": friday,
			"half_day": 1,
			"half_day_date": friday,
			"status": "Approved"
		})
		leave_app.insert()
		leave_app.submit()
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, work days: 5, daily_avg: 8h
		# Expected: 40h - (0.5 leave × 8h) = 36h
		self.assertAlmostEqual(expected, 36.0, places=1)
	
	def test_flex_off_does_not_reduce_expected(self):
		"""Test that Flex Off does NOT reduce weekly expected (already in pattern)"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		monday = get_test_monday()
		friday = add_days(monday, 4)
		
		# Create approved Flex Off application for Friday
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": "Flex Off",
			"from_date": friday,
			"to_date": friday,
			"status": "Approved"
		})
		leave_app.insert()
		leave_app.submit()
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, Flex Off doesn't reduce expected (already in pattern)
		# Expected: 40h (no reduction)
		self.assertAlmostEqual(expected, 40.0, places=1)
	
	def test_multiple_leaves_reduce_expected(self):
		"""Test that multiple regular leave days reduce expected proportionally"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		monday = get_test_monday()
		wednesday = add_days(monday, 2)
		friday = add_days(monday, 4)
		
		# Create approved leave applications for Wednesday and Friday
		for date in [wednesday, friday]:
			leave_app = frappe.get_doc({
				"doctype": "Leave Application",
				"employee": self.employee.name,
				"leave_type": "Vacation Leave",
				"from_date": date,
				"to_date": date,
				"status": "Approved"
			})
			leave_app.insert()
			leave_app.submit()
		
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, work days: 5, daily_avg: 8h
		# Expected: 40h - (2 leaves × 8h) = 24h
		self.assertAlmostEqual(expected, 24.0, places=1)
	
	def test_leaves_and_holidays_both_reduce_expected(self):
		"""Test that both leaves and holidays reduce expected hours"""
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays
		
		# Create a holiday for Tuesday
		company = frappe.db.get_value("Employee", self.employee.name, "company")
		holiday_list = frappe.db.get_value("Company", company, "default_holiday_list")
		
		if holiday_list:
			tuesday = add_days(get_test_monday(), 1)
			# Check if holiday already exists
			if not frappe.db.exists("Holiday", {
				"parent": holiday_list,
				"holiday_date": tuesday
			}):
				frappe.get_doc({
					"doctype": "Holiday",
					"parent": holiday_list,
					"parenttype": "Holiday List",
					"parentfield": "holidays",
					"holiday_date": tuesday,
					"description": "Test Holiday"
				}).insert()
		
		monday = get_test_monday()
		friday = add_days(monday, 4)
		
		# Create approved leave application for Friday
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": "Vacation Leave",
			"from_date": friday,
			"to_date": friday,
			"status": "Approved"
		})
		leave_app.insert()
		leave_app.submit()
		frappe.db.commit()
		
		# Calculate expected hours
		expected = calculate_weekly_expected_hours_with_holidays(self.employee.name, monday)
		
		# Base: 40h, work days: 5, daily_avg: 8h
		# Expected: 40h - (1 holiday × 8h) - (1 leave × 8h) = 24h
		self.assertAlmostEqual(expected, 24.0, places=1)
