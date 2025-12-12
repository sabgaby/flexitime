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


def get_base_weekly_hours(company=None):
	"""Get base weekly hours from Company settings.
	
	Args:
		company: Company name (optional, defaults to default company)
		
	Returns:
		float: Base weekly hours (default: 40)
	"""
	if not company:
		company = frappe.defaults.get_defaults().get("company")
	
	if not company:
		return 40.0  # Default fallback
	
	base_hours = frappe.db.get_value("Company", company, "base_weekly_hours")
	return float(base_hours) if base_hours else 40.0


def get_leave_days_in_week(employee, week_start):
	"""Get list of leave days in a week with their properties.
	
	Returns approved leave applications that overlap with the week,
	with details about presence type, half-day status, and whether
	they deduct from flexitime balance.
	
	Args:
		employee: Employee ID
		week_start: Monday of the week (date object or string)
		
	Returns:
		list: List of dicts with {date, presence_type, is_half_day, deducts_from_balance, leave_application}
	"""
	week_start = getdate(week_start)
	week_end = add_days(week_start, 6)
	
	leave_days = []
	
	# Get approved leave applications that overlap with this week
	leave_apps = frappe.get_all("Leave Application",
		filters={
			"employee": employee,
			"status": "Approved",
			"docstatus": 1,
			"from_date": ["<=", week_end],
			"to_date": [">=", week_start]
		},
		fields=["name", "from_date", "to_date", "half_day", "half_day_date", "leave_type"]
	)
	
	for leave_app in leave_apps:
		# Get presence type for this leave type
		presence_type = frappe.db.get_value("Presence Type",
			{"leave_type": leave_app.leave_type, "requires_leave_application": 1},
			["name", "deducts_from_flextime_balance"],
			as_dict=True
		)
		
		if not presence_type:
			continue
		
		deducts_from_balance = presence_type.deducts_from_flextime_balance or 0
		
		# Iterate through each day of the leave
		current_date = getdate(leave_app.from_date)
		to_date = getdate(leave_app.to_date)
		
		while current_date <= to_date:
			# Only include dates within the week
			if week_start <= current_date <= week_end:
				# Check if this is a half-day
				is_half_day = bool(
					leave_app.half_day and
					leave_app.half_day_date and
					getdate(leave_app.half_day_date) == current_date
				)
				
				leave_days.append({
					"date": current_date,
					"presence_type": presence_type.name,
					"is_half_day": is_half_day,
					"deducts_from_balance": deducts_from_balance,
					"leave_application": leave_app.name
				})
			
			current_date = add_days(current_date, 1)
	
	return leave_days


@frappe.whitelist()
def calculate_weekly_expected_hours_with_holidays(employee, week_start):
	"""Calculate expected hours for a week accounting for FTE percentage, holidays, and leaves.
	
	Formula:
	1. Base weekly hours = Company.base_weekly_hours (default: 40)
	2. FTE weekly hours = base_weekly_hours * (fte_percentage / 100)
	3. Work days per week = count of days with > 0 hours in work pattern
	4. Daily average = FTE_weekly_hours / work_days_per_week
	5. Holidays count = count holidays in week (Mon-Sun) on work days
	6. Regular leaves count = count regular leave days (deducts_from_balance=0) on work days
	7. Half-day leaves count = count half-day regular leaves on work days
	8. Expected hours = FTE_weekly_hours - (holidays × daily_avg) - (regular_leaves × daily_avg) - (half_leaves × daily_avg/2)
	
	Note: Flex Off leaves (deducts_from_balance=1) do NOT reduce expected hours as they're
	already accounted in the work pattern.
	
	Args:
		employee: Employee ID
		week_start: Monday of the week (date object or string)
		
	Returns:
		float: Expected hours for the week (adjusted for holidays and leaves)
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern
	
	week_start = getdate(week_start)
	
	# Get employee's company
	company = frappe.db.get_value("Employee", employee, "company")
	if not company:
		company = frappe.defaults.get_defaults().get("company")
	
	# Get base weekly hours from Company
	base_weekly_hours = get_base_weekly_hours(company)
	
	# Get work pattern for the week
	pattern = get_work_pattern(employee, week_start)
	if not pattern:
		# Fallback: assume 40 hours if no pattern
		return base_weekly_hours
	
	# Calculate FTE weekly hours
	fte_percentage = pattern.fte_percentage or 100
	fte_weekly_hours = base_weekly_hours * (fte_percentage / 100)
	
	# Count work days per week (days with > 0 hours)
	work_days = 0
	days_of_week = [pattern.monday_hours, pattern.tuesday_hours, pattern.wednesday_hours,
	                pattern.thursday_hours, pattern.friday_hours, pattern.saturday_hours, pattern.sunday_hours]
	for hours in days_of_week:
		if (hours or 0) > 0:
			work_days += 1
	
	if work_days == 0:
		# No work days, return 0
		return 0.0
	
	# Calculate daily average
	daily_average = fte_weekly_hours / work_days
	
	# Count holidays in the week (only on work days)
	holidays_count = 0
	for i in range(7):
		date = add_days(week_start, i)
		if is_holiday(date, employee):
			# Only count holidays that fall on work days
			weekday = date.weekday()
			if weekday < len(days_of_week) and (days_of_week[weekday] or 0) > 0:
				holidays_count += 1
	
	# Get leave days in the week
	leave_days = get_leave_days_in_week(employee, week_start)
	
	# Count regular leave days (deducts_from_balance = 0) and half-days
	regular_leaves_count = 0
	half_leaves_count = 0
	
	for leave_day in leave_days:
		date = leave_day["date"]
		# Only count leaves that fall on work days
		weekday = date.weekday()
		if weekday < len(days_of_week) and (days_of_week[weekday] or 0) > 0:
			# Flex Off (deducts_from_balance = 1) doesn't reduce expected hours
			# They're already accounted in the work pattern
			if not leave_day["deducts_from_balance"]:
				if leave_day["is_half_day"]:
					half_leaves_count += 1
				else:
					regular_leaves_count += 1
	
	# Calculate expected hours:
	# FTE weekly - (holidays × daily_avg) - (regular_leaves × daily_avg) - (half_leaves × daily_avg/2)
	expected_hours = (
		fte_weekly_hours -
		(holidays_count * daily_average) -
		(regular_leaves_count * daily_average) -
		(half_leaves_count * daily_average / 2)
	)
	
	return max(0.0, expected_hours)  # Ensure non-negative
