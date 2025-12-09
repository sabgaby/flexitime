# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""
Mobile API endpoints for Flexitime PWA
"""

import frappe
from frappe import _
from frappe.utils import getdate, today


@frappe.whitelist()
def get_current_employee():
	"""Get current user's employee record with flexitime data.

	Returns:
		dict: Employee data with flexitime fields
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please login to continue"), frappe.AuthenticationError)

	employee = frappe.db.get_value(
		"Employee",
		{"user_id": user, "status": "Active"},
		[
			"name", "employee_name", "designation", "department",
			"company", "user_id", "image", "custom_flexitime_balance"
		],
		as_dict=True
	)

	if not employee:
		frappe.throw(_("No active employee record found for your user account"))

	# Get flexitime limit from work pattern
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern
	pattern = get_work_pattern(employee.name, today())
	employee["flexitime_limit"] = pattern.flexitime_limit_hours if pattern else 20

	return employee


@frappe.whitelist()
def get_work_pattern():
	"""Get current user's active work pattern.

	Returns:
		dict: Work pattern data or None
	"""
	employee = _get_current_employee_name()

	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern as _get_pattern
	pattern = _get_pattern(employee, today())

	if not pattern:
		return None

	return {
		"name": pattern.name,
		"fte_percentage": pattern.fte_percentage,
		"flexitime_limit_hours": pattern.flexitime_limit_hours,
		"monday_hours": pattern.monday_hours,
		"tuesday_hours": pattern.tuesday_hours,
		"wednesday_hours": pattern.wednesday_hours,
		"thursday_hours": pattern.thursday_hours,
		"friday_hours": pattern.friday_hours,
		"saturday_hours": pattern.saturday_hours,
		"sunday_hours": pattern.sunday_hours,
		"weekly_expected_hours": pattern.weekly_expected_hours,
		"valid_from": str(pattern.valid_from),
		"valid_to": str(pattern.valid_to) if pattern.valid_to else None,
	}


@frappe.whitelist()
def get_presence_types():
	"""Get all presence types for selection.

	Returns:
		list: Presence types with their properties
	"""
	types = frappe.get_all(
		"Presence Type",
		fields=[
			"name", "label", "icon", "category", "color",
			"is_system", "is_leave",
			"requires_leave_application", "available_to_all"
		],
		order_by="sort_order asc"
	)

	return types


@frappe.whitelist()
def get_weekly_entries(limit=20):
	"""Get weekly entries for current employee.

	Args:
		limit: Maximum number of entries to return

	Returns:
		list: Weekly entry summaries
	"""
	employee = _get_current_employee_name()

	entries = frappe.get_all(
		"Weekly Entry",
		filters={"employee": employee},
		fields=[
			"name", "week_start", "week_end", "status", "docstatus",
			"total_actual_hours", "total_expected_hours", "weekly_delta",
			"previous_balance", "running_balance", "is_locked"
		],
		order_by="week_start desc",
		limit=limit
	)

	return entries


@frappe.whitelist()
def get_weekly_entry(name):
	"""Get a specific weekly entry with daily details.

	Args:
		name: Weekly Entry document name

	Returns:
		dict: Full weekly entry with daily entries
	"""
	employee = _get_current_employee_name()

	# Verify ownership
	entry_employee = frappe.db.get_value("Weekly Entry", name, "employee")
	if entry_employee != employee:
		# Check if user is HR Manager
		if "HR Manager" not in frappe.get_roles():
			frappe.throw(_("You don't have permission to view this entry"))

	doc = frappe.get_doc("Weekly Entry", name)

	return {
		"name": doc.name,
		"employee": doc.employee,
		"employee_name": doc.employee_name,
		"week_start": str(doc.week_start),
		"week_end": str(doc.week_end),
		"status": doc.status,
		"docstatus": doc.docstatus,
		"total_actual_hours": doc.total_actual_hours,
		"total_expected_hours": doc.total_expected_hours,
		"weekly_delta": doc.weekly_delta,
		"previous_balance": doc.previous_balance,
		"running_balance": doc.running_balance,
		"is_locked": doc.is_locked,
		"daily_entries": [
			{
				"name": d.name,
				"date": str(d.date),
				"day_of_week": d.day_of_week,
				"presence_type": d.presence_type,
				"presence_type_icon": d.presence_type_icon,
				"presence_type_label": d.presence_type_label,
				"expected_hours": d.expected_hours,
				"actual_hours": d.actual_hours,
				"difference": d.difference,
				"timesheet_hours": d.timesheet_hours,
				"leave_application": d.leave_application,
			}
			for d in doc.daily_entries
		],
	}


@frappe.whitelist()
def get_roll_call_summary(month_start, month_end):
	"""Get roll call summary statistics for a month.

	Args:
		month_start: Start date (YYYY-MM-DD)
		month_end: End date (YYYY-MM-DD)

	Returns:
		dict: Summary statistics
	"""
	employee = _get_current_employee_name()

	entries = frappe.get_all(
		"Roll Call Entry",
		filters={
			"employee": employee,
			"date": ["between", [month_start, month_end]],
		},
		fields=["presence_type"],
	)

	# Count by category
	summary = {
		"total_entries": len(entries),
		"working_days": 0,
		"leave_days": 0,
		"scheduled_days": 0,
	}

	for entry in entries:
		if entry.presence_type:
			category = frappe.db.get_value("Presence Type", entry.presence_type, "category")
			if category == "Working":
				summary["working_days"] += 1
			elif category == "Leave":
				summary["leave_days"] += 1
			elif category == "Scheduled":
				summary["scheduled_days"] += 1

	return summary


def _get_current_employee_name():
	"""Helper to get current user's employee ID.

	Returns:
		str: Employee name/ID

	Raises:
		frappe.AuthenticationError: If user is guest
		frappe.ValidationError: If no employee record found
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please login to continue"), frappe.AuthenticationError)

	employee = frappe.db.get_value(
		"Employee",
		{"user_id": user, "status": "Active"},
		"name"
	)

	if not employee:
		frappe.throw(_("No active employee record found for your user account"))

	return employee
