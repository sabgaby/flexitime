# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Leave Application event handlers for Flexitime integration.

This module handles the bidirectional sync between Leave Applications and
the Flexitime system (Roll Call entries and Weekly Entries). When leave is
approved or cancelled, this module ensures all related records are updated.

Event Flow:
    1. before_submit: Validates no hours are recorded for leave dates
    2. on_update (Approved): Creates Roll Call entries, updates Weekly Entries,
       creates Google Calendar event
    3. on_update (Cancelled): Reverts Roll Call/Weekly entries, deletes
       Google Calendar event

Key Functions:
    before_submit: Validates leave submission
    on_update: Handles approval/cancellation
    update_roll_call_for_leave: Creates/updates Roll Call entries
    update_weekly_entries_for_leave: Updates Weekly Entry daily entries
    create_google_calendar_event: Syncs to Google Calendar
    revert_roll_call_for_leave: Restores previous state on cancellation
    revert_weekly_entries_for_leave: Restores Weekly Entries on cancellation

Dependencies:
    - frappe
    - integration_hub (optional, for Google Calendar sync)

Configuration:
    Settings are in Flexitime Settings:
    - enable_calendar_sync: Enable/disable Google Calendar integration
    - calendar_manager: User who manages the Absences calendar
    - absences_calendar_id: Calendar ID for creating events
"""

import frappe
from frappe import _
from frappe.utils import getdate, add_days


def before_submit(doc, method):
	"""Validate before submitting leave application"""
	validate_no_hours_recorded(doc)


def on_update(doc, method):
	"""Handle Leave Application status changes"""
	if doc.status == "Approved" and doc.docstatus == 1:
		validate_no_submitted_weekly_entries(doc)
		update_roll_call_for_leave(doc)
		update_weekly_entries_for_leave(doc)
		create_google_calendar_event(doc)
	elif doc.status == "Cancelled" or doc.docstatus == 2:
		# FIXED ORDER: Revert Weekly Entry FIRST (needs Roll Call data)
		revert_weekly_entries_for_leave(doc)
		revert_roll_call_for_leave(doc)
		delete_google_calendar_event(doc)


def validate_no_hours_recorded(leave_app):
	"""Block leave submission if employee already recorded hours for leave dates.

	Args:
		leave_app: Leave Application document

	Raises:
		frappe.ValidationError: If any dates have hours recorded
	"""
	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
	})

	conflicts = []
	for we in weekly_entries:
		doc = frappe.get_doc("Weekly Entry", we.name)
		for daily in doc.daily_entries:
			daily_date = getdate(daily.date)
			if getdate(leave_app.from_date) <= daily_date <= getdate(leave_app.to_date):
				if daily.actual_hours and daily.actual_hours > 0:
					conflicts.append(f"{daily.date}: {daily.actual_hours} hours recorded")

	if conflicts:
		frappe.throw(
			_("Cannot submit leave application. You have already recorded hours for these dates:<br>"
			  "{0}<br><br>"
			  "Please clear the hours in your Weekly Entry first.").format(
				"<br>".join(conflicts)),
			title=_("Hours Already Recorded")
		)


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
		}, ["name", "source", "presence_type"], as_dict=True)

		if existing:
			# Store previous state for potential restore on cancellation
			if existing.source != "Leave":
				values["previous_source"] = existing.source
				values["previous_presence_type"] = existing.presence_type
			# Update existing entry (override even if locked - leave takes precedence)
			frappe.db.set_value("Roll Call Entry", existing.name, values)
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

	# Find affected Weekly Entries (only draft, not submitted)
	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
		"docstatus": 0  # Only update draft entries
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

				# Clear any recorded hours and warn user
				if daily.actual_hours and daily.actual_hours > 0:
					old_hours = daily.actual_hours
					daily.actual_hours = 0
					frappe.msgprint(
						_("Cleared {0} hours from {1} due to approved leave.").format(
							old_hours, daily.date),
						indicator="orange"
					)

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
	"""Revert Roll Call Entries when leave is cancelled.

	If the entry had a previous state (e.g., holiday, day off, manual entry),
	restore it. Otherwise, delete the entry.

	Args:
		leave_app: Leave Application document
	"""
	# Find all Roll Call Entries linked to this leave
	entries = frappe.get_all("Roll Call Entry", filters={
		"leave_application": leave_app.name
	}, fields=["name", "source", "previous_source", "previous_presence_type"])

	for entry in entries:
		roll_call = frappe.get_doc("Roll Call Entry", entry.name)

		if roll_call.source == "Leave":
			if roll_call.previous_source and roll_call.previous_presence_type:
				# Restore previous state
				pt = frappe.get_cached_value("Presence Type", roll_call.previous_presence_type,
					["icon", "label"], as_dict=True)

				roll_call.source = roll_call.previous_source
				roll_call.presence_type = roll_call.previous_presence_type
				roll_call.presence_type_icon = pt.icon if pt else None
				roll_call.presence_type_label = pt.label if pt else None
				roll_call.leave_application = None
				roll_call.is_half_day = False
				roll_call.previous_source = None
				roll_call.previous_presence_type = None
				roll_call.flags.ignore_permissions = True
				roll_call.save()
			else:
				# No previous state - delete the entry
				frappe.delete_doc("Roll Call Entry", entry.name, force=True)

	frappe.db.commit()


def revert_weekly_entries_for_leave(leave_app):
	"""Revert Daily Entries when leave is cancelled

	First clears leave-related fields, then re-syncs from Roll Call entries
	to restore any existing presence (holiday, pattern, manual).

	Args:
		leave_app: Leave Application document
	"""
	from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

	# Find affected Weekly Entries
	weekly_entries = frappe.get_all("Weekly Entry", filters={
		"employee": leave_app.employee,
		"week_start": ["<=", leave_app.to_date],
		"week_end": [">=", leave_app.from_date],
		"docstatus": 0  # Only update draft entries
	})

	for we in weekly_entries:
		doc = frappe.get_doc("Weekly Entry", we.name)
		changed = False

		for daily in doc.daily_entries:
			if daily.leave_application == leave_app.name:
				# Clear leave-related fields first
				daily.leave_application = None
				changed = True

				# Try to get Roll Call Entry for this date (may have holiday/pattern/manual)
				roll_call = frappe.db.get_value("Roll Call Entry",
					{"employee": leave_app.employee, "date": daily.date},
					["presence_type", "leave_application", "is_half_day"],
					as_dict=True
				)

				if roll_call and roll_call.presence_type:
					# Restore from Roll Call Entry
					daily.presence_type = roll_call.presence_type
					daily.leave_application = roll_call.leave_application

					pt = frappe.get_cached_value("Presence Type", roll_call.presence_type,
						["icon", "label"], as_dict=True)
					if pt:
						daily.presence_type_icon = pt.icon
						daily.presence_type_label = pt.label

					daily.expected_hours = calculate_expected_hours(
						doc.employee, daily.date, roll_call.presence_type, roll_call.is_half_day
					)
				else:
					# No Roll Call Entry - clear to default state (working day)
					daily.presence_type = None
					daily.presence_type_icon = None
					daily.presence_type_label = None
					daily.expected_hours = calculate_expected_hours(
						doc.employee, daily.date, None, False
					)

		if changed:
			doc.flags.ignore_permissions = True
			doc.save()


def create_google_calendar_event(leave_app):
	"""Create a Google Calendar event for approved leave.

	Creates an all-day event on the shared Absences calendar and invites
	the employee so they appear as 'busy' during the leave period.

	Args:
		leave_app: Leave Application document
	"""
	try:
		# Check if Google Workspace is enabled
		if not frappe.db.exists("Google Workspace Settings"):
			return

		settings = frappe.get_single("Google Workspace Settings")
		if not settings.enabled or not settings.enable_calendar:
			return

		# Check if Flexitime Settings has calendar integration enabled
		flexitime_settings = frappe.get_single("Flexitime Settings")
		if not getattr(flexitime_settings, 'enable_calendar_sync', False):
			return

		# Get the designated HR user who manages the Absences calendar
		calendar_manager = getattr(flexitime_settings, 'calendar_manager', None)
		if not calendar_manager:
			# Fall back to any HR Manager with Google Workspace connected
			calendar_manager = get_connected_hr_manager()
			if not calendar_manager:
				frappe.log_error(
					"No HR Manager with Google Workspace authorized found",
					"Leave Calendar Sync"
				)
				return

		# Get employee email
		employee_email = frappe.db.get_value("Employee", leave_app.employee, "user_id")
		if not employee_email:
			frappe.log_error(
				f"Employee {leave_app.employee} has no linked user",
				"Leave Calendar Sync"
			)
			return

		# Get employee name for display
		employee_name = frappe.db.get_value("Employee", leave_app.employee,
			"employee_name") or leave_app.employee

		# Check for nickname
		nickname = frappe.db.get_value("Employee", leave_app.employee, "nickname")
		display_name = nickname or employee_name.split()[0]  # First name or nickname

		# Build event summary
		leave_type = leave_app.leave_type
		if leave_app.half_day:
			summary = f"{display_name} - {leave_type} (Half Day)"
		else:
			summary = f"{display_name} - {leave_type}"

		# Build description
		description = f"Leave Application: {leave_app.name}\n"
		description += f"Employee: {employee_name}\n"
		description += f"Leave Type: {leave_type}\n"
		description += f"Period: {leave_app.from_date} to {leave_app.to_date}\n"
		if leave_app.description:
			description += f"\nReason: {leave_app.description}"

		# Create calendar service with the calendar manager's credentials
		from integration_hub.services.calendar import GoogleCalendarService

		# Get the target calendar ID (shared Absences calendar)
		calendar_id = getattr(flexitime_settings, 'absences_calendar_id', 'primary')

		service = GoogleCalendarService(user=calendar_manager, calendar_id=calendar_id)

		# Create the event
		result = service.create_event(
			summary=summary,
			start_date=str(leave_app.from_date),
			end_date=str(leave_app.to_date),
			description=description,
			attendees=[employee_email],  # Invite the employee
			all_day=True,
			send_notifications=True,  # Send email invitation
			transparency="opaque"  # Mark as busy
		)

		# Store the event ID and URL on the Leave Application for later deletion
		if result and result.get('id'):
			update_data = {
				"google_calendar_event_id": result['id'],
				"google_calendar_event_url": result.get('htmlLink')
			}
			frappe.db.set_value("Leave Application", leave_app.name,
				update_data, update_modified=False)
			frappe.db.commit()

			frappe.msgprint(
				f"Calendar event created. {employee_name} will receive an invitation.",
				indicator="green",
				alert=True
			)

	except Exception as e:
		# Don't fail the leave approval if calendar sync fails
		frappe.log_error(
			f"Failed to create calendar event for {leave_app.name}: {str(e)}",
			"Leave Calendar Sync"
		)


def delete_google_calendar_event(leave_app):
	"""Delete the Google Calendar event when leave is cancelled.

	Args:
		leave_app: Leave Application document
	"""
	try:
		# Check if there's an event ID stored
		event_id = frappe.db.get_value("Leave Application", leave_app.name,
			"google_calendar_event_id")

		if not event_id:
			return

		# Check if Google Workspace is enabled
		if not frappe.db.exists("Google Workspace Settings"):
			return

		settings = frappe.get_single("Google Workspace Settings")
		if not settings.enabled or not settings.enable_calendar:
			return

		# Get Flexitime Settings
		flexitime_settings = frappe.get_single("Flexitime Settings")
		if not getattr(flexitime_settings, 'enable_calendar_sync', False):
			return

		calendar_manager = getattr(flexitime_settings, 'calendar_manager', None)
		if not calendar_manager:
			calendar_manager = get_connected_hr_manager()
			if not calendar_manager:
				return

		# Delete the event
		from integration_hub.services.calendar import GoogleCalendarService

		calendar_id = getattr(flexitime_settings, 'absences_calendar_id', 'primary')
		service = GoogleCalendarService(user=calendar_manager, calendar_id=calendar_id)

		service.delete_event(event_id, send_notifications=True)

		# Clear the stored event ID and URL
		frappe.db.set_value("Leave Application", leave_app.name,
			{
				"google_calendar_event_id": None,
				"google_calendar_event_url": None
			}, update_modified=False)
		frappe.db.commit()

		frappe.msgprint(
			"Calendar event deleted. Attendees will be notified.",
			indicator="blue",
			alert=True
		)

	except Exception as e:
		# Don't fail the cancellation if calendar delete fails
		frappe.log_error(
			f"Failed to delete calendar event for {leave_app.name}: {str(e)}",
			"Leave Calendar Sync"
		)


def get_connected_hr_manager():
	"""Find an HR Manager with Google Workspace authorized.

	Returns:
		str: Username of the first HR Manager with a valid refresh token, or None
	"""
	# Get users with HR Manager role
	hr_managers = frappe.get_all("Has Role", filters={
		"role": "HR Manager",
		"parenttype": "User"
	}, fields=["parent"])

	for hr in hr_managers:
		user = hr.parent
		try:
			user_doc = frappe.get_doc("User", user)
			if hasattr(user_doc, 'google_workspace_refresh_token'):
				token = user_doc.get_password('google_workspace_refresh_token')
				if token:
					return user
		except Exception:
			continue

	return None
