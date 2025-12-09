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
	get_test_monday,
	cleanup_test_data
)


class TestRollCallEntry(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Roll Call Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		super().tearDownClass()

	def setUp(self):
		# Clean up roll call entries before each test
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_create_roll_call_entry(self):
		"""Test basic Roll Call Entry creation"""
		date = get_test_monday()
		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"office"
		)

		self.assertEqual(entry.employee, self.employee.name)
		self.assertEqual(str(entry.date), str(date))
		self.assertEqual(entry.presence_type, "office")
		self.assertEqual(entry.source, "Manual")
		self.assertEqual(entry.day_of_week, "Monday")

	def test_day_of_week_auto_set(self):
		"""Test that day_of_week is auto-set from date"""
		monday = get_test_monday()

		for i, day_name in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]):
			date = add_days(monday, i)
			entry = create_test_roll_call_entry(
				self.employee.name,
				date,
				"office"
			)
			self.assertEqual(entry.day_of_week, day_name,
				f"Expected {day_name} for {date}")

			# Clean up for next iteration
			frappe.delete_doc("Roll Call Entry", entry.name, force=True)

	def test_unique_entry_per_employee_date(self):
		"""Test that only one entry per employee per date is allowed"""
		date = get_test_monday()

		# Create first entry
		create_test_roll_call_entry(self.employee.name, date, "office")

		# Attempt to create duplicate should raise error
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Roll Call Entry",
				"employee": self.employee.name,
				"date": date,
				"presence_type": "home",
				"source": "Manual"
			}).insert()

	def test_system_type_cannot_be_manually_selected(self):
		"""Test that system types (weekend, holiday) cannot be manually selected"""
		date = get_test_monday()

		# Try to manually set weekend type
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({
				"doctype": "Roll Call Entry",
				"employee": self.employee.name,
				"date": date,
				"presence_type": "weekend",
				"source": "Manual"  # Not System
			}).insert()

	def test_system_source_bypasses_type_validation(self):
		"""Test that source='System' bypasses presence type permission checks"""
		date = get_test_monday()

		# System source should allow setting system types
		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"weekend",
			source="System"
		)

		self.assertEqual(entry.presence_type, "weekend")
		self.assertEqual(entry.source, "System")

	def test_leave_source_bypasses_type_validation(self):
		"""Test that source='Leave' bypasses presence type permission checks"""
		date = get_test_monday()

		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"vacation",
			source="Leave"
		)

		self.assertEqual(entry.presence_type, "vacation")
		self.assertEqual(entry.source, "Leave")

	def test_update_existing_entry(self):
		"""Test updating an existing Roll Call Entry"""
		date = get_test_monday()

		# Create initial entry
		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"office"
		)
		original_name = entry.name

		# Update via create_test_roll_call_entry (which handles existing)
		updated = create_test_roll_call_entry(
			self.employee.name,
			date,
			"home"
		)

		self.assertEqual(updated.name, original_name)
		self.assertEqual(updated.presence_type, "home")

	def test_half_day_entry(self):
		"""Test half-day Roll Call Entry"""
		date = get_test_monday()

		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"vacation",
			source="Leave",
			is_half_day=True
		)

		self.assertTrue(entry.is_half_day)

	def test_locked_entry_cannot_be_edited(self):
		"""Test that locked entries cannot be edited by regular users"""
		date = get_test_monday()

		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"office"
		)

		# Lock the entry
		entry.db_set("is_locked", 1)

		# Try to edit as non-HR user
		frappe.set_user("Guest")

		with self.assertRaises(frappe.ValidationError):
			entry.presence_type = "home"
			entry.save()

		frappe.set_user("Administrator")

	def test_leave_source_overrides_locked(self):
		"""Test that Leave source can update locked entries"""
		date = get_test_monday()

		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"office"
		)

		# Lock the entry
		entry.db_set("is_locked", 1)

		# Reload and update with Leave source
		entry.reload()
		entry.presence_type = "vacation"
		entry.source = "Leave"
		entry.save(ignore_permissions=True)  # Leave Application would do this

		self.assertEqual(entry.presence_type, "vacation")

	def test_get_roll_call_for_week(self):
		"""Test getting roll call entries for a week"""
		from flexitime.flexitime.doctype.roll_call_entry.roll_call_entry import get_roll_call_for_week

		monday = get_test_monday()

		# Create entries for Mon, Wed, Fri
		create_test_roll_call_entry(self.employee.name, monday, "office")
		create_test_roll_call_entry(self.employee.name, add_days(monday, 2), "home")
		create_test_roll_call_entry(self.employee.name, add_days(monday, 4), "office")

		result = get_roll_call_for_week(self.employee.name, monday)

		self.assertEqual(len(result), 3)
		self.assertIn(str(monday), result)
		self.assertIn(str(add_days(monday, 2)), result)
		self.assertIn(str(add_days(monday, 4)), result)

	def test_update_roll_call_api(self):
		"""Test the update_roll_call API endpoint"""
		from flexitime.flexitime.doctype.roll_call_entry.roll_call_entry import update_roll_call

		date = get_test_monday()

		# Create new entry via API
		entry_name = update_roll_call(
			self.employee.name,
			str(date),
			"office",
			notes="Test note"
		)

		entry = frappe.get_doc("Roll Call Entry", entry_name)
		self.assertEqual(entry.presence_type, "office")
		self.assertEqual(entry.notes, "Test note")

		# Update existing entry via API
		update_roll_call(
			self.employee.name,
			str(date),
			"home",
			notes="Updated note"
		)

		entry.reload()
		self.assertEqual(entry.presence_type, "home")
		self.assertEqual(entry.notes, "Updated note")

	def test_entry_with_notes(self):
		"""Test Roll Call Entry with notes"""
		date = get_test_monday()

		entry = create_test_roll_call_entry(
			self.employee.name,
			date,
			"office",
			notes="Working on project X"
		)

		self.assertEqual(entry.notes, "Working on project X")


class TestRollCallEntryPermissions(IntegrationTestCase):
	"""Test permission-related functionality"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Permission Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)

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
		frappe.set_user("Administrator")

	def test_hr_manager_can_set_any_type(self):
		"""Test that HR Manager can set any presence type"""
		date = get_test_monday()

		# HR Manager (Administrator has all roles) can set any type
		entry = frappe.get_doc({
			"doctype": "Roll Call Entry",
			"employee": self.employee.name,
			"date": date,
			"presence_type": "home",  # Normally restricted
			"source": "Manual"
		})
		entry.insert()

		self.assertEqual(entry.presence_type, "home")

	def test_available_to_all_types(self):
		"""Test that available_to_all types can be selected by anyone"""
		# office is available_to_all=1
		date = get_test_monday()

		entry = frappe.get_doc({
			"doctype": "Roll Call Entry",
			"employee": self.employee.name,
			"date": date,
			"presence_type": "office",
			"source": "Manual"
		})
		entry.insert()

		self.assertEqual(entry.presence_type, "office")
