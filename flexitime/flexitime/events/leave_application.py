# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, add_days


def on_update(doc, method):
	"""Handle Leave Application status changes"""
	if doc.status == "Approved" and doc.docstatus == 1:
		validate_no_submitted_weekly_entries(doc)
		update_roll_call_for_leave(doc)
		update_weekly_entries_for_leave(doc)
	elif doc.status == "Cancelled" or doc.docstatus == 2:
		revert_roll_call_for_leave(doc)
		revert_weekly_entries_for_leave(doc)


def validate_no_submitted_weekly_entries(leave_app):
	"""Prevent leave approval if any dates have submitted Weekly Entries

	Weekly Entry represents actual hours worked. If already submitted,
	the employee has recorded their hours and cannot retroactively claim leave.

	Args:
		leave_app: Leave Application document

	Raises:
		frappe.ValidationError: If any dates overlap with submitted Weekly Entries
	"""
	submitted = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
		"docstatus": 1  # Submitted
	}, fields=["name", "week_start", "week_end"])

	if submitted:
		weeks = ", ".join([str(w.week_start) + " to " + str(w.week_end) for w in submitted])
		frappe.throw(
			f"Cannot approve leave for dates with submitted Weekly Entries.\n"
			f"Affected weeks: {weeks}\n"
			"The employee has already recorded hours for these dates.",
			title="Leave Approval Blocked"
		)


def update_roll_call_for_leave(leave_app):
	"""Update or create Roll Call Entries for approved leave

	Args:
		leave_app: Leave Application document
	"""
	# Get corresponding Presence Type for this Leave Type
	presence_type = frappe.db.get_value("Presence Type",
		{"is_leave": 1, "leave_type": leave_app.leave_type})

	if not presence_type:
		frappe.msgprint(
			f"No Presence Type configured for Leave Type: {leave_app.leave_type}. "
			"Roll Call entries not updated.",
			indicator="orange"
		)
		return

	# Iterate through each date in the leave period
	current_date = getdate(leave_app.from_date)
	to_date = getdate(leave_app.to_date)

	while current_date <= to_date:
		# Check if this is a half-day
		is_half = (leave_app.half_day and
				   leave_app.half_day_date and
				   getdate(leave_app.half_day_date) == current_date)

		values = {
			"presence_type": presence_type,
			"source": "Leave",
			"leave_application": leave_app.name,
			"is_half_day": is_half
		}

		# Check if Roll Call Entry exists
		existing = frappe.db.get_value("Roll Call Entry", {
			"employee": leave_app.employee,
			"date": current_date
		}, "name")

		if existing:
			# Update existing entry (override even if locked - leave takes precedence)
			frappe.db.set_value("Roll Call Entry", existing, values)
		else:
			# Create new entry
			entry = frappe.get_doc({
				"doctype": "Roll Call Entry",
				"employee": leave_app.employee,
				"date": current_date,
				**values
			})
			entry.flags.ignore_permissions = True
			entry.insert()

		current_date = add_days(current_date, 1)

	frappe.db.commit()


def update_weekly_entries_for_leave(leave_app):
	"""Update Daily Entries in Weekly Entry for approved leave

	Args:
		leave_app: Leave Application document
	"""
	presence_type = frappe.db.get_value("Presence Type",
		{"is_leave": 1, "leave_type": leave_app.leave_type})

	if not presence_type:
		return

	# Find affected Weekly Entries
	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
		"status": "Draft"  # Only update draft entries
	})

	for we in weekly_entries:
		doc = frappe.get_doc("Weekly Entry", we.name)
		changed = False

		for daily in doc.daily_entries:
			daily_date = getdate(daily.date)
			leave_from = getdate(leave_app.from_date)
			leave_to = getdate(leave_app.to_date)

			if leave_from <= daily_date <= leave_to:
				# Check if this is a half-day
				is_half = (leave_app.half_day and
						   leave_app.half_day_date and
						   getdate(leave_app.half_day_date) == daily_date)

				daily.presence_type = presence_type
				daily.leave_application = leave_app.name

				# Recalculate expected hours
				from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours
				daily.expected_hours = calculate_expected_hours(
					doc.employee, daily_date, presence_type, is_half
				)

				# Fetch icon and label
				pt = frappe.get_cached_value("Presence Type", presence_type,
					["icon", "label"], as_dict=True)
				if pt:
					daily.presence_type_icon = pt.icon
					daily.presence_type_label = pt.label

				changed = True

		if changed:
			doc.flags.ignore_permissions = True
			doc.save()


def revert_roll_call_for_leave(leave_app):
	"""Revert Roll Call Entries when leave is cancelled

	Args:
		leave_app: Leave Application document
	"""
	# Find all Roll Call Entries linked to this leave
	entries = frappe.get_all("Roll Call Entry", filters={
		"leave_application": leave_app.name
	})

	for entry in entries:
		# Delete the entry if it was created by this leave
		roll_call = frappe.get_doc("Roll Call Entry", entry.name)
		if roll_call.source == "Leave":
			frappe.delete_doc("Roll Call Entry", entry.name, force=True)

	frappe.db.commit()


def revert_weekly_entries_for_leave(leave_app):
	"""Revert Daily Entries when leave is cancelled

	Args:
		leave_app: Leave Application document
	"""
	# Find affected Weekly Entries
	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
		"status": "Draft"
	})

	for we in weekly_entries:
		doc = frappe.get_doc("Weekly Entry", we.name)
		changed = False

		for daily in doc.daily_entries:
			if daily.leave_application == leave_app.name:
				# Clear leave-related fields
				daily.presence_type = None
				daily.presence_type_icon = None
				daily.presence_type_label = None
				daily.leave_application = None
				daily.expected_hours = 0
				changed = True

		if changed:
			doc.flags.ignore_permissions = True
			doc.save()
