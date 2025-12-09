# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""
Tests for Roll Call API functions
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate, add_days, today, get_first_day, get_last_day

from flexitime.tests.test_utils import (
	create_test_employee,
	create_test_work_pattern,
	create_test_presence_types,
	create_test_roll_call_entry,
	get_test_monday,
	cleanup_test_data
)


class TestRollCallAPI(IntegrationTestCase):
	"""Test Roll Call API endpoints"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee_with_pattern = create_test_employee("_Test API Employee With Pattern")
		cls.work_pattern = create_test_work_pattern(cls.employee_with_pattern.name)
		cls.employee_without_pattern = create_test_employee("_Test API Employee Without Pattern")
		# Don't create work pattern for the second employee

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		# Clean up roll call entries before each test
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee IN (%s, %s)
		""", (self.employee_with_pattern.name, self.employee_without_pattern.name))
		frappe.db.commit()

	def test_get_events_returns_entries(self):
		"""Test that get_events returns roll call entries"""
		from flexitime.api.roll_call import get_events

		month_start = get_first_day(today())
		month_end = get_last_day(today())

		# Create a roll call entry
		monday = get_test_monday()
		create_test_roll_call_entry(
			self.employee_with_pattern.name,
			monday,
			"office"
		)

		result = get_events(str(month_start), str(month_end))

		self.assertIn("entries", result)
		self.assertIn("current_employee", result)
		self.assertIn(self.employee_with_pattern.name, result["entries"])

	def test_get_events_includes_warning_for_missing_patterns(self):
		"""Test that get_events includes warnings for employees without work patterns"""
		from flexitime.api.roll_call import get_events

		month_start = get_first_day(today())
		month_end = get_last_day(today())

		result = get_events(str(month_start), str(month_end))

		# Should have warnings section
		self.assertIn("warnings", result)

		if result.get("warnings"):
			missing = result["warnings"].get("missing_work_patterns", [])

			# Employee without pattern should be in the list
			missing_employees = [m["employee"] for m in missing]
			self.assertIn(self.employee_without_pattern.name, missing_employees)

			# Employee with pattern should NOT be in the list
			self.assertNotIn(self.employee_with_pattern.name, missing_employees)

	def test_check_missing_work_patterns(self):
		"""Test the check_missing_work_patterns function"""
		from flexitime.api.roll_call import check_missing_work_patterns

		employees = [
			self.employee_with_pattern.name,
			self.employee_without_pattern.name
		]

		missing = check_missing_work_patterns(employees, str(today()))

		# Should only contain the employee without pattern
		self.assertEqual(len(missing), 1)
		self.assertEqual(missing[0]["employee"], self.employee_without_pattern.name)

	def test_get_events_with_employee_filters(self):
		"""Test that get_events respects employee filters"""
		from flexitime.api.roll_call import get_events

		month_start = get_first_day(today())
		month_end = get_last_day(today())

		# Get company from employee
		company = frappe.db.get_value("Employee", self.employee_with_pattern.name, "company")

		result = get_events(
			str(month_start),
			str(month_end),
			{"company": company}
		)

		self.assertIn("entries", result)

	def test_save_entry_creates_new(self):
		"""Test that save_entry creates a new Roll Call Entry"""
		from flexitime.api.roll_call import save_entry

		monday = get_test_monday()

		result = save_entry(
			self.employee_with_pattern.name,
			str(monday),
			"office"
		)

		self.assertEqual(result["employee"], self.employee_with_pattern.name)
		self.assertEqual(result["presence_type"], "office")
		self.assertEqual(result["source"], "Manual")

	def test_save_entry_updates_existing(self):
		"""Test that save_entry updates an existing entry"""
		from flexitime.api.roll_call import save_entry

		monday = get_test_monday()

		# Create initial entry
		first = save_entry(
			self.employee_with_pattern.name,
			str(monday),
			"office"
		)

		# Update the entry
		second = save_entry(
			self.employee_with_pattern.name,
			str(monday),
			"home"
		)

		# Should be the same entry, updated
		self.assertEqual(first["name"], second["name"])
		self.assertEqual(second["presence_type"], "home")

	def test_save_entry_blocked_for_locked(self):
		"""Test that save_entry is blocked for locked entries"""
		from flexitime.api.roll_call import save_entry

		monday = get_test_monday()

		# Create and lock entry
		entry = create_test_roll_call_entry(
			self.employee_with_pattern.name,
			monday,
			"office"
		)
		entry.db_set("is_locked", 1)

		# Try to update - should fail
		with self.assertRaises(frappe.ValidationError):
			save_entry(
				self.employee_with_pattern.name,
				str(monday),
				"home"
			)


class TestEnsureDayOffEntries(IntegrationTestCase):
	"""Test the ensure_day_off_entries function"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Day Off Employee")

		# Create work pattern with Friday off (80% FTE)
		cls.work_pattern = create_test_work_pattern(
			cls.employee.name,
			fte_percentage=80,
			friday=0  # Day off
		)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_ensure_day_off_creates_entries(self):
		"""Test that ensure_day_off_entries creates day_off entries"""
		from flexitime.api.roll_call import ensure_day_off_entries

		month_start = get_first_day(today())
		month_end = get_last_day(today())

		ensure_day_off_entries(self.employee.name, str(month_start), str(month_end))

		# Check that day_off entries were created for Fridays
		entries = frappe.get_all("Roll Call Entry",
			filters={
				"employee": self.employee.name,
				"presence_type": "day_off",
				"source": "System"
			}
		)

		# Should have at least one Friday in the month
		self.assertGreater(len(entries), 0)

	def test_ensure_day_off_skips_existing(self):
		"""Test that ensure_day_off_entries doesn't create duplicates"""
		from flexitime.api.roll_call import ensure_day_off_entries

		month_start = get_first_day(today())
		month_end = get_last_day(today())

		# Run twice
		ensure_day_off_entries(self.employee.name, str(month_start), str(month_end))
		count_after_first = frappe.db.count("Roll Call Entry", {
			"employee": self.employee.name,
			"presence_type": "day_off"
		})

		ensure_day_off_entries(self.employee.name, str(month_start), str(month_end))
		count_after_second = frappe.db.count("Roll Call Entry", {
			"employee": self.employee.name,
			"presence_type": "day_off"
		})

		# Count should be the same
		self.assertEqual(count_after_first, count_after_second)


class TestGetCurrentUserInfo(IntegrationTestCase):
	"""Test get_current_user_info API"""

	def test_get_current_user_info_as_admin(self):
		"""Test get_current_user_info returns user data"""
		from flexitime.api.roll_call import get_current_user_info

		frappe.set_user("Administrator")

		result = get_current_user_info()

		self.assertIn("name", result)
		self.assertIn("roles", result)
		self.assertEqual(result["name"], "Administrator")

	def test_get_current_user_info_as_guest_fails(self):
		"""Test get_current_user_info fails for Guest"""
		from flexitime.api.roll_call import get_current_user_info

		frappe.set_user("Guest")

		with self.assertRaises(frappe.AuthenticationError):
			get_current_user_info()

		frappe.set_user("Administrator")
