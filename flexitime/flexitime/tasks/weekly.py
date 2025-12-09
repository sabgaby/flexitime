# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import today, add_days, getdate

from flexitime.flexitime.utils import (
	get_monday, get_active_employees, format_date,
	get_users_with_role, send_email_template
)


def create_weekly_entries():
	"""Create Weekly Entry records for current week

	Runs Monday at 06:00
	"""
	from flexitime.flexitime.doctype.weekly_entry.weekly_entry import create_weekly_entry

	week_start = get_monday(today())
	employees = get_active_employees()
	created_count = 0

	for employee in employees:
		existing = frappe.db.exists("Weekly Entry", {
			"employee": employee.name,
			"week_start": week_start
		})

		if not existing:
			try:
				create_weekly_entry(employee.name, week_start)
				created_count += 1
			except Exception as e:
				frappe.log_error(
					f"Failed to create Weekly Entry for {employee.name}: {str(e)}",
					"Flexitime Weekly Entry Error"
				)

	frappe.db.commit()
	frappe.logger().info(f"Created {created_count} Weekly Entries for week of {week_start}")


def calculate_weekly_balances():
	"""Recalculate running flexitime balance for all employees

	Runs Monday at 01:00
	"""
	employees = get_active_employees()

	for employee in employees:
		# Get all Weekly Entries ordered by date
		entries = frappe.get_all("Weekly Entry",
			filters={"employee": employee.name, "docstatus": 1},  # Submitted
			fields=["name", "week_start", "weekly_delta"],
			order_by="week_start asc"
		)

		running_balance = 0
		for entry in entries:
			frappe.db.set_value("Weekly Entry", entry.name, {
				"previous_balance": running_balance,
				"running_balance": running_balance + (entry.weekly_delta or 0)
			}, update_modified=False)
			running_balance = running_balance + (entry.weekly_delta or 0)

		# Update custom field on Employee
		frappe.db.set_value("Employee", employee.name,
			"custom_flexitime_balance", running_balance)

	frappe.db.commit()
	frappe.logger().info(f"Recalculated balances for {len(employees)} employees")


def send_roll_call_reminders():
	"""Email employees to fill roll call for next week

	Runs Friday at 09:00
	"""
	next_week_start = add_days(get_monday(today()), 7)
	next_week_end = add_days(next_week_start, 6)

	employees = get_active_employees()
	reminded_count = 0

	for employee in employees:
		if not employee.user_id:
			continue

		missing_days = get_missing_roll_call_days(employee.name, next_week_start, next_week_end)

		if missing_days:
			send_email_template(
				template="Roll Call Reminder",
				recipients=[employee.user_id],
				context={
					"employee_name": employee.employee_name,
					"week_start": format_date(next_week_start),
					"week_end": format_date(next_week_end),
					"missing_days": ", ".join(missing_days),
					"roll_call_url": frappe.utils.get_url("/app/roll-call")
				}
			)
			reminded_count += 1

	frappe.logger().info(f"Sent roll call reminders to {reminded_count} employees")


def send_timesheet_reminders():
	"""Email employees with unsubmitted Weekly Entry

	Runs Friday at 14:00
	"""
	week_start = get_monday(today())

	employees = get_active_employees()
	reminded_count = 0

	for employee in employees:
		if not employee.user_id:
			continue

		entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee.name,
			"week_start": week_start
		}, ["name", "docstatus", "total_actual_hours"], as_dict=True)

		if not entry or entry.docstatus == 0:  # Draft
			send_email_template(
				template="Timesheet Reminder",
				recipients=[employee.user_id],
				context={
					"employee_name": employee.employee_name,
					"week_start": format_date(week_start),
					"week_end": format_date(add_days(week_start, 6)),
					"status": "Draft" if entry else "Not Started",
					"hours_logged": entry.total_actual_hours if entry else 0,
					"weekly_entry_url": frappe.utils.get_url(
						f"/app/weekly-entry/{entry.name}" if entry else "/app/weekly-entry/new"
					)
				}
			)
			reminded_count += 1

	frappe.logger().info(f"Sent timesheet reminders to {reminded_count} employees")


def send_missing_timesheet_alerts():
	"""Email about missing timesheets from last week + notify HR

	Runs Monday at 09:00
	"""
	last_week_start = add_days(get_monday(today()), -7)
	missing_employees = []

	employees = get_active_employees()

	for employee in employees:
		entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee.name,
			"week_start": last_week_start
		}, ["name", "docstatus"], as_dict=True)

		if not entry or entry.docstatus == 0:  # Draft or not created
			missing_employees.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"status": "Draft" if entry else "Not Created"
			})

			# Email the employee
			if employee.user_id:
				send_email_template(
					template="Missing Timesheet Alert",
					recipients=[employee.user_id],
					context={
						"employee_name": employee.employee_name,
						"week_start": format_date(last_week_start),
						"week_end": format_date(add_days(last_week_start, 6))
					}
				)

	# Notify HR of all missing
	if missing_employees:
		hr_users = get_users_with_role("HR Manager")
		send_email_template(
			template="HR Missing Timesheet Summary",
			recipients=hr_users,
			context={
				"week_start": format_date(last_week_start),
				"missing_count": len(missing_employees),
				"missing_employees": missing_employees
			}
		)

	frappe.logger().info(f"Found {len(missing_employees)} missing timesheets from last week")


def check_balance_limits():
	"""Check for employees exceeding flexitime limits

	Runs Monday at 08:00
	"""
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
			# Over limit
			alerts.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"balance": balance,
				"limit": limit,
				"status": "over"
			})

			if employee.user_id:
				send_email_template(
					template="Balance Over Limit",
					recipients=[employee.user_id],
					context={
						"employee_name": employee.employee_name,
						"balance": balance,
						"limit": limit,
						"over_by": abs(balance) - limit
					}
				)

		elif abs(balance) > limit * 0.8:
			# Approaching limit (80%)
			alerts.append({
				"employee": employee.name,
				"employee_name": employee.employee_name,
				"balance": balance,
				"limit": limit,
				"status": "warning"
			})

			if employee.user_id:
				send_email_template(
					template="Balance Warning",
					recipients=[employee.user_id],
					context={
						"employee_name": employee.employee_name,
						"balance": balance,
						"limit": limit,
						"percentage": int(abs(balance) / limit * 100)
					}
				)

	# Notify HR of all alerts
	if alerts:
		hr_users = get_users_with_role("HR Manager")
		send_email_template(
			template="HR Balance Alerts Summary",
			recipients=hr_users,
			context={"alerts": alerts}
		)

	frappe.logger().info(f"Found {len(alerts)} balance alerts")


def get_missing_roll_call_days(employee, week_start, week_end):
	"""Return list of days without Roll Call Entry that need one

	Args:
		employee: Employee ID
		week_start: Monday of the week
		week_end: Sunday of the week

	Returns:
		list: Day names missing roll call
	"""
	from flexitime.flexitime.doctype.presence_type.presence_type import get_auto_presence_type

	missing = []
	current_date = getdate(week_start)
	week_end = getdate(week_end)
	days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

	while current_date <= week_end:
		# Check if entry exists
		entry = frappe.db.exists("Roll Call Entry", {
			"employee": employee,
			"date": current_date
		})

		if not entry:
			# Check if this day needs an entry (not auto-created as weekend/holiday/day_off)
			auto_type, source, _ = get_auto_presence_type(employee, current_date)
			if not auto_type or source != "System":
				# Needs manual entry
				missing.append(days[current_date.weekday()])

		current_date = add_days(current_date, 1)

	return missing


def send_submission_reminders():
	"""Send reminders to employees who haven't submitted their Weekly Entry

	Runs based on Flexitime Settings (e.g., every Monday at 09:00)
	"""
	# Get settings
	settings = frappe.get_cached_doc("Flexitime Settings")

	if not settings.enable_submission_reminders:
		return

	# Check if today is the reminder day
	today_day = frappe.utils.get_weekday(today())
	reminder_day = settings.submission_reminder_day or "Monday"

	if today_day.capitalize() != reminder_day:
		return

	# Get last week's start date
	last_week_start = add_days(get_monday(today()), -7)

	employees = get_active_employees()
	reminded_count = 0

	for employee in employees:
		if not employee.user_id:
			continue

		entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee.name,
			"week_start": last_week_start
		}, ["name", "docstatus"], as_dict=True)

		# Remind if entry doesn't exist or is still draft
		if not entry or entry.docstatus == 0:
			template = settings.reminder_email_template or "Timesheet Reminder"

			send_email_template(
				template=template,
				recipients=[employee.user_id],
				context={
					"employee_name": employee.employee_name,
					"week_start": format_date(last_week_start),
					"week_end": format_date(add_days(last_week_start, 6)),
					"status": "Draft" if entry else "Not Started",
					"weekly_entry_url": frappe.utils.get_url(
						f"/app/weekly-entry/{entry.name}" if entry else "/app/weekly-entry/new"
					)
				}
			)
			reminded_count += 1

	frappe.logger().info(f"Sent submission reminders to {reminded_count} employees")
