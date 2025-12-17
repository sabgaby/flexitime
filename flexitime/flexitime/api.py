# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Dashboard and general API endpoints for Flexitime.

This module provides API endpoints for the Flexitime Dashboard and general
operations like sending reminders. These endpoints are primarily used by
the HR Dashboard page.

API Endpoints (whitelisted):
    Dashboard Data:
        get_today_overview: Count employees by presence type for today
        get_balance_alerts: Get employees with balance warnings (HR only)
        get_missing_roll_call_next_week: Get employees missing Roll Call
        get_missing_timesheets: Get employees with missing Weekly Entries

    Reminders (HR only):
        send_reminder: Send reminder to a specific employee
        send_all_reminders: Send reminders to all employees with missing data

    Data Retrieval:
        get_roll_call_data: Get Roll Call data for a week

    Legacy:
        update_roll_call: Create/update Roll Call entry (use roll_call.save_entry instead)

Permission Model:
    - Dashboard endpoints are readable by all logged-in users
    - Balance alerts and reminders require HR Manager role
    - update_roll_call respects Roll Call Entry permissions

Dependencies:
    - frappe
    - flexitime.flexitime.utils
    - flexitime.flexitime.tasks.weekly
    - flexitime.flexitime.doctype.employee_work_pattern
"""

import frappe
from frappe import _
from frappe.utils import today, add_days, getdate

from flexitime.flexitime.utils import (
	get_monday, get_active_employees, format_date,
	send_email_template
)


@frappe.whitelist()
def get_today_overview(date=None):
	"""Get count of employees by presence type for today

	Args:
		date: Date to get overview for (default: today)

	Returns:
		dict: Counts by presence type category
	"""
	date = getdate(date) if date else getdate(today())

	# Get all roll call entries for today
	entries = frappe.get_all("Roll Call Entry",
		filters={"date": date},
		fields=["presence_type"]
	)

	# Count by presence type
	counts = {}
	for entry in entries:
		pt = frappe.get_cached_value("Presence Type", entry.presence_type,
			["name", "category"], as_dict=True)
		if pt:
			key = entry.presence_type
			counts[key] = counts.get(key, 0) + 1

	return counts


@frappe.whitelist()
def get_balance_alerts():
	"""Get employees with balance alerts.

	Requires HR Manager role.

	Returns:
		list: Employees with balance warnings or over limit

	Raises:
		frappe.PermissionError: If user is not HR Manager
	"""
	if "HR Manager" not in frappe.get_roles():
		frappe.throw(_("Only HR Managers can view balance alerts"), frappe.PermissionError)

	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	alerts = []
	employees = get_active_employees()

	for employee in employees:
		pattern = get_work_pattern(employee.name, today())
		if not pattern:
			continue

		limit = pattern.flexitime_limit_hours
		balance = frappe.get_value("Employee", employee.name, "custom_flexitime_balance") or 0

		if abs(balance) > limit:
			alerts.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"balance": balance,
				"limit": limit,
				"status": "over"
			})
		elif abs(balance) > limit * 0.8:
			alerts.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"balance": balance,
				"limit": limit,
				"status": "warning"
			})

	# Sort by severity and balance
	alerts.sort(key=lambda x: (0 if x["status"] == "over" else 1, -abs(x["balance"])))

	return alerts


@frappe.whitelist()
def get_missing_roll_call_next_week():
	"""Get employees missing roll call for next week

	Returns:
		list: Employees with missing days
	"""
	from flexitime.flexitime.tasks.weekly import get_missing_roll_call_days

	next_week_start = add_days(get_monday(today()), 7)
	next_week_end = add_days(next_week_start, 6)

	missing = []
	employees = get_active_employees()

	for employee in employees:
		missing_days = get_missing_roll_call_days(employee.name, next_week_start, next_week_end)
		if missing_days:
			missing.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"missing_days": missing_days
			})

	return missing


@frappe.whitelist()
def get_missing_timesheets():
	"""Get employees with missing or draft timesheets

	Returns:
		list: Employees with missing timesheets
	"""
	# Check last week and current week
	current_week = get_monday(today())
	last_week = add_days(current_week, -7)

	missing = []
	employees = get_active_employees()

	for employee in employees:
		# Check last week
		last_entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee.name,
			"week_start": last_week
		}, ["name", "status", "total_actual_hours", "total_expected_hours"], as_dict=True)

		if not last_entry or last_entry.status == "Draft":
			missing.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"week_start": str(last_week),
				"status": last_entry.status if last_entry else "Not Created",
				"hours_logged": last_entry.total_actual_hours if last_entry else 0,
				"expected_hours": last_entry.total_expected_hours if last_entry else 40
			})

		# Check current week
		current_entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee.name,
			"week_start": current_week
		}, ["name", "status", "total_actual_hours", "total_expected_hours"], as_dict=True)

		if not current_entry or current_entry.status == "Draft":
			# Only add if not already in list for last week
			if not any(m["employee"] == employee.name for m in missing):
				missing.append({
					"employee": employee.name,
					"employee_name": employee.employee_name,
					"week_start": str(current_week),
					"status": current_entry.status if current_entry else "Not Created",
					"hours_logged": current_entry.total_actual_hours if current_entry else 0,
					"expected_hours": current_entry.total_expected_hours if current_entry else 40
				})

	return missing


@frappe.whitelist()
def send_reminder(employee, reminder_type):
	"""Send reminder to a specific employee.

	Requires HR Manager role.

	Args:
		employee: Employee ID
		reminder_type: 'roll-call' or 'timesheet'

	Raises:
		frappe.PermissionError: If user is not HR Manager
	"""
	if "HR Manager" not in frappe.get_roles():
		frappe.throw(_("Only HR Managers can send reminders"), frappe.PermissionError)

	emp = frappe.get_doc("Employee", employee)

	if not emp.user_id:
		frappe.throw(_("Employee has no linked user"))

	if reminder_type == "roll-call":
		next_week_start = add_days(get_monday(today()), 7)
		next_week_end = add_days(next_week_start, 6)

		from flexitime.flexitime.tasks.weekly import get_missing_roll_call_days
		missing_days = get_missing_roll_call_days(employee, next_week_start, next_week_end)

		send_email_template(
			template="Roll Call Reminder",
			recipients=[emp.user_id],
			context={
				"employee_name": emp.employee_name,
				"week_start": format_date(next_week_start),
				"week_end": format_date(next_week_end),
				"missing_days": ", ".join(missing_days),
				"roll_call_url": frappe.utils.get_url("/app/roll-call")
			}
		)

	elif reminder_type == "timesheet":
		week_start = get_monday(today())

		send_email_template(
			template="Timesheet Reminder",
			recipients=[emp.user_id],
			context={
				"employee_name": emp.employee_name,
				"week_start": format_date(week_start),
				"week_end": format_date(add_days(week_start, 6)),
				"weekly_entry_url": frappe.utils.get_url("/app/weekly-entry")
			}
		)

	frappe.msgprint(_("Reminder sent to {0}").format(emp.employee_name))


@frappe.whitelist()
def send_all_reminders(reminder_type):
	"""Send reminders to all employees with missing data.

	Requires HR Manager role.

	Args:
		reminder_type: 'roll-call' or 'timesheet'

	Raises:
		frappe.PermissionError: If user is not HR Manager
	"""
	if "HR Manager" not in frappe.get_roles():
		frappe.throw(_("Only HR Managers can send reminders"), frappe.PermissionError)

	if reminder_type == "roll-call":
		missing = get_missing_roll_call_next_week()
		for emp in missing:
			try:
				send_reminder(emp["employee"], reminder_type)
			except Exception as e:
				frappe.log_error(f"Failed to send reminder to {emp['employee']}: {str(e)}")

	elif reminder_type == "timesheet":
		missing = get_missing_timesheets()
		for emp in missing:
			try:
				send_reminder(emp["employee"], reminder_type)
			except Exception as e:
				frappe.log_error(f"Failed to send reminder to {emp['employee']}: {str(e)}")

	frappe.msgprint(_("Reminders sent"))


@frappe.whitelist()
def get_roll_call_data(week_start, department=None):
	"""Get all roll call data for a week

	Args:
		week_start: Monday of the week
		department: Optional department filter

	Returns:
		dict: employees, presence_types, entries, current_employee
	"""
	week_start = getdate(week_start)
	week_end = add_days(week_start, 6)

	# Get current employee
	current_employee = frappe.db.get_value("Employee",
		{"user_id": frappe.session.user}, "name")

	# Get presence types
	presence_types = frappe.get_all("Presence Type",
		fields=["name", "label", "icon", "category", "color", "is_system"],
		order_by="sort_order asc"
	)

	# Get employees
	emp_filters = {"status": "Active"}
	if department:
		emp_filters["department"] = department

	employees = frappe.get_all("Employee",
		filters=emp_filters,
		fields=["name", "employee_name", "department"],
		order_by="employee_name asc"
	)

	# Get roll call entries for the week
	entries_list = frappe.get_all("Roll Call Entry",
		filters={
			"date": ["between", [week_start, week_end]]
		},
		fields=["name", "employee", "date", "presence_type", "presence_type_icon",
				"presence_type_label", "is_half_day", "source", "is_locked", "notes"]
	)

	# Index entries by employee-date
	entries = {}
	for entry in entries_list:
		key = f"{entry.employee}-{entry.date}"
		entries[key] = entry

	return {
		"employees": employees,
		"presence_types": presence_types,
		"entries": entries,
		"current_employee": current_employee
	}


@frappe.whitelist()
def update_roll_call(employee, date, presence_type, notes=None):
	"""Create or update a Roll Call Entry.

	Note: This is a legacy wrapper. For new code, use
	flexitime.api.roll_call.save_entry which has better validation.

	Args:
		employee: Employee ID
		date: Date string
		presence_type: Presence Type name
		notes: Optional notes

	Returns:
		str: Roll Call Entry name
	"""
	# Delegate to the doctype's function to avoid code duplication
	from flexitime.flexitime.doctype.roll_call_entry.roll_call_entry import (
		update_roll_call as _update_roll_call
	)
	return _update_roll_call(employee, date, presence_type, notes)
