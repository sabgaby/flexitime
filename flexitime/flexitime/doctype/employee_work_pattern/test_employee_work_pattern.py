# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate, add_days, today, get_first_day

from flexitime.tests.test_utils import (
	create_test_employee,
	create_test_work_pattern,
	create_test_presence_types,
	get_test_monday,
	cleanup_test_data
)


class TestEmployeeWorkPattern(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Work Pattern Employee")

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		# Clean up work patterns before each test
		frappe.db.sql("""
			DELETE FROM `tabEmployee Work Pattern`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_create_work_pattern(self):
		"""Test basic work pattern creation"""
		valid_from = get_first_day(today())

		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		self.assertEqual(doc.employee, self.employee.name)
		self.assertEqual(doc.fte_percentage, 100)

	def test_weekly_hours_auto_calculated(self):
		"""Test that weekly expected hours is auto-calculated"""
		valid_from = get_first_day(today())

		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		self.assertEqual(doc.weekly_expected_hours, 40)

	def test_flexitime_limit_auto_calculated(self):
		"""Test that flexitime limit is auto-calculated from FTE"""
		valid_from = get_first_day(today())

		# 100% FTE = 20 hour limit
		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		self.assertEqual(doc.flexitime_limit_hours, 20)

	def test_flexitime_limit_scales_with_fte(self):
		"""Test that flexitime limit scales with FTE percentage"""
		valid_from = get_first_day(today())

		# 80% FTE = 16 hour limit
		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 80,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 0,  # Day off
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		self.assertEqual(doc.flexitime_limit_hours, 16)  # 20 * 0.8 = 16

	def test_negative_hours_validation(self):
		"""Test that negative hours are rejected"""
		valid_from = get_first_day(today())

		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Employee Work Pattern",
				"employee": self.employee.name,
				"fte_percentage": 100,
				"valid_from": valid_from,
				"monday_hours": -1,  # Invalid
				"tuesday_hours": 8,
				"wednesday_hours": 8,
				"thursday_hours": 8,
				"friday_hours": 8,
				"saturday_hours": 0,
				"sunday_hours": 0
			}).insert()

	def test_valid_to_before_valid_from_validation(self):
		"""Test that valid_to cannot be before valid_from"""
		valid_from = get_first_day(today())
		valid_to = add_days(valid_from, -1)  # Before valid_from

		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Employee Work Pattern",
				"employee": self.employee.name,
				"fte_percentage": 100,
				"valid_from": valid_from,
				"valid_to": valid_to,
				"monday_hours": 8,
				"tuesday_hours": 8,
				"wednesday_hours": 8,
				"thursday_hours": 8,
				"friday_hours": 8,
				"saturday_hours": 0,
				"sunday_hours": 0
			}).insert()

	def test_overlapping_patterns_validation(self):
		"""Test that overlapping patterns for same employee are rejected"""
		valid_from = get_first_day(today())

		# Create first pattern (submitted)
		first = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		first.insert()
		first.submit()

		# Try to create overlapping pattern
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Employee Work Pattern",
				"employee": self.employee.name,
				"fte_percentage": 80,
				"valid_from": add_days(valid_from, 15),  # Overlaps with first
				"monday_hours": 8,
				"tuesday_hours": 8,
				"wednesday_hours": 8,
				"thursday_hours": 8,
				"friday_hours": 0,
				"saturday_hours": 0,
				"sunday_hours": 0
			}).insert()

	def test_get_hours_for_weekday(self):
		"""Test get_hours_for_weekday method"""
		valid_from = get_first_day(today())

		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 7,
			"wednesday_hours": 6,
			"thursday_hours": 5,
			"friday_hours": 4,
			"saturday_hours": 2,
			"sunday_hours": 1
		})
		doc.insert()

		monday = get_test_monday()
		self.assertEqual(doc.get_hours_for_weekday(monday), 8)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 1)), 7)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 2)), 6)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 3)), 5)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 4)), 4)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 5)), 2)
		self.assertEqual(doc.get_hours_for_weekday(add_days(monday, 6)), 1)

	def test_is_day_off(self):
		"""Test is_day_off method"""
		valid_from = get_first_day(today())

		# Pattern with Friday off (80% FTE)
		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 80,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 0,  # Day off
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		monday = get_test_monday()
		friday = add_days(monday, 4)
		saturday = add_days(monday, 5)

		# Friday with 0 hours is a day off
		self.assertTrue(doc.is_day_off(friday))

		# Monday with 8 hours is not a day off
		self.assertFalse(doc.is_day_off(monday))

		# Saturday is NOT a day off (it's a weekend)
		self.assertFalse(doc.is_day_off(saturday))

	def test_get_day_off_weekdays(self):
		"""Test get_day_off_weekdays method"""
		valid_from = get_first_day(today())

		# Pattern with Wednesday and Friday off
		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 60,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 0,  # Day off
			"thursday_hours": 8,
			"friday_hours": 0,     # Day off
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()

		day_offs = doc.get_day_off_weekdays()

		# Should contain Wednesday (2) and Friday (4)
		self.assertIn(2, day_offs)
		self.assertIn(4, day_offs)
		self.assertEqual(len(day_offs), 2)

		# Should NOT contain Saturday (5) or Sunday (6)
		self.assertNotIn(5, day_offs)
		self.assertNotIn(6, day_offs)

	def test_submit_creates_day_off_entries(self):
		"""Test that submitting creates day_off Roll Call entries"""
		valid_from = get_first_day(today())

		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 80,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 0,  # Day off
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()
		doc.submit()

		# Check that day_off entries were created for Fridays
		entries = frappe.get_all("Roll Call Entry",
			filters={
				"employee": self.employee.name,
				"presence_type": "day_off",
				"source": "System"
			},
			fields=["date"]
		)

		# Should have created entries for multiple Fridays
		self.assertGreater(len(entries), 0)

		# All entries should be on Fridays (weekday 4)
		for entry in entries:
			self.assertEqual(getdate(entry.date).weekday(), 4)


class TestGetWorkPattern(IntegrationTestCase):
	"""Test the get_work_pattern utility function"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.employee = create_test_employee("_Test Get Pattern Employee")

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		frappe.db.sql("""
			DELETE FROM `tabEmployee Work Pattern`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_get_work_pattern_returns_active(self):
		"""Test that get_work_pattern returns the active pattern for a date"""
		from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

		valid_from = get_first_day(today())

		pattern = create_test_work_pattern(
			self.employee.name,
			fte_percentage=80,
			valid_from=valid_from
		)

		# Get pattern for today
		result = get_work_pattern(self.employee.name, today())

		self.assertIsNotNone(result)
		self.assertEqual(result.name, pattern.name)

	def test_get_work_pattern_returns_none_for_no_pattern(self):
		"""Test that get_work_pattern returns None if no pattern exists"""
		from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

		result = get_work_pattern(self.employee.name, today())

		self.assertIsNone(result)

	def test_get_work_pattern_respects_date_range(self):
		"""Test that get_work_pattern respects valid_from and valid_to"""
		from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

		# Create pattern starting next month
		future_date = add_days(today(), 60)

		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": future_date,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()
		doc.submit()

		# Should not find pattern for today (before valid_from)
		result = get_work_pattern(self.employee.name, today())
		self.assertIsNone(result)

		# Should find pattern for future date
		result = get_work_pattern(self.employee.name, future_date)
		self.assertIsNotNone(result)

	def test_get_work_pattern_only_returns_submitted(self):
		"""Test that get_work_pattern only returns submitted patterns"""
		from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

		valid_from = get_first_day(today())

		# Create draft pattern (not submitted)
		doc = frappe.get_doc({
			"doctype": "Employee Work Pattern",
			"employee": self.employee.name,
			"fte_percentage": 100,
			"valid_from": valid_from,
			"monday_hours": 8,
			"tuesday_hours": 8,
			"wednesday_hours": 8,
			"thursday_hours": 8,
			"friday_hours": 8,
			"saturday_hours": 0,
			"sunday_hours": 0
		})
		doc.insert()
		# Don't submit

		# Should not find draft pattern
		result = get_work_pattern(self.employee.name, today())
		self.assertIsNone(result)

		# Submit pattern
		doc.submit()

		# Should now find pattern
		result = get_work_pattern(self.employee.name, today())
		self.assertIsNotNone(result)
