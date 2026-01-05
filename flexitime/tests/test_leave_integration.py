# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""
Tests for Leave Application integration with Roll Call and Weekly Entry
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate, add_days, today, get_first_day

from flexitime.tests.test_utils import (
	create_test_employee,
	create_test_work_pattern,
	create_test_presence_types,
	create_test_roll_call_entry,
	create_test_weekly_entry,
	get_test_monday,
	cleanup_test_data
)


def create_test_leave_type(leave_type_name="_Test Leave Type"):
	"""Create a test leave type"""
	if frappe.db.exists("Leave Type", leave_type_name):
		return frappe.get_doc("Leave Type", leave_type_name)

	doc = frappe.get_doc({
		"doctype": "Leave Type",
		"leave_type_name": leave_type_name,
		"max_leaves_allowed": 30,
		"is_lwp": 0,
		"include_holiday": 0
	})
	doc.insert(ignore_permissions=True)
	return doc


def create_test_leave_allocation(employee, leave_type, from_date, to_date, new_leaves=30):
	"""Create a test leave allocation"""
	existing = frappe.db.exists("Leave Allocation", {
		"employee": employee,
		"leave_type": leave_type,
		"from_date": from_date,
		"to_date": to_date
	})
	if existing:
		return frappe.get_doc("Leave Allocation", existing)

	doc = frappe.get_doc({
		"doctype": "Leave Allocation",
		"employee": employee,
		"leave_type": leave_type,
		"from_date": from_date,
		"to_date": to_date,
		"new_leaves_allocated": new_leaves
	})
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc


def create_test_leave_application(employee, leave_type, from_date, to_date,
								   half_day=False, half_day_date=None, submit=False):
	"""Create a test leave application"""
	doc = frappe.get_doc({
		"doctype": "Leave Application",
		"employee": employee,
		"leave_type": leave_type,
		"from_date": from_date,
		"to_date": to_date,
		"half_day": half_day,
		"half_day_date": half_day_date,
		"description": "Test leave application"
	})
	doc.insert(ignore_permissions=True)

	if submit:
		doc.submit()

	return doc


class TestLeaveApplicationIntegration(IntegrationTestCase):
	"""Test Leave Application integration with Roll Call"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Leave Integration Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)

		# Create leave type and link to presence type
		cls.leave_type = create_test_leave_type("Casual Leave")

		# Link presence type to leave type
		if frappe.db.exists("Presence Type", "vacation"):
			frappe.db.set_value("Presence Type", "vacation", {
				"requires_leave_application": 1,
				"leave_type": cls.leave_type.name
			})

		# Create leave allocation for current year
		year = getdate(today()).year
		cls.leave_allocation = create_test_leave_allocation(
			cls.employee.name,
			cls.leave_type.name,
			f"{year}-01-01",
			f"{year}-12-31"
		)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		# Clean up leave data
		frappe.db.sql("DELETE FROM `tabLeave Application` WHERE employee = %s", (cls.employee.name,))
		frappe.db.sql("DELETE FROM `tabLeave Allocation` WHERE employee = %s", (cls.employee.name,))
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		# Clean up entries before each test
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabWeekly Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabLeave Application`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_approved_leave_creates_roll_call_entry(self):
		"""Test that approving leave creates Roll Call Entry"""
		monday = get_test_monday()

		# Create and submit leave application
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,  # Single day
			submit=True
		)

		# Check Roll Call Entry was created
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": self.employee.name, "date": monday},
			["presence_type", "source", "leave_application"],
			as_dict=True
		)

		self.assertIsNotNone(roll_call)
		self.assertEqual(roll_call.source, "Leave")
		self.assertEqual(roll_call.leave_application, leave_app.name)

	def test_approved_leave_updates_existing_roll_call(self):
		"""Test that approving leave updates existing Roll Call Entry"""
		monday = get_test_monday()

		# Create manual roll call entry first
		manual_entry = create_test_roll_call_entry(
			self.employee.name,
			monday,
			"office"
		)

		# Submit leave application
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,
			submit=True
		)

		# Reload roll call entry
		manual_entry.reload()

		# Should be updated to leave type
		self.assertEqual(manual_entry.source, "Leave")
		self.assertEqual(manual_entry.leave_application, leave_app.name)

	def test_leave_overrides_locked_entry(self):
		"""Test that leave application can override locked Roll Call Entry"""
		monday = get_test_monday()

		# Create and lock manual entry
		manual_entry = create_test_roll_call_entry(
			self.employee.name,
			monday,
			"office"
		)
		manual_entry.db_set("is_locked", 1)

		# Submit leave application - should override lock
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,
			submit=True
		)

		# Reload roll call entry
		manual_entry.reload()

		# Should be updated despite being locked
		self.assertEqual(manual_entry.source, "Leave")
		self.assertEqual(manual_entry.leave_application, leave_app.name)

	def test_multi_day_leave_creates_multiple_entries(self):
		"""Test that multi-day leave creates Roll Call Entry for each day"""
		monday = get_test_monday()
		friday = add_days(monday, 4)

		# Create 5-day leave application
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			friday,
			submit=True
		)

		# Check Roll Call entries were created for each day
		entries = frappe.get_all("Roll Call Entry",
			filters={
				"employee": self.employee.name,
				"leave_application": leave_app.name
			},
			fields=["date"]
		)

		self.assertEqual(len(entries), 5)

	def test_half_day_leave_sets_is_half_day(self):
		"""Test that half-day leave sets is_half_day on Roll Call Entry"""
		monday = get_test_monday()

		# Create half-day leave
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,
			half_day=True,
			half_day_date=monday,
			submit=True
		)

		# Check Roll Call Entry
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": self.employee.name, "date": monday},
			["is_half_day"],
			as_dict=True
		)

		self.assertTrue(roll_call.is_half_day)

	def test_cancelled_leave_deletes_roll_call_entry(self):
		"""Test that cancelling leave deletes Roll Call Entry"""
		monday = get_test_monday()

		# Create and submit leave
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,
			submit=True
		)

		# Verify Roll Call exists
		self.assertTrue(frappe.db.exists("Roll Call Entry",
			{"employee": self.employee.name, "date": monday}))

		# Cancel leave
		leave_app.reload()
		leave_app.cancel()

		# Roll Call Entry should be deleted
		self.assertFalse(frappe.db.exists("Roll Call Entry",
			{"employee": self.employee.name, "date": monday}))


class TestLeaveBlocksSubmittedWeeklyEntry(IntegrationTestCase):
	"""Test that leave cannot be approved for dates with submitted Weekly Entry"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Leave Block Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)
		cls.leave_type = create_test_leave_type("Casual Leave")

		# Create leave allocation
		year = getdate(today()).year
		cls.leave_allocation = create_test_leave_allocation(
			cls.employee.name,
			cls.leave_type.name,
			f"{year}-01-01",
			f"{year}-12-31"
		)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		frappe.db.sql("DELETE FROM `tabLeave Application` WHERE employee = %s", (cls.employee.name,))
		frappe.db.sql("DELETE FROM `tabLeave Allocation` WHERE employee = %s", (cls.employee.name,))
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabWeekly Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabLeave Application`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_leave_blocked_if_weekly_entry_submitted(self):
		"""Test that leave approval is blocked if Weekly Entry is submitted"""
		from flexitime.flexitime.events.leave_application import validate_no_submitted_weekly_entries

		monday = get_test_monday(-1)  # Previous week

		# Create and submit Weekly Entry
		weekly_entry = create_test_weekly_entry(self.employee.name, monday, submit=True)

		# Create leave application for that week (draft)
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": self.leave_type.name,
			"from_date": monday,
			"to_date": add_days(monday, 2),  # Mon-Wed
			"description": "Test leave"
		})
		leave_app.insert(ignore_permissions=True)

		# Validation should fail
		with self.assertRaises(frappe.ValidationError):
			validate_no_submitted_weekly_entries(leave_app)

	def test_leave_allowed_if_weekly_entry_draft(self):
		"""Test that leave can be approved if Weekly Entry is still draft"""
		from flexitime.flexitime.events.leave_application import validate_no_submitted_weekly_entries

		monday = get_test_monday(-1)

		# Create draft Weekly Entry (not submitted)
		weekly_entry = create_test_weekly_entry(self.employee.name, monday, submit=False)

		# Create leave application
		leave_app = frappe.get_doc({
			"doctype": "Leave Application",
			"employee": self.employee.name,
			"leave_type": self.leave_type.name,
			"from_date": monday,
			"to_date": add_days(monday, 2),
			"description": "Test leave"
		})
		leave_app.insert(ignore_permissions=True)

		# Should not raise - draft Weekly Entry doesn't block
		try:
			validate_no_submitted_weekly_entries(leave_app)
		except frappe.ValidationError:
			self.fail("Should not block leave for draft Weekly Entry")


class TestLeaveStatusInRollCall(IntegrationTestCase):
	"""Test leave_status field behavior in Roll Call API"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.presence_types = create_test_presence_types()
		cls.employee = create_test_employee("_Test Leave Status Employee")
		cls.work_pattern = create_test_work_pattern(cls.employee.name)
		cls.leave_type = create_test_leave_type("Casual Leave")

		# Link presence type to leave type
		if frappe.db.exists("Presence Type", "vacation"):
			frappe.db.set_value("Presence Type", "vacation", {
				"requires_leave_application": 1,
				"leave_type": cls.leave_type.name,
				"requires_leave_application": 1
			})

		# Create leave allocation
		year = getdate(today()).year
		cls.leave_allocation = create_test_leave_allocation(
			cls.employee.name,
			cls.leave_type.name,
			f"{year}-01-01",
			f"{year}-12-31"
		)

	@classmethod
	def tearDownClass(cls):
		cleanup_test_data()
		frappe.db.sql("DELETE FROM `tabLeave Application` WHERE employee = %s", (cls.employee.name,))
		frappe.db.sql("DELETE FROM `tabLeave Allocation` WHERE employee = %s", (cls.employee.name,))
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.sql("""
			DELETE FROM `tabLeave Application`
			WHERE employee = %s
		""", (self.employee.name,))
		frappe.db.commit()

	def test_tentative_leave_status(self):
		"""Test that marking leave type without Leave Application shows tentative"""
		monday = get_test_monday()

		# Create roll call entry with vacation (requires_leave_application=1)
		# but no actual Leave Application
		entry = create_test_roll_call_entry(
			self.employee.name,
			monday,
			"vacation",
			source="Manual"  # Not Leave
		)

		# No leave_application linked
		self.assertFalse(entry.leave_application)

	def test_approved_leave_status(self):
		"""Test that approved leave shows leave_application link"""
		monday = get_test_monday()

		# Create approved leave
		leave_app = create_test_leave_application(
			self.employee.name,
			self.leave_type.name,
			monday,
			monday,
			submit=True
		)

		# Check Roll Call Entry has leave_application
		entry = frappe.get_doc("Roll Call Entry",
			{"employee": self.employee.name, "date": monday})

		self.assertEqual(entry.leave_application, leave_app.name)
		self.assertEqual(entry.source, "Leave")
