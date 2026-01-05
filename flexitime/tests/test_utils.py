# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""
Test utilities and fixtures for Flexitime app tests
"""

import frappe
from frappe.utils import getdate, add_days, today, get_first_day, get_last_day


def create_test_employee(employee_name="_Test Flexitime Employee", company=None):
	"""Create a test employee for testing

	Args:
		employee_name: Name for the test employee
		company: Company name (defaults to _Test Company)

	Returns:
		Employee document
	"""
	if not company:
		company = frappe.defaults.get_defaults().get("company") or "_Test Company"

	# Ensure company exists
	if not frappe.db.exists("Company", company):
		frappe.get_doc({
			"doctype": "Company",
			"company_name": company,
			"abbr": company[:4].upper().replace(" ", ""),
			"default_currency": "EUR",
			"country": "Switzerland"
		}).insert(ignore_permissions=True)

	employee_id = f"_T-EMP-{frappe.utils.random_string(5)}"

	if frappe.db.exists("Employee", {"employee_name": employee_name}):
		return frappe.get_doc("Employee", {"employee_name": employee_name})

	doc = frappe.get_doc({
		"doctype": "Employee",
		"employee_name": employee_name,
		"first_name": employee_name.split()[0] if " " in employee_name else employee_name,
		"company": company,
		"status": "Active",
		"gender": "Other",
		"date_of_birth": "1990-01-01",
		"date_of_joining": "2020-01-01"
	})
	doc.insert(ignore_permissions=True)
	return doc


def create_test_work_pattern(employee, fte_percentage=100, valid_from=None,
							  monday=8, tuesday=8, wednesday=8, thursday=8, friday=8,
							  saturday=0, sunday=0, submit=True):
	"""Create a test work pattern for an employee

	Args:
		employee: Employee ID
		fte_percentage: FTE percentage (default 100)
		valid_from: Start date (defaults to year start)
		monday-sunday: Hours for each day
		submit: Whether to submit the pattern

	Returns:
		EmployeeWorkPattern document
	"""
	if not valid_from:
		valid_from = get_first_day(today())

	# Check for existing pattern
	existing = frappe.db.get_value("Employee Work Pattern", {
		"employee": employee,
		"valid_from": valid_from,
		"docstatus": ["<", 2]
	})
	if existing:
		return frappe.get_doc("Employee Work Pattern", existing)

	doc = frappe.get_doc({
		"doctype": "Employee Work Pattern",
		"employee": employee,
		"fte_percentage": fte_percentage,
		"valid_from": valid_from,
		"monday_hours": monday,
		"tuesday_hours": tuesday,
		"wednesday_hours": wednesday,
		"thursday_hours": thursday,
		"friday_hours": friday,
		"saturday_hours": saturday,
		"sunday_hours": sunday
	})
	doc.insert(ignore_permissions=True)

	if submit:
		doc.submit()

	return doc


def create_test_presence_types():
	"""Ensure required presence types exist for testing

	Returns:
		dict: Map of presence type names to documents
	"""
	presence_types = {}

	# Not working types (holiday, day_off)
	scheduled_types = [
		{"presence_name": "holiday", "label": "Holiday", "icon": "H", "expect_work_hours": 0},
		{"presence_name": "day_off", "label": "Day off", "icon": "D", "expect_work_hours": 0, "available_to_all": 1},
	]

	# Working types
	working_types = [
		{"presence_name": "office", "label": "Office", "icon": "O", "expect_work_hours": 1, "available_to_all": 1},
		{"presence_name": "home", "label": "Home", "icon": "H", "expect_work_hours": 1, "available_to_all": 1},
	]

	# Leave types
	leave_types = [
		{"presence_name": "vacation", "label": "Vacation", "icon": "V", "expect_work_hours": 0, "available_to_all": 1, "requires_leave_application": 1},
		{"presence_name": "sick", "label": "Sick", "icon": "S", "expect_work_hours": 0, "available_to_all": 1, "requires_leave_application": 1},
		{"presence_name": "flex_off", "label": "Flex Off", "icon": "F", "expect_work_hours": 1, "available_to_all": 1, "requires_leave_application": 1},
	]

	all_types = scheduled_types + working_types + leave_types

	for pt_data in all_types:
		pt_data["doctype"] = "Presence Type"
		name = pt_data["presence_name"]

		if frappe.db.exists("Presence Type", name):
			presence_types[name] = frappe.get_doc("Presence Type", name)
		else:
			doc = frappe.get_doc(pt_data)
			doc.insert(ignore_permissions=True)
			presence_types[name] = doc

	return presence_types


def create_test_roll_call_entry(employee, date, presence_type, source="Manual",
								is_half_day=False, notes=None):
	"""Create a test Roll Call Entry

	Args:
		employee: Employee ID
		date: Date for the entry
		presence_type: Presence Type name
		source: Source of entry (Manual, System, Leave)
		is_half_day: Whether this is a half-day
		notes: Optional notes

	Returns:
		RollCallEntry document
	"""
	date = getdate(date)

	# Check for existing entry
	existing = frappe.db.exists("Roll Call Entry", {
		"employee": employee,
		"date": date
	})
	if existing:
		doc = frappe.get_doc("Roll Call Entry", existing)
		doc.presence_type = presence_type
		doc.source = source
		doc.is_half_day = is_half_day
		if notes is not None:
			doc.notes = notes
		doc.save(ignore_permissions=True)
		return doc

	# Get presence type details
	pt = frappe.get_cached_value("Presence Type", presence_type,
		["icon", "label"], as_dict=True)

	doc = frappe.get_doc({
		"doctype": "Roll Call Entry",
		"employee": employee,
		"date": date,
		"presence_type": presence_type,
		"presence_type_icon": pt.icon if pt else None,
		"presence_type_label": pt.label if pt else None,
		"source": source,
		"is_half_day": is_half_day,
		"notes": notes
	})
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc


def create_test_weekly_entry(employee, week_start, submit=False):
	"""Create a test Weekly Entry with 7 daily entries

	Args:
		employee: Employee ID
		week_start: Monday of the week
		submit: Whether to submit the entry

	Returns:
		WeeklyEntry document
	"""
	week_start = getdate(week_start)

	# Ensure week_start is a Monday
	if week_start.weekday() != 0:
		raise ValueError("week_start must be a Monday")

	# Check for existing entry
	existing = frappe.db.exists("Weekly Entry", {
		"employee": employee,
		"week_start": week_start
	})
	if existing:
		return frappe.get_doc("Weekly Entry", existing)

	doc = frappe.get_doc({
		"doctype": "Weekly Entry",
		"employee": employee,
		"week_start": week_start
	})

	days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

	# Add 7 daily entries
	for i in range(7):
		date = add_days(week_start, i)

		# Get roll call entry if exists
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["presence_type", "leave_application", "is_half_day"],
			as_dict=True
		)

		presence_type = roll_call.presence_type if roll_call else None

		# Default expected hours (would normally come from work pattern)
		expected = 8 if i < 5 else 0  # Mon-Fri = 8, Sat-Sun = 0

		# Get presence type details
		icon = label = None
		if presence_type:
			pt = frappe.get_cached_value("Presence Type", presence_type,
				["icon", "label"], as_dict=True)
			if pt:
				icon = pt.icon
				label = pt.label

		doc.append("daily_entries", {
			"date": date,
			"day_of_week": days[i],
			"presence_type": presence_type,
			"presence_type_icon": icon,
			"presence_type_label": label,
			"expected_hours": expected,
			"actual_hours": expected,  # Default actual = expected
			"leave_application": roll_call.leave_application if roll_call else None
		})

	doc.insert(ignore_permissions=True)

	if submit:
		doc.submit()

	return doc


def create_test_holiday_list(year=None):
	"""Create a test Holiday List

	Args:
		year: Year for the holiday list (defaults to current year)

	Returns:
		HolidayList document name
	"""
	if not year:
		year = getdate(today()).year

	list_name = f"_Test Holiday List {year}"

	if frappe.db.exists("Holiday List", list_name):
		return list_name

	from_date = f"{year}-01-01"
	to_date = f"{year}-12-31"

	doc = frappe.get_doc({
		"doctype": "Holiday List",
		"holiday_list_name": list_name,
		"from_date": from_date,
		"to_date": to_date,
		"holidays": [
			{"holiday_date": f"{year}-01-01", "description": "New Year"},
			{"holiday_date": f"{year}-12-25", "description": "Christmas"},
			{"holiday_date": f"{year}-12-26", "description": "Boxing Day"},
		]
	})
	doc.insert(ignore_permissions=True)
	return list_name


def cleanup_test_data():
	"""Clean up test data created during tests"""
	# Delete in reverse dependency order
	frappe.db.sql("DELETE FROM `tabWeekly Entry` WHERE employee LIKE '_T-EMP-%'")
	frappe.db.sql("DELETE FROM `tabRoll Call Entry` WHERE employee LIKE '_T-EMP-%'")
	frappe.db.sql("DELETE FROM `tabEmployee Work Pattern` WHERE employee LIKE '_T-EMP-%'")
	frappe.db.sql("DELETE FROM `tabEmployee` WHERE name LIKE '_T-EMP-%'")
	frappe.db.commit()


def get_test_monday(weeks_offset=0):
	"""Get a Monday date for testing

	Args:
		weeks_offset: Number of weeks to offset from current week (can be negative)

	Returns:
		date: A Monday
	"""
	from flexitime.flexitime.utils import get_monday

	current_monday = get_monday(today())
	return add_days(current_monday, weeks_offset * 7)
