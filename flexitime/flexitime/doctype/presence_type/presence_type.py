# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PresenceType(Document):
	def validate(self):
		self.validate_parent()
		self.validate_leave_type()
		self.validate_system_type()

	def validate_parent(self):
		"""Ensure parent is not self. Parent can be any presence type for organizational grouping."""
		if self.parent_presence_type:
			if self.parent_presence_type == self.name:
				frappe.throw("Parent Presence Type cannot be itself")

	def validate_leave_type(self):
		"""Ensure leave_type is set if is_leave is checked"""
		if self.is_leave and not self.leave_type:
			frappe.throw("Leave Type is required when 'Is Leave Type' is checked")

	def validate_system_type(self):
		"""System types should not be available_to_all or have parent"""
		if self.is_system:
			# System types are auto-assigned, not manually selectable
			if self.available_to_all:
				frappe.msgprint(
					"System types are automatically assigned, 'Available to All' has no effect",
					indicator="blue"
				)


@frappe.whitelist()
def get_available_presence_types(employee, date):
	"""Return list of Presence Types employee can select for a date

	Includes `show_in_quick_dialog` flag for each type to support
	quick vs extended dialog display.
	"""
	from frappe.utils import getdate, today
	from flexitime.flexitime.utils import get_work_pattern

	# Get employee's work pattern for this date
	pattern = get_work_pattern(employee, date)
	expected_hours = pattern.get_hours_for_weekday(date) if pattern else 0

	# Get all presence types that are not system types
	all_types = frappe.get_all("Presence Type",
		filters={"is_system": 0},
		fields=["name", "label", "icon", "available_to_all", "requires_pattern_match",
				"is_leave", "category", "color", "leave_type", "show_in_quick_dialog"]
	)

	# Get employee-specific permissions from Employee Presence Settings
	employee_permissions = get_employee_presence_permissions(employee)

	available = []
	for pt in all_types:
		# Skip if not available to all AND not in employee permissions
		if not pt.available_to_all and pt.name not in employee_permissions:
			continue

		# Skip day_off type if employee has expected hours that day
		if pt.requires_pattern_match and expected_hours > 0:
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
	"""Determine system-assigned presence type for a date

	Returns: (presence_type, source, leave_application) tuple
	"""
	from frappe.utils import getdate
	from flexitime.flexitime.utils import get_work_pattern, is_holiday

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
			{"is_leave": 1, "leave_type": leave.leave_type})
		if presence:
			return presence, "Leave", leave.name

	# 2. Check Holiday List
	if is_holiday(date, employee):
		return "holiday", "System", None

	# 3. Check Work Pattern
	pattern = get_work_pattern(employee, date)
	weekday = date.weekday()  # 0=Monday, 6=Sunday
	expected = pattern.get_hours_for_weekday(date) if pattern else 8

	if weekday in [5, 6] and expected == 0:
		return "weekend", "System", None
	elif expected == 0:
		return "day_off", "System", None

	# 4. No auto-assignment - needs manual entry
	return None, None, None
