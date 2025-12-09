# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, add_days


def get_work_pattern(employee, date):
	"""Get the active work pattern for an employee on a specific date

	Args:
		employee: Employee ID
		date: The date to check

	Returns:
		EmployeeWorkPattern document or None
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern as _get_work_pattern
	return _get_work_pattern(employee, date)


def is_holiday(date, employee=None):
	"""Check if date is in active Holiday List

	Args:
		date: The date to check
		employee: Optional employee to get specific holiday list

	Returns:
		bool: True if date is a holiday
	"""
	date = getdate(date)

	# Get Holiday List - could be company default or employee-specific
	holiday_list = None

	if employee:
		holiday_list = frappe.get_value("Employee", employee, "holiday_list")

	if not holiday_list:
		company = frappe.defaults.get_defaults().get("company")
		if company:
			holiday_list = frappe.get_value("Company", company, "default_holiday_list")

	if not holiday_list:
		return False

	return frappe.db.exists("Holiday", {
		"parent": holiday_list,
		"holiday_date": date
	})


def get_monday(date):
	"""Get the Monday of the week containing the given date

	Args:
		date: Any date

	Returns:
		date: Monday of that week
	"""
	date = getdate(date)
	days_since_monday = date.weekday()
	return add_days(date, -days_since_monday)


def get_active_employees():
	"""Get list of active employees

	Returns:
		list: Active Employee documents
	"""
	return frappe.get_all("Employee",
		filters={"status": "Active"},
		fields=["name", "employee_name", "user_id", "department", "holiday_list"]
	)


def is_timesheet_user(employee):
	"""Check if employee is expected to use Timesheets

	Args:
		employee: Employee ID

	Returns:
		bool: True if employee should use Timesheets
	"""
	# Check if employee has custom field set
	uses_timesheet = frappe.get_value("Employee", employee, "custom_uses_timesheet")
	if uses_timesheet is not None:
		return uses_timesheet

	# Fallback: check if they have any submitted timesheets
	has_timesheets = frappe.db.exists("Timesheet", {
		"employee": employee,
		"docstatus": 1
	})

	return bool(has_timesheets)


def format_date(date):
	"""Format date for display

	Args:
		date: Date to format

	Returns:
		str: Formatted date string
	"""
	return frappe.utils.formatdate(getdate(date))


def get_users_with_role(role):
	"""Get list of user IDs with a specific role

	Args:
		role: Role name

	Returns:
		list: User IDs
	"""
	return frappe.get_all("Has Role",
		filters={"role": role, "parenttype": "User"},
		pluck="parent"
	)


def send_email_template(template, recipients, context):
	"""Send email using a template

	Args:
		template: Email Template name
		recipients: List of email addresses
		context: Dictionary of context variables
	"""
	if not recipients:
		return

	try:
		email_template = frappe.get_doc("Email Template", template)
		subject = frappe.render_template(email_template.subject, context)
		message = frappe.render_template(email_template.response, context)

		frappe.sendmail(
			recipients=recipients,
			subject=subject,
			message=message,
			now=True
		)
	except frappe.DoesNotExistError:
		frappe.log_error(f"Email template '{template}' not found", "Flexitime Email Error")
	except Exception as e:
		frappe.log_error(f"Failed to send email: {str(e)}", "Flexitime Email Error")
