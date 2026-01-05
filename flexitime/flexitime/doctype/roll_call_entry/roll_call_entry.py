# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class RollCallEntry(Document):
	def validate(self):
		self.set_day_of_week()
		self.validate_locked()
		self.validate_presence_type_permission()
		self.validate_unique()

	def set_day_of_week(self):
		"""Auto-set day of week from date"""
		if self.date:
			date = getdate(self.date)
			days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
			self.day_of_week = days[date.weekday()]

	def validate_locked(self):
		"""Prevent editing if entry is locked (unless HR Manager)"""
		if self.is_locked:
			# Allow Leave Application updates to override lock
			if self.source == "Leave":
				return
			# Check if user is HR Manager
			if "HR Manager" not in frappe.get_roles():
				frappe.throw(_("This Roll Call Entry is locked and cannot be edited"))

	def validate_presence_type_permission(self):
		"""Check if employee can select this presence type"""
		if self.source == "System" or self.source == "Leave":
			# System and Leave entries are auto-created, skip permission check
			return

		# Check if user is HR Manager - they can set any type
		if "HR Manager" in frappe.get_roles():
			return

		presence_type = frappe.get_doc("Presence Type", self.presence_type)

		# Check if available to all
		if presence_type.available_to_all:
			# Still need to check day off pattern match
			pass
		else:
			# Check employee-specific permissions
			employee_permissions = frappe.get_all("Employee Presence Permission",
				filters={"parent": self.employee},
				pluck="presence_type"
			)

			if self.presence_type not in employee_permissions:
				frappe.throw(_("You don't have permission to select '{0}'. "
					"Contact HR to add this presence type to your profile.").format(
					presence_type.label))

		# Check if this is the day off presence type and validate pattern match
		try:
			settings = frappe.get_cached_doc("Flexitime Settings")
			day_off_presence_type = settings.day_off_presence_type
		except Exception:
			# Fallback to default if settings not available
			day_off_presence_type = "day_off" if frappe.db.exists("Presence Type", "day_off") else None

		if day_off_presence_type and self.presence_type == day_off_presence_type:
			from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern
			pattern = get_work_pattern(self.employee, self.date)
			if pattern:
				expected_hours = pattern.get_hours_for_weekday(self.date)
				if expected_hours > 0:
					frappe.throw(_("'{0}' can only be selected on days with 0 expected hours").format(
						presence_type.label))

	def validate_unique(self):
		"""Ensure one entry per employee per date"""
		if not self.is_new():
			return

		existing = frappe.db.exists("Roll Call Entry", {
			"employee": self.employee,
			"date": self.date,
			"name": ["!=", self.name]
		})

		if existing:
			frappe.throw(_("A Roll Call Entry already exists for {0} on {1}").format(
				self.employee_name or self.employee, self.date))


@frappe.whitelist()
def get_roll_call_for_week(employee, week_start):
	"""Get roll call entries for an employee for a specific week

	Args:
		employee: Employee ID
		week_start: Monday of the week

	Returns:
		dict: Entries keyed by date
	"""
	from frappe.utils import add_days

	week_start = getdate(week_start)
	week_end = add_days(week_start, 6)

	entries = frappe.get_all("Roll Call Entry",
		filters={
			"employee": employee,
			"date": ["between", [week_start, week_end]]
		},
		fields=["name", "date", "presence_type", "presence_type_icon",
				"presence_type_label", "is_half_day", "source", "is_locked", "notes"]
	)

	# Key by date
	result = {}
	for entry in entries:
		result[str(entry.date)] = entry

	return result


@frappe.whitelist()
def update_roll_call(employee, date, presence_type, notes=None):
	"""Create or update a Roll Call Entry

	Args:
		employee: Employee ID
		date: Date string
		presence_type: Presence Type name
		notes: Optional notes

	Returns:
		str: Roll Call Entry name

	Raises:
		frappe.PermissionError: If user doesn't have permission to edit this employee's entry
	"""
	# Permission check: users can only edit their own entries (HR can edit anyone)
	if "HR Manager" not in frappe.get_roles():
		current_employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
		if current_employee != employee:
			frappe.throw(
				_("You can only edit your own Roll Call entries"),
				frappe.PermissionError
			)

	date = getdate(date)

	existing = frappe.db.get_value("Roll Call Entry",
		{"employee": employee, "date": date},
		"name"
	)

	if existing:
		doc = frappe.get_doc("Roll Call Entry", existing)
		doc.presence_type = presence_type
		doc.source = "Manual"
		if notes is not None:
			doc.notes = notes
		doc.save()
	else:
		doc = frappe.get_doc({
			"doctype": "Roll Call Entry",
			"employee": employee,
			"date": date,
			"presence_type": presence_type,
			"source": "Manual",
			"notes": notes
		})
		doc.insert()

	return doc.name
