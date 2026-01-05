# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PresenceType(Document):
	def validate(self):
		self.validate_leave_type()

	def validate_leave_type(self):
		"""Ensure leave_type is set if requires_leave_application is checked"""
		if self.requires_leave_application and not self.leave_type:
			frappe.throw("Leave Type is required when 'Requires Leave Application' is checked")


@frappe.whitelist()
def get_available_presence_types(employee, date):
	"""Return list of Presence Types employee can select for a date"""
	from frappe.utils import getdate, today
	from flexitime.flexitime.utils import get_work_pattern

	# Get employee's work pattern for this date
	pattern = get_work_pattern(employee, date)
	expected_hours = pattern.get_hours_for_weekday(date) if pattern else 0

	# Get day off presence type from Flexitime Settings
	day_off_presence_type = None
	try:
		settings = frappe.get_cached_doc("Flexitime Settings")
		day_off_presence_type = settings.day_off_presence_type
	except Exception:
		# Fallback to default if settings not available
		day_off_presence_type = "day_off" if frappe.db.exists("Presence Type", "day_off") else None

	# Get all presence types
	all_types = frappe.get_all("Presence Type",
		fields=["name", "label", "icon", "available_to_all",
				"expect_work_hours", "color", "leave_type"]
	)

	# Get employee-specific permissions from Employee Presence Settings
	employee_permissions = get_employee_presence_permissions(employee)

	available = []
	for pt in all_types:
		# Skip if not available to all AND not in employee permissions
		if not pt.available_to_all and pt.name not in employee_permissions:
			continue

		# Skip day off presence type if employee has expected hours that day
		if day_off_presence_type and pt.name == day_off_presence_type and expected_hours > 0:
			continue

		available.append(pt)

	return available


def get_employee_presence_permissions(employee, check_date=None):
	"""Get list of presence types this employee has permission for.

	Args:
		employee: Employee ID
		check_date: Date to check permissions against (defaults to today)

	Returns:
		List of presence_type names that are currently valid
	"""
	from frappe.utils import getdate, today

	if check_date is None:
		check_date = today()
	check_date = getdate(check_date)

	# Get the employee's presence settings
	settings_name = frappe.db.get_value("Employee Presence Settings", {"employee": employee})

	if not settings_name:
		return []

	# Get all permissions from the child table
	permissions = frappe.get_all("Employee Presence Permission",
		filters={"parent": settings_name},
		fields=["presence_type", "from_date", "to_date"]
	)

	valid_permissions = []
	for perm in permissions:
		# Check date range
		if perm.from_date and check_date < getdate(perm.from_date):
			continue
		if perm.to_date and check_date > getdate(perm.to_date):
			continue
		valid_permissions.append(perm.presence_type)

	return valid_permissions


def get_auto_presence_type(employee, date):
	"""Determine system-assigned presence type for a date.

	Returns: (presence_type, source, leave_application) tuple

	Only returns auto-assignable types:
	- Leave: From approved Leave Applications
	- Holiday: From Holiday List

	Note: Weekends and day_off are NOT auto-assigned here.
	- Weekends: Cells are left empty (employees can record work if needed)
	- Day off: Created by Employee Work Pattern on submit with source="Pattern"
	"""
	from frappe.utils import getdate
	from flexitime.flexitime.utils import is_holiday

	date = getdate(date)

	# 1. Check for approved leave
	leave = frappe.db.get_value("Leave Application", {
		"employee": employee,
		"from_date": ["<=", date],
		"to_date": [">=", date],
		"status": "Approved",
		"docstatus": 1
	}, ["name", "leave_type"], as_dict=True)

	if leave:
		# Map Leave Type to Presence Type
		presence = frappe.db.get_value("Presence Type",
			{"requires_leave_application": 1, "leave_type": leave.leave_type})
		if presence:
			return presence, "Leave", leave.name

	# 2. Check Holiday List
	if is_holiday(date, employee):
		# Get holiday presence type from settings
		try:
			settings = frappe.get_cached_doc("Flexitime Settings")
			holiday_presence = settings.holiday_presence_type or "holiday"
		except Exception:
			# Fallback to default if settings not available
			holiday_presence = "holiday"
		
		if frappe.db.exists("Presence Type", holiday_presence):
			return holiday_presence, "System", None
		else:
			frappe.log_error(
				f"Configured Holiday Presence Type '{holiday_presence}' not found. Please check Flexitime Settings.",
				"Flexitime Configuration Error"
			)
			return None, None, None

	# 3. No auto-assignment - cell will be empty
	# Weekends: left empty (user can fill in if they work)
	# Day off: created by Employee Work Pattern, not here
	return None, None, None


@frappe.whitelist()
def get_requires_incapacity_declaration(leave_type):
	"""Check if a leave type requires incapacity declaration.
	
	Args:
		leave_type: Leave Type name
		
	Returns:
		bool: True if this Leave Type is configured as sick leave in Flexitime Settings
	"""
	if not leave_type:
		return False
	
	# Check Flexitime Settings for sick leave configuration
	try:
		settings = frappe.get_cached_doc("Flexitime Settings")
		if settings.sick_leave_type == leave_type:
			return True
	except Exception:
		# Settings might not exist yet, return False
		pass
	
	return False
