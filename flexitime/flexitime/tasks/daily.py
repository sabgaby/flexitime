# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Daily scheduled tasks for Flexitime.

This module contains background tasks that run daily via Frappe's scheduler
to maintain data integrity and automation in the Flexitime system.

Scheduled Tasks:
    lock_past_roll_call (00:05):
        Locks Roll Call entries from past weeks to prevent modification

    auto_create_roll_call_entries (00:10):
        Pre-creates system entries for weekends, holidays, and days off

    auto_lock_submitted_entries:
        Locks submitted Weekly Entries after configured number of days

    sync_timesheet_hours (every 2 hours):
        Syncs hours from ERPNext Timesheets to Weekly Entry daily entries

Configuration:
    These tasks are registered in hooks.py under scheduler_events.
    Auto-lock settings are in Flexitime Settings:
    - enable_auto_lock: Enable/disable auto-locking
    - auto_lock_after_days: Days after submission to lock

Dependencies:
    - frappe.utils (today, add_days, getdate)
    - flexitime.flexitime.utils
    - ERPNext Timesheet (for sync_timesheet_hours)
"""

import frappe
from frappe.utils import today, add_days, getdate

from flexitime.flexitime.utils import get_monday, get_active_employees
from flexitime.flexitime.doctype.presence_type.presence_type import get_auto_presence_type


def lock_past_roll_call():
	"""Lock Roll Call Entries from completed weeks

	Runs daily at 00:05
	"""
	# Get Monday of current week
	current_week_start = get_monday(today())

	# Lock all entries before current week
	frappe.db.sql("""
		UPDATE `tabRoll Call Entry`
		SET is_locked = 1
		WHERE date < %s AND is_locked = 0
	""", current_week_start)

	frappe.db.commit()
	frappe.logger().info(f"Locked Roll Call Entries before {current_week_start}")


def auto_create_roll_call_entries():
	"""Create system Roll Call Entries for next 2 weeks

	Runs daily at 00:10
	Creates entries for weekends, holidays, and scheduled days off
	"""
	today_date = getdate(today())
	end_date = add_days(today_date, 14)

	employees = get_active_employees()
	created_count = 0

	for employee in employees:
		current_date = today_date

		while current_date <= end_date:
			# Skip if entry already exists
			existing = frappe.db.exists("Roll Call Entry", {
				"employee": employee.name,
				"date": current_date
			})

			if not existing:
				# Check for auto-assignable presence type
				presence_type, source, leave_app = get_auto_presence_type(
					employee.name, current_date
				)

				if presence_type and source == "System":
					try:
						doc = frappe.get_doc({
							"doctype": "Roll Call Entry",
							"employee": employee.name,
							"date": current_date,
							"presence_type": presence_type,
							"source": source,
							"leave_application": leave_app
						})
						doc.flags.ignore_permissions = True
						doc.insert()
						created_count += 1
					except Exception as e:
						frappe.log_error(
							f"Failed to create Roll Call Entry for {employee.name} on {current_date}: {str(e)}",
							"Flexitime Auto-Create Error"
						)

			current_date = add_days(current_date, 1)

	frappe.db.commit()
	frappe.logger().info(f"Created {created_count} auto Roll Call Entries")


def sync_timesheet_hours():
	"""Update Daily Entries with latest Timesheet hours

	Runs every 2 hours
	"""
	from flexitime.flexitime.doctype.weekly_entry.weekly_entry import get_timesheet_hours

	# Get all Draft Weekly Entries for current and previous week
	two_weeks_ago = add_days(get_monday(today()), -7)

	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"docstatus": 0,  # Draft
		"week_start": [">=", two_weeks_ago]
	})

	updated_count = 0

	for we in weekly_entries:
		doc = frappe.get_doc("Weekly Entry", we.name)
		changed = False

		for daily in doc.daily_entries:
			ts_hours = get_timesheet_hours(doc.employee, daily.date)
			if daily.timesheet_hours != ts_hours:
				daily.timesheet_hours = ts_hours
				changed = True

		if changed:
			doc.flags.ignore_permissions = True
			doc.save()
			updated_count += 1

	frappe.db.commit()
	frappe.logger().info(f"Synced timesheet hours for {updated_count} weekly entries")


def auto_lock_submitted_entries():
	"""Auto-lock submitted Weekly Entries after configured number of days

	Runs daily
	"""
	from frappe.utils import now_datetime, date_diff

	# Get settings
	settings = frappe.get_cached_doc("Flexitime Settings")

	if not settings.enable_auto_lock:
		return

	lock_after_days = settings.auto_lock_after_days or 14

	# Get submitted but not locked entries
	entries = frappe.get_all("Weekly Entry", filters={
		"docstatus": 1,  # Submitted
		"is_locked": 0
	}, fields=["name", "submitted_on"])

	locked_count = 0
	today_datetime = now_datetime()

	for entry in entries:
		if entry.submitted_on:
			days_since_submit = date_diff(today_datetime, entry.submitted_on)
			if days_since_submit >= lock_after_days:
				frappe.db.set_value("Weekly Entry", entry.name, {
					"is_locked": 1,
					"locked_on": today_datetime
				})
				locked_count += 1

	if locked_count:
		frappe.db.commit()
		frappe.logger().info(f"Auto-locked {locked_count} Weekly Entries after {lock_after_days} days")
