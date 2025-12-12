# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, add_days, today


class EmployeeWorkPattern(Document):
	def validate(self):
		self.calculate_weekly_hours()
		self.calculate_flexitime_limit()
		self.validate_hours()
		self.validate_dates()
		self.validate_overlapping()
		self.validate_against_base_hours()

	def calculate_weekly_hours(self):
		"""Auto-calculate total weekly expected hours"""
		self.weekly_expected_hours = (
			(self.monday_hours or 0) +
			(self.tuesday_hours or 0) +
			(self.wednesday_hours or 0) +
			(self.thursday_hours or 0) +
			(self.friday_hours or 0) +
			(self.saturday_hours or 0) +
			(self.sunday_hours or 0)
		)

	def calculate_flexitime_limit(self):
		"""Auto-calculate flexitime limit based on FTE (20 hours at 100%)"""
		if not self.flexitime_limit_hours:
			self.flexitime_limit_hours = 20 * (self.fte_percentage / 100)

	def validate_hours(self):
		"""Ensure hours are non-negative"""
		days = ['monday_hours', 'tuesday_hours', 'wednesday_hours',
				'thursday_hours', 'friday_hours', 'saturday_hours', 'sunday_hours']
		for day in days:
			if (getattr(self, day) or 0) < 0:
				frappe.throw(f"{day.replace('_', ' ').title()} cannot be negative")

	def validate_dates(self):
		"""Ensure valid_from is before valid_to"""
		if self.valid_to and getdate(self.valid_from) > getdate(self.valid_to):
			frappe.throw("Valid From date must be before Valid To date")

	def validate_overlapping(self):
		"""Check for overlapping patterns for the same employee (only submitted patterns)"""
		# Build date overlap conditions - only check against submitted patterns (docstatus=1)
		if self.valid_to:
			# Pattern has end date - check for overlap
			existing = frappe.db.sql("""
				SELECT name, valid_from, valid_to FROM `tabEmployee Work Pattern`
				WHERE employee = %s AND name != %s AND docstatus = 1
				AND (
					(valid_from <= %s AND (valid_to >= %s OR valid_to IS NULL))
					OR (valid_from >= %s AND valid_from <= %s)
				)
			""", (self.employee, self.name or "", self.valid_to, self.valid_from,
				  self.valid_from, self.valid_to), as_dict=True)
		else:
			# Pattern is current (no end date) - check for any future open patterns
			existing = frappe.db.sql("""
				SELECT name, valid_from, valid_to FROM `tabEmployee Work Pattern`
				WHERE employee = %s AND name != %s AND docstatus = 1
				AND (valid_to IS NULL OR valid_to >= %s)
			""", (self.employee, self.name or "", self.valid_from), as_dict=True)

		if existing:
			frappe.throw(
				f"Work pattern overlaps with existing pattern '{existing[0].name}' "
				f"(valid from {existing[0].valid_from})"
			)

	def validate_against_base_hours(self):
		"""Validate that work pattern weekly hours align with Company base hours and FTE%.
		
		Shows a warning if the sum of daily hours doesn't match expected FTE weekly hours.
		This is informational - doesn't prevent save, but helps ensure consistency.
		"""
		from flexitime.flexitime.utils import get_base_weekly_hours
		
		# Get employee's company
		company = frappe.db.get_value("Employee", self.employee, "company")
		if not company:
			return  # Can't validate without company
		
		# Get base weekly hours
		base_weekly_hours = get_base_weekly_hours(company)
		
		# Calculate expected FTE weekly hours
		fte_percentage = self.fte_percentage or 100
		expected_fte_weekly = base_weekly_hours * (fte_percentage / 100)
		
		# Compare with actual weekly hours from pattern
		actual_weekly = self.weekly_expected_hours or 0
		diff = abs(actual_weekly - expected_fte_weekly)
		
		# Warn if difference is significant (more than 0.5 hours)
		if diff > 0.5:
			frappe.msgprint(
				f"Note: Weekly hours ({actual_weekly}h) differs from expected FTE hours "
				f"({expected_fte_weekly:.1f}h based on {base_weekly_hours}h base × {fte_percentage}% FTE). "
				f"Expected hours calculation will use FTE-adjusted base hours.",
				indicator="orange",
				alert=True
			)

	def get_hours_for_weekday(self, date):
		"""Get expected hours for a specific date based on weekday

		Args:
			date: The date to get hours for (can be date object or string)

		Returns:
			float: Expected hours for that weekday
		"""
		date = getdate(date)
		weekday = date.weekday()  # 0=Monday, 6=Sunday

		hours_map = {
			0: self.monday_hours,
			1: self.tuesday_hours,
			2: self.wednesday_hours,
			3: self.thursday_hours,
			4: self.friday_hours,
			5: self.saturday_hours,
			6: self.sunday_hours
		}

		return hours_map.get(weekday, 0) or 0

	def is_day_off(self, date):
		"""Check if a specific date is a day off (0 hours in work pattern).

		A day is considered "day off" if it has 0 expected hours but is NOT
		a weekend (Saturday/Sunday). Weekends are handled separately as system types.

		Args:
			date: The date to check (can be date object or string)

		Returns:
			bool: True if day has 0 hours and is a weekday (Mon-Fri)
		"""
		date = getdate(date)
		weekday = date.weekday()  # 0=Monday, 6=Sunday

		# Weekends are not "day off" - they're weekends (handled as system type)
		if weekday >= 5:  # Saturday or Sunday
			return False

		# Day off = weekday with 0 expected hours
		return self.get_hours_for_weekday(date) == 0

	def get_day_off_weekdays(self):
		"""Get list of weekday numbers that are days off (0 hours, Mon-Fri only).

		Returns:
			list: List of weekday numbers (0=Monday, 4=Friday) with 0 hours
		"""
		day_offs = []
		hours_map = [
			(0, self.monday_hours),
			(1, self.tuesday_hours),
			(2, self.wednesday_hours),
			(3, self.thursday_hours),
			(4, self.friday_hours),
			# Saturday/Sunday excluded - they're weekends, not "day off"
		]
		for weekday, hours in hours_map:
			if (hours or 0) == 0:
				day_offs.append(weekday)
		return day_offs

	def on_submit(self):
		"""Clean up stale day_off entries and create new ones when pattern is submitted."""
		self.cleanup_stale_day_off_entries()
		self.create_day_off_entries()

	def cleanup_stale_day_off_entries(self):
		"""Delete system-generated day_off entries that are no longer valid under this pattern.

		Only affects entries that:
		- Are within this pattern's validity period
		- Have source="System" (not manual entries)
		- Are not locked
		- Are on weekdays that are NO LONGER days off in this pattern
		"""
		from_date = self.valid_from
		to_date = self.valid_to or add_days(today(), 365)  # 1 year ahead max

		# Get this pattern's day-off weekdays (Mon-Fri with 0 hours)
		new_day_offs = set(self.get_day_off_weekdays())

		# Find day_off entries in range that are system-generated and not locked
		entries = frappe.get_all("Roll Call Entry",
			filters={
				"employee": self.employee,
				"date": ["between", [from_date, to_date]],
				"presence_type": "day_off",
				"source": "System",
				"is_locked": 0
			},
			fields=["name", "date"]
		)

		deleted_count = 0
		for entry in entries:
			weekday = getdate(entry.date).weekday()
			if weekday not in new_day_offs:
				# This day is no longer a day off - delete it
				frappe.delete_doc("Roll Call Entry", entry.name, ignore_permissions=True)
				deleted_count += 1

		if deleted_count:
			frappe.msgprint(f"Cleaned up {deleted_count} stale day-off entries", indicator="blue")

	def create_day_off_entries(self):
		"""Create day_off entries for this pattern's day-off weekdays.

		Creates entries from valid_from to valid_to (or 1 year ahead if no end date).
		Only creates if entry doesn't already exist for that date.
		"""
		from_date = getdate(self.valid_from)
		to_date = getdate(self.valid_to) if self.valid_to else add_days(today(), 365)

		# Get this pattern's day-off weekdays
		day_off_weekdays = self.get_day_off_weekdays()
		if not day_off_weekdays:
			return

		# Get day_off presence type details
		day_off_pt = frappe.get_cached_value("Presence Type", "day_off",
			["icon", "label"], as_dict=True)

		if not day_off_pt:
			return

		created_count = 0
		current_date = from_date
		while current_date <= to_date:
			weekday = current_date.weekday()
			if weekday in day_off_weekdays:
				# Check if entry already exists
				if not frappe.db.exists("Roll Call Entry",
					{"employee": self.employee, "date": current_date}):
					frappe.get_doc({
						"doctype": "Roll Call Entry",
						"employee": self.employee,
						"date": current_date,
						"presence_type": "day_off",
						"presence_type_icon": day_off_pt.icon,
						"presence_type_label": day_off_pt.label,
						"source": "System",
						"is_half_day": 0,
					}).insert(ignore_permissions=True)
					created_count += 1
			current_date = add_days(current_date, 1)

		if created_count:
			frappe.msgprint(f"Created {created_count} day-off entries", indicator="green")


def get_work_pattern(employee, date):
	"""Get the active work pattern for an employee on a specific date

	Args:
		employee: Employee ID
		date: The date to check

	Returns:
		EmployeeWorkPattern document or None
	"""
	date = getdate(date)

	pattern_name = frappe.db.sql("""
		SELECT name FROM `tabEmployee Work Pattern`
		WHERE employee = %s
		AND valid_from <= %s
		AND (valid_to >= %s OR valid_to IS NULL)
		AND docstatus = 1
		ORDER BY valid_from DESC
		LIMIT 1
	""", (employee, date, date), as_dict=True)

	if pattern_name:
		return frappe.get_doc("Employee Work Pattern", pattern_name[0].name)

	return None
