# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, add_days, now_datetime


class WeeklyEntry(Document):
	def validate(self):
		self.set_week_end()
		self.validate_week_start_is_monday()
		self.validate_locked()
		self.calculate_totals()

	def set_week_end(self):
		"""Auto-set week_end to 6 days after week_start"""
		if self.week_start:
			self.week_end = add_days(getdate(self.week_start), 6)

	def validate_week_start_is_monday(self):
		"""Ensure week_start is a Monday"""
		if self.week_start:
			week_start = getdate(self.week_start)
			if week_start.weekday() != 0:
				frappe.throw(_("Week Start must be a Monday"))

	def validate_locked(self):
		"""Prevent editing if entry is locked (unless HR Manager)"""
		if self.is_locked and not self.is_new():
			if "HR Manager" not in frappe.get_roles():
				frappe.throw(_("This Weekly Entry is locked and cannot be edited"))

	def calculate_totals(self):
		"""Calculate all totals from daily entries"""
		self.total_actual_hours = sum(d.actual_hours or 0 for d in self.daily_entries)
		self.total_expected_hours = sum(d.expected_hours or 0 for d in self.daily_entries)
		self.weekly_delta = self.total_actual_hours - self.total_expected_hours
		self.timesheet_hours = sum(d.timesheet_hours or 0 for d in self.daily_entries)

		# Calculate differences for each daily entry
		for d in self.daily_entries:
			d.difference = (d.actual_hours or 0) - (d.expected_hours or 0)

		# Get previous week's balance
		prev_entry = get_previous_weekly_entry(self.employee, self.week_start)
		self.previous_balance = prev_entry.running_balance if prev_entry else 0
		self.running_balance = self.previous_balance + self.weekly_delta

	def before_save(self):
		"""Sync presence types from Roll Call before save"""
		if self.docstatus == 0:  # Only sync in draft mode
			self.sync_roll_call_entries()

	def sync_roll_call_entries(self):
		"""Pull presence type from Roll Call Entries"""
		for daily in self.daily_entries:
			roll_call = frappe.db.get_value("Roll Call Entry",
				{"employee": self.employee, "date": daily.date},
				["presence_type", "leave_application", "is_half_day"],
				as_dict=True
			)

			if roll_call:
				daily.presence_type = roll_call.presence_type
				daily.leave_application = roll_call.leave_application

				# Fetch icon and label
				if roll_call.presence_type:
					pt = frappe.get_cached_value("Presence Type", roll_call.presence_type,
						["icon", "label"], as_dict=True)
					if pt:
						daily.presence_type_icon = pt.icon
						daily.presence_type_label = pt.label

				# Recalculate expected hours based on presence type
				daily.expected_hours = calculate_expected_hours(
					self.employee, daily.date, roll_call.presence_type, roll_call.is_half_day
				)

	def on_submit(self):
		"""When submitted, update employee balance and record timestamp"""
		self.db_set("submitted_on", now_datetime())
		self.update_employee_balance()

	def on_cancel(self):
		"""When cancelled, recalculate balances"""
		# Recalculate future weeks' balances
		recalculate_future_balances(self.employee, self.week_start)

	def on_update_after_submit(self):
		"""When amended after submit (by HR), cascade recalculate"""
		self.calculate_totals()
		self.update_employee_balance()
		recalculate_future_balances(self.employee, self.week_start)

	def update_employee_balance(self):
		"""Update the custom flexitime balance on Employee"""
		# Get the latest submitted entry for this employee
		latest = frappe.db.sql("""
			SELECT running_balance FROM `tabWeekly Entry`
			WHERE employee = %s AND docstatus = 1
			ORDER BY week_start DESC
			LIMIT 1
		""", (self.employee,), as_dict=True)

		if latest:
			frappe.db.set_value("Employee", self.employee,
				"custom_flexitime_balance", latest[0].running_balance)


def get_previous_weekly_entry(employee, week_start):
	"""Get the previous week's submitted Weekly Entry for balance calculation

	Args:
		employee: Employee ID
		week_start: Monday of the current week

	Returns:
		Weekly Entry doc or None
	"""
	week_start = getdate(week_start)
	prev_week_start = add_days(week_start, -7)

	# Look for submitted entry first
	entry_name = frappe.db.get_value("Weekly Entry",
		{"employee": employee, "week_start": prev_week_start, "docstatus": 1},
		"name"
	)

	# Fall back to draft if no submitted
	if not entry_name:
		entry_name = frappe.db.get_value("Weekly Entry",
			{"employee": employee, "week_start": prev_week_start, "docstatus": 0},
			"name"
		)

	if entry_name:
		return frappe.get_doc("Weekly Entry", entry_name)

	return None


def recalculate_future_balances(employee, from_week_start):
	"""Recalculate running balances for all weeks after the given week

	Args:
		employee: Employee ID
		from_week_start: Starting week (recalculate weeks after this)
	"""
	from_week_start = getdate(from_week_start)

	# Get all submitted weekly entries after this week
	future_entries = frappe.get_all("Weekly Entry",
		filters={
			"employee": employee,
			"week_start": [">", from_week_start],
			"docstatus": 1
		},
		fields=["name"],
		order_by="week_start asc"
	)

	for entry in future_entries:
		doc = frappe.get_doc("Weekly Entry", entry.name)
		# Recalculate with updated previous balance
		prev_entry = get_previous_weekly_entry(employee, doc.week_start)
		doc.previous_balance = prev_entry.running_balance if prev_entry else 0
		doc.running_balance = doc.previous_balance + doc.weekly_delta
		doc.db_set("previous_balance", doc.previous_balance)
		doc.db_set("running_balance", doc.running_balance)

	# Update employee's current balance
	latest = frappe.db.sql("""
		SELECT running_balance FROM `tabWeekly Entry`
		WHERE employee = %s AND docstatus = 1
		ORDER BY week_start DESC
		LIMIT 1
	""", (employee,), as_dict=True)

	if latest:
		frappe.db.set_value("Employee", employee,
			"custom_flexitime_balance", latest[0].running_balance)


def calculate_expected_hours(employee, date, presence_type, is_half_day=False):
	"""Calculate expected hours based on presence type and work pattern

	Logic:
	- System types (weekend, holiday, day_off): expected = 0
	- Leave types with deducts_from_flextime_balance (flex_off): expected = pattern hours
	- Regular leave (vacation, sick): expected = 0 (neutral balance impact)
	- Working types (office, home, etc): expected = pattern hours

	Args:
		employee: Employee ID
		date: The date
		presence_type: Presence Type name
		is_half_day: Whether this is a half-day leave

	Returns:
		float: Expected hours
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	if not presence_type:
		return 0

	# Get presence type settings
	pt = frappe.get_cached_value("Presence Type", presence_type,
		["category", "is_system", "requires_leave_application", "deducts_from_flextime_balance"],
		as_dict=True)

	if not pt:
		return 0

	# System types (weekend, holiday, day_off): expected = 0
	if pt.is_system:
		return 0

	# Get normal hours from Work Pattern
	pattern = get_work_pattern(employee, date)
	normal_hours = pattern.get_hours_for_weekday(date) if pattern else 8

	# Leave types that require approval
	if pt.requires_leave_application:
		# Flex Off types: keep pattern hours so balance is deducted
		if pt.deducts_from_flextime_balance:
			if is_half_day:
				return normal_hours / 2
			return normal_hours

		# Regular leave (vacation, sick): expected = 0 (neutral balance)
		if is_half_day:
			# Half day leave = half of normal hours
			return normal_hours / 2
		return 0

	# Scheduled category without is_system (should not happen, but handle it)
	if pt.category == "Scheduled":
		return 0

	# Working category = hours from Work Pattern
	return normal_hours


def get_timesheet_hours(employee, date):
	"""Sum all submitted timesheet hours for employee on date

	Args:
		employee: Employee ID
		date: The date

	Returns:
		float: Total timesheet hours
	"""
	result = frappe.db.sql("""
		SELECT COALESCE(SUM(td.hours), 0) as total_hours
		FROM `tabTimesheet Detail` td
		JOIN `tabTimesheet` t ON t.name = td.parent
		WHERE t.employee = %s
		AND DATE(td.from_time) = %s
		AND t.docstatus = 1
	""", (employee, date), as_dict=True)

	return result[0].total_hours if result else 0


@frappe.whitelist()
def get_week_data(employee, week_start):
	"""Get daily entry data for a week (used by client to auto-populate)

	Args:
		employee: Employee ID
		week_start: Monday of the week

	Returns:
		dict: {days: [...], previous_balance: float}
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	week_start = getdate(week_start)
	days_of_week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
	days = []

	for i in range(7):
		date = add_days(week_start, i)

		# Get roll call entry if exists
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["presence_type", "leave_application", "is_half_day"],
			as_dict=True
		)

		presence_type = roll_call.presence_type if roll_call else None
		is_half_day = roll_call.is_half_day if roll_call else False
		leave_application = roll_call.leave_application if roll_call else None

		# Get expected hours from work pattern
		expected = calculate_expected_hours(employee, date, presence_type, is_half_day)

		# Default expected if no roll call
		if expected == 0 and not roll_call:
			pattern = get_work_pattern(employee, date)
			expected = pattern.get_hours_for_weekday(date) if pattern else 8

		# Get presence type details
		icon = label = None
		if presence_type:
			pt = frappe.get_cached_value("Presence Type", presence_type,
				["icon", "label"], as_dict=True)
			if pt:
				icon = pt.icon
				label = pt.label

		days.append({
			"date": str(date),
			"day_of_week": days_of_week[i],
			"expected_hours": expected,
			"actual_hours": expected,  # Default actual = expected
			"presence_type": presence_type,
			"presence_type_icon": icon,
			"presence_type_label": label,
			"leave_application": leave_application
		})

	# Get previous week's balance
	prev_entry = get_previous_weekly_entry(employee, week_start)
	previous_balance = prev_entry.running_balance if prev_entry else 0

	return {
		"days": days,
		"previous_balance": previous_balance
	}


@frappe.whitelist()
def create_weekly_entry(employee, week_start):
	"""Create a new Weekly Entry with 7 Daily Entry rows

	Args:
		employee: Employee ID
		week_start: Monday of the week

	Returns:
		str: Weekly Entry name
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	week_start = getdate(week_start)

	# Check if already exists
	existing = frappe.db.exists("Weekly Entry", {"employee": employee, "week_start": week_start})
	if existing:
		return existing

	doc = frappe.get_doc({
		"doctype": "Weekly Entry",
		"employee": employee,
		"week_start": week_start
	})

	days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

	# Add 7 daily entries
	for i in range(7):
		date = add_days(week_start, i)

		# Get roll call entry
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["presence_type", "leave_application", "is_half_day"],
			as_dict=True
		)

		presence_type = roll_call.presence_type if roll_call else None
		is_half_day = roll_call.is_half_day if roll_call else False
		leave_application = roll_call.leave_application if roll_call else None

		# Get expected hours
		expected = calculate_expected_hours(employee, date, presence_type, is_half_day)

		# Get timesheet hours
		ts_hours = get_timesheet_hours(employee, date)

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
			"timesheet_hours": ts_hours,
			"leave_application": leave_application
		})

	doc.insert()
	return doc.name


@frappe.whitelist()
def lock_weekly_entry(name):
	"""Lock a submitted Weekly Entry (HR only)

	Args:
		name: Weekly Entry name
	"""
	if "HR Manager" not in frappe.get_roles():
		frappe.throw(_("Only HR Manager can lock Weekly Entries"))

	doc = frappe.get_doc("Weekly Entry", name)

	if doc.docstatus != 1:
		frappe.throw(_("Only submitted entries can be locked"))

	if doc.is_locked:
		frappe.throw(_("Entry is already locked"))

	doc.db_set("is_locked", 1)
	doc.db_set("locked_on", now_datetime())

	frappe.msgprint(_("Weekly Entry has been locked"))


@frappe.whitelist()
def unlock_weekly_entry(name):
	"""Unlock a locked Weekly Entry (HR only)

	Args:
		name: Weekly Entry name
	"""
	if "HR Manager" not in frappe.get_roles():
		frappe.throw(_("Only HR Manager can unlock Weekly Entries"))

	doc = frappe.get_doc("Weekly Entry", name)

	if not doc.is_locked:
		frappe.throw(_("Entry is not locked"))

	doc.db_set("is_locked", 0)
	doc.db_set("locked_on", None)

	frappe.msgprint(_("Weekly Entry has been unlocked"))
