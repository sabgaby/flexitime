# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, add_days, now_datetime, today, format_date


class WeeklyEntry(Document):
	def autoname(self):
		"""Generate name using employee and ISO calendar week.

		Format: {employee}-{year}-W{week_number}
		Example: HR-EMP-00001-2025-W03

		Uses ISO week numbering where Week 1 is the first week with a Thursday.
		Also sets the calendar_week field for display and filtering.
		"""
		if self.employee and self.week_start:
			week_start = getdate(self.week_start)
			# ISO week number (1-53)
			iso_calendar = week_start.isocalendar()
			year = iso_calendar[0]  # ISO year (can differ from calendar year at year boundaries)
			week_num = iso_calendar[1]
			self.name = f"{self.employee}-{year}-W{week_num:02d}"
			# Set calendar_week field for display and filtering
			self.calendar_week = f"{year}-W{week_num:02d}"

	def validate(self):
		self.set_week_end()
		self.set_calendar_week()
		self.validate_week_start_is_monday()
		self.validate_locked()
		self.validate_no_hours_on_leave_days()
		self.validate_sequential_submission()
		self.validate_week_complete()
		self.calculate_totals()

	def set_calendar_week(self):
		"""Set calendar_week field from week_start using ISO week numbering."""
		if self.week_start:
			week_start = getdate(self.week_start)
			iso_calendar = week_start.isocalendar()
			year = iso_calendar[0]
			week_num = iso_calendar[1]
			self.calendar_week = f"{year}-W{week_num:02d}"

	def validate_no_hours_on_leave_days(self):
		"""Prevent submission if leave days have actual hours recorded.

		Leave days should have 0 actual hours to maintain data consistency.
		"""
		# Only validate when trying to submit (docstatus about to become 1)
		if self.docstatus == 0 and self._action == "submit":
			errors = []
			for daily in self.daily_entries:
				if daily.leave_application and daily.actual_hours and daily.actual_hours > 0:
					errors.append(f"{daily.date}: {daily.actual_hours} hours on approved leave")

			if errors:
				frappe.throw(
					_("Cannot submit Weekly Entry. The following leave days have hours recorded:<br>"
					  "{0}<br><br>"
					  "Leave days should have 0 actual hours.").format("<br>".join(errors)),
					title=_("Invalid Hours on Leave Days")
				)

	def validate_sequential_submission(self):
		"""Ensure Weekly Entries are submitted in chronological order.

		Prevents submitting a week if the previous week hasn't been submitted yet.
		This ensures the running balance chain remains accurate.

		Exception: The first week for an employee (no previous entries exist) can be submitted.
		HR Managers can bypass this validation if needed.
		"""
		# Only validate when trying to submit
		if not (self.docstatus == 0 and self._action == "submit"):
			return

		# HR Managers can bypass sequential validation
		if "HR Manager" in frappe.get_roles():
			return

		week_start = getdate(self.week_start)
		prev_week_start = add_days(week_start, -7)

		# Check if previous week's entry exists
		prev_entry = frappe.db.get_value("Weekly Entry",
			{"employee": self.employee, "week_start": prev_week_start},
			["name", "docstatus"],
			as_dict=True
		)

		if prev_entry:
			# Previous week entry exists - must be submitted first
			if prev_entry.docstatus != 1:
				frappe.throw(
					_("Cannot submit this Weekly Entry. The previous week ({0}) must be submitted first.<br><br>"
					  "Please submit <a href='/app/weekly-entry/{1}'>{1}</a> before submitting this entry."
					  ).format(frappe.format_date(prev_week_start), prev_entry.name),
					title=_("Previous Week Not Submitted")
				)
		else:
			# No previous week entry - check if any earlier entries exist
			earlier_unsubmitted = frappe.db.sql("""
				SELECT name, week_start FROM `tabWeekly Entry`
				WHERE employee = %s
				AND week_start < %s
				AND docstatus = 0
				ORDER BY week_start DESC
				LIMIT 1
			""", (self.employee, week_start), as_dict=True)

			if earlier_unsubmitted:
				frappe.throw(
					_("Cannot submit this Weekly Entry. You have an earlier unsubmitted week ({0}).<br><br>"
					  "Please submit <a href='/app/weekly-entry/{1}'>{1}</a> first to maintain balance continuity."
					  ).format(
						frappe.format_date(earlier_unsubmitted[0].week_start),
						earlier_unsubmitted[0].name
					),
					title=_("Earlier Week Not Submitted")
				)

	def validate_week_complete(self):
		"""Prevent submission if week hasn't ended yet.

		Weekly Entry can only be submitted after the week ends (after Sunday).
		HR Managers can bypass this validation.
		"""
		# Only validate when trying to submit
		if not (self.docstatus == 0 and self._action == "submit"):
			return

		# HR Managers can bypass
		if "HR Manager" in frappe.get_roles():
			return

		week_end = getdate(self.week_end)
		current_date = getdate(today())

		if current_date <= week_end:
			frappe.throw(
				_("Cannot submit Weekly Entry before the week is complete.<br><br>"
				  "Week ends on {0}. Please submit after that date.").format(
					format_date(week_end)
				),
				title=_("Week Not Complete")
			)

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
		from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern
		from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays

		self.total_actual_hours = sum(d.actual_hours or 0 for d in self.daily_entries)

		# Store reference to the work pattern used for this calculation
		pattern = get_work_pattern(self.employee, self.week_start)
		self.work_pattern = pattern.name if pattern else None

		# Calculate expected hours using holiday-adjusted calculation
		# This accounts for FTE percentage, holidays, and leaves proportionally
		try:
			self.total_expected_hours = calculate_weekly_expected_hours_with_holidays(
				self.employee, self.week_start
			)
		except Exception:
			# Fallback to sum of daily expected hours if calculation fails
			self.total_expected_hours = sum(d.expected_hours or 0 for d in self.daily_entries)
		
		# Validation: Compare weekly adjusted total with sum of daily expected hours
		# This helps catch inconsistencies between daily and weekly calculations
		daily_sum = sum(d.expected_hours or 0 for d in self.daily_entries)
		diff = abs(self.total_expected_hours - daily_sum)
		
		# Log warning if significant difference (more than 0.5 hours)
		# This can happen legitimately if leaves/holidays are adjusted proportionally
		# but helps identify calculation issues
		if diff > 0.5:
			frappe.logger().warning(
				f"Weekly Entry {self.name}: Weekly expected hours ({self.total_expected_hours:.2f}) "
				f"differs from sum of daily expected hours ({daily_sum:.2f}) by {diff:.2f} hours. "
				"This may be expected if leaves/holidays are adjusted proportionally."
			)
		
		self.weekly_delta = self.total_actual_hours - self.total_expected_hours
		self.timesheet_hours = sum(d.timesheet_hours or 0 for d in self.daily_entries)

		# Calculate differences for each daily entry
		for d in self.daily_entries:
			d.difference = (d.actual_hours or 0) - (d.expected_hours or 0)

		# Get previous week's balance
		prev_entry = get_previous_weekly_entry(self.employee, self.week_start)
		if prev_entry:
			self.previous_balance = prev_entry.running_balance
		else:
			# No previous entry - use initial balance from work pattern
			self.previous_balance = get_initial_balance(self.employee, self.week_start)
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

				# Recalculate expected hours (approved leaves reduce to 0)
				has_approved_leave = bool(roll_call.leave_application)
				daily.expected_hours = calculate_expected_hours(
					self.employee, daily.date, has_approved_leave, roll_call.is_half_day
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


def get_initial_balance(employee, week_start):
	"""Get the initial balance from the employee's work pattern.

	This is used when there's no previous Weekly Entry to carry forward a balance.
	The initial_balance field in Employee Work Pattern allows setting a starting
	balance for existing employees or carrying over from a previous system.

	Args:
		employee: Employee ID
		week_start: Monday of the week (used to find applicable work pattern)

	Returns:
		float: Initial balance in hours, or 0 if not set
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	pattern = get_work_pattern(employee, week_start)
	if pattern:
		return pattern.initial_balance or 0
	return 0


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
		if prev_entry:
			doc.previous_balance = prev_entry.running_balance
		else:
			doc.previous_balance = get_initial_balance(employee, doc.week_start)
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


def calculate_expected_hours(employee, date, has_approved_leave=False, is_half_day=False):
	"""Calculate expected hours based on work pattern, holidays, and approved leaves.

	Logic:
	1. Start with work pattern hours for the day (day_off in pattern = 0)
	2. If it's a holiday (from Holiday List): expected = 0
	3. If there's an approved leave: expected = 0 (or half if half-day)
	4. Roll Call presence types are just for reference - they don't affect expected hours

	Args:
		employee: Employee ID
		date: The date
		has_approved_leave: Whether there's an approved Leave Application
		is_half_day: Whether this is a half-day leave

	Returns:
		float: Expected hours
	"""
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern
	from flexitime.flexitime.utils import is_holiday

	pattern = get_work_pattern(employee, date)
	normal_hours = pattern.get_hours_for_weekday(date) if pattern else 8

	# Holidays from Holiday List = 0 expected hours
	if is_holiday(date, employee):
		return 0

	# Approved leaves reduce expected hours
	if has_approved_leave:
		if is_half_day:
			return normal_hours / 2
		return 0

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
	week_end = add_days(week_start, 4)  # Friday (Mon-Fri = 5 days)
	days_of_week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
	days = []

	# Get existing weekly entry data to preserve actual_hours
	existing_entry_name = frappe.db.get_value("Weekly Entry",
		{"employee": employee, "week_start": week_start},
		"name"
	)
	existing_actual_hours = {}
	if existing_entry_name:
		existing_daily_entries = frappe.get_all("Daily Entry",
			filters={"parent": existing_entry_name},
			fields=["date", "actual_hours"]
		)
		for entry in existing_daily_entries:
			existing_actual_hours[str(entry.date)] = entry.actual_hours

	# Only generate Mon-Fri (5 days) - users can manually add weekend rows if needed
	for i in range(5):
		date = add_days(week_start, i)
		date_str = str(date)

		# Get roll call entry if exists - explicitly querying to ensure it's fetched
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["presence_type", "leave_application", "is_half_day"],
			as_dict=True
		)

		# Extract roll call data (roll_call will be None if no entry exists)
		presence_type = roll_call.presence_type if roll_call else None
		leave_application = roll_call.leave_application if roll_call else None
		is_half_day = roll_call.is_half_day if roll_call else False
		has_approved_leave = bool(leave_application)

		# Get expected hours (approved leaves reduce to 0)
		expected = calculate_expected_hours(employee, date, has_approved_leave, is_half_day)

		# Get presence type details
		icon = label = None
		if presence_type:
			pt = frappe.get_cached_value("Presence Type", presence_type,
				["icon", "label"], as_dict=True)
			if pt:
				icon = pt.icon
				label = pt.label

		# Preserve existing actual_hours if available, otherwise leave as None/0
		actual_hours = existing_actual_hours.get(date_str)

		days.append({
			"date": date_str,
			"day_of_week": days_of_week[i],
			"expected_hours": expected,
			"actual_hours": actual_hours,  # Only use existing value, don't auto-fill
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

	days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

	# Add 5 daily entries (Mon-Fri) - users can manually add weekend rows if needed
	for i in range(5):
		date = add_days(week_start, i)

		# Get roll call entry
		roll_call = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["presence_type", "leave_application", "is_half_day"],
			as_dict=True
		)

		presence_type = roll_call.presence_type if roll_call else None
		leave_application = roll_call.leave_application if roll_call else None
		is_half_day = roll_call.is_half_day if roll_call else False
		has_approved_leave = bool(leave_application)

		# Get expected hours (approved leaves reduce to 0)
		expected = calculate_expected_hours(employee, date, has_approved_leave, is_half_day)

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
