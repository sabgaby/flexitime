"""iCal calendar feed for employee absences.

Provides .ics calendar feeds that can be subscribed to in Google Calendar,
Apple Calendar, Outlook, etc.

Each employee gets a unique token-based URL that doesn't require authentication,
allowing external calendar apps to fetch the feed.
"""
import frappe
from frappe import _
from frappe.utils import getdate, add_months, today
import hashlib
import secrets


def get_or_create_calendar_token(employee: str) -> str:
	"""Get or create a calendar subscription token for an employee.

	The token is stored in a custom field on Employee and is used to
	authenticate calendar feed requests without requiring login.
	"""
	token = frappe.db.get_value("Employee", employee, "calendar_feed_token")

	if not token:
		# Generate a secure random token
		token = secrets.token_urlsafe(32)
		frappe.db.set_value("Employee", employee, "calendar_feed_token", token)
		frappe.db.commit()

	return token


def get_employee_from_token(token: str) -> str | None:
	"""Look up employee from calendar token."""
	if not token:
		return None
	return frappe.db.get_value("Employee", {"calendar_feed_token": token}, "name")


def get_employee_display_name(employee: str, context: str = "calendar") -> str:
	"""Get employee display name based on Flexitime Settings.

	Args:
		employee: Employee ID
		context: "roll_call" or "calendar" - which setting to use

	Returns:
		Formatted display name
	"""
	# Get employee details
	emp = frappe.db.get_value(
		"Employee",
		employee,
		["employee_name", "nickname", "prefered_email", "company_email", "personal_email"],
		as_dict=True
	)
	if not emp:
		return employee

	# Get display format from settings
	try:
		if context == "roll_call":
			display_format = frappe.db.get_single_value("Flexitime Settings", "roll_call_display_name") or "Full Name"
		else:
			display_format = frappe.db.get_single_value("Flexitime Settings", "calendar_display_name") or "Nickname"
	except Exception:
		display_format = "Full Name"

	nickname = emp.get("nickname") or ""
	full_name = emp.get("employee_name") or employee

	if display_format == "Nickname" and nickname:
		return nickname
	elif display_format == "Nickname (Full Name)" and nickname:
		return f"{nickname} ({full_name})"
	elif display_format == "Full Name (Nickname)" and nickname:
		return f"{full_name} ({nickname})"
	else:
		# Default to full name
		return full_name


def get_employee_email(employee: str) -> str | None:
	"""Get the best email for an employee."""
	emp = frappe.db.get_value(
		"Employee",
		employee,
		["prefered_email", "company_email", "personal_email", "user_id"],
		as_dict=True
	)
	if not emp:
		return None

	# Priority: prefered_email > company_email > user_id > personal_email
	return (
		emp.get("prefered_email") or
		emp.get("company_email") or
		emp.get("user_id") or
		emp.get("personal_email")
	)


def generate_ical_uid(employee: str, date: str, suffix: str = "") -> str:
	"""Generate a unique UID for an iCal event."""
	base = f"{employee}-{date}{suffix}"
	return hashlib.md5(base.encode()).hexdigest() + "@flexitime"


def escape_ical_text(text: str) -> str:
	"""Escape special characters for iCal format."""
	if not text:
		return ""
	# Escape backslash first, then other special chars
	text = text.replace("\\", "\\\\")
	text = text.replace(";", "\\;")
	text = text.replace(",", "\\,")
	text = text.replace("\n", "\\n")
	return text


def format_ical_date(date) -> str:
	"""Format a date for iCal (all-day event)."""
	d = getdate(date)
	return d.strftime("%Y%m%d")


@frappe.whitelist(allow_guest=True)
def get_calendar_feed(token: str = None):
	"""Generate iCal feed for an employee's absences.

	This endpoint is accessible without login using a personal token.
	Includes holidays and leave types (NOT weekends or day_off).

	Args:
		token: The employee's calendar subscription token

	Returns:
		iCal formatted calendar data (.ics)
	"""
	if not token:
		frappe.throw(_("Calendar token is required"), frappe.AuthenticationError)

	employee = get_employee_from_token(token)
	if not employee:
		frappe.throw(_("Invalid calendar token"), frappe.AuthenticationError)

	# Get employee details for calendar name and attendee
	display_name = get_employee_display_name(employee, "calendar")
	emp_email = get_employee_email(employee)

	# Get entries for the past 3 months and next 12 months
	from_date = add_months(today(), -3)
	to_date = add_months(today(), 12)

	# Get presence types to include in calendar:
	# - "holiday" from Scheduled category
	# - All "Leave" category types
	# Explicitly EXCLUDE: weekend, day_off (not useful in calendar)
	calendar_types = frappe.get_all(
		"Presence Type",
		filters=[
			["category", "in", ["Scheduled", "Leave"]],
			["name", "not in", ["weekend", "day_off"]]
		],
		fields=["name", "label", "icon", "category"],
	)
	calendar_type_names = [pt.name for pt in calendar_types]
	type_info = {pt.name: pt for pt in calendar_types}

	if not calendar_type_names:
		# Return empty calendar
		return build_ical_response(display_name, [], emp_email)

	# Get roll call entries - include leave_application and source for filtering
	entries = frappe.get_all(
		"Roll Call Entry",
		filters={
			"employee": employee,
			"date": ["between", [from_date, to_date]],
			"presence_type": ["in", calendar_type_names],
		},
		fields=[
			"name",
			"date",
			"presence_type",
			"presence_type_label",
			"presence_type_icon",
			"is_half_day",
			"am_presence_type",
			"pm_presence_type",
			"notes",
			"source",
			"leave_application",
		],
		order_by="date asc",
	)

	# Also check for split days where only AM or PM is a calendar type
	split_entries = frappe.get_all(
		"Roll Call Entry",
		filters={
			"employee": employee,
			"date": ["between", [from_date, to_date]],
			"is_half_day": 1,
		},
		fields=[
			"name",
			"date",
			"presence_type",
			"is_half_day",
			"am_presence_type",
			"pm_presence_type",
			"notes",
			"source",
			"leave_application",
		],
		order_by="date asc",
	)

	# Filter entries: only include if NOT from Leave Application OR if Leave Application is Approved
	# - source == "Manual" or "System" → include (holidays, manual entries)
	# - source == "Leave" → only include if Leave Application status is "Approved"
	def is_entry_approved(entry):
		if entry.source != "Leave":
			return True  # Not a leave, include it (holidays, manual entries)
		if not entry.leave_application:
			return True  # No linked leave application, include it
		# Check Leave Application status
		status = frappe.db.get_value("Leave Application", entry.leave_application, "status")
		return status == "Approved"

	entries = [e for e in entries if is_entry_approved(e)]
	split_entries = [e for e in split_entries if is_entry_approved(e)]

	# Build calendar events
	events = []
	processed_dates = set()

	# Process full-day entries
	for entry in entries:
		if entry.date in processed_dates:
			continue
		processed_dates.add(entry.date)

		pt = type_info.get(entry.presence_type, {})

		if entry.is_half_day:
			# Split day - create event for the calendar-relevant half
			am_type = entry.am_presence_type
			pm_type = entry.pm_presence_type

			if am_type in calendar_type_names and pm_type in calendar_type_names:
				# Both halves are calendar-relevant - show as full day
				events.append({
					"uid": generate_ical_uid(employee, str(entry.date)),
					"date": entry.date,
					"summary": f"{display_name} {entry.presence_type_icon or pt.get('icon', '')} {entry.presence_type_label or pt.get('label', entry.presence_type)}",
					"description": entry.notes or "",
					"all_day": True,
				})
			else:
				# Only one half is calendar-relevant
				if am_type in calendar_type_names:
					am_info = type_info.get(am_type, {})
					events.append({
						"uid": generate_ical_uid(employee, str(entry.date), "-am"),
						"date": entry.date,
						"summary": f"{display_name} {am_info.get('icon', '')} {am_info.get('label', am_type)} (AM)",
						"description": entry.notes or "",
						"all_day": True,
					})
				if pm_type in calendar_type_names:
					pm_info = type_info.get(pm_type, {})
					events.append({
						"uid": generate_ical_uid(employee, str(entry.date), "-pm"),
						"date": entry.date,
						"summary": f"{display_name} {pm_info.get('icon', '')} {pm_info.get('label', pm_type)} (PM)",
						"description": entry.notes or "",
						"all_day": True,
					})
		else:
			# Full day entry
			events.append({
				"uid": generate_ical_uid(employee, str(entry.date)),
				"date": entry.date,
				"summary": f"{display_name} {entry.presence_type_icon or pt.get('icon', '')} {entry.presence_type_label or pt.get('label', entry.presence_type)}",
				"description": entry.notes or "",
				"all_day": True,
			})

	# Process split days that weren't already captured
	for entry in split_entries:
		if entry.date in processed_dates:
			continue

		am_type = entry.am_presence_type
		pm_type = entry.pm_presence_type

		has_calendar_event = False

		if am_type in calendar_type_names:
			has_calendar_event = True
			am_info = type_info.get(am_type, {})
			events.append({
				"uid": generate_ical_uid(employee, str(entry.date), "-am"),
				"date": entry.date,
				"summary": f"{display_name} {am_info.get('icon', '')} {am_info.get('label', am_type)} (AM)",
				"description": entry.notes or "",
				"all_day": True,
			})

		if pm_type in calendar_type_names:
			has_calendar_event = True
			pm_info = type_info.get(pm_type, {})
			events.append({
				"uid": generate_ical_uid(employee, str(entry.date), "-pm"),
				"date": entry.date,
				"summary": f"{display_name} {pm_info.get('icon', '')} {pm_info.get('label', pm_type)} (PM)",
				"description": entry.notes or "",
				"all_day": True,
			})

		if has_calendar_event:
			processed_dates.add(entry.date)

	return build_ical_response(display_name, events, emp_email)


def build_ical_response(calendar_name: str, events: list, attendee_email: str = None) -> str:
	"""Build the iCal response with proper headers.

	Args:
		calendar_name: Name for the calendar
		events: List of event dicts
		attendee_email: Optional email to add as ATTENDEE (shows on their calendar)
	"""
	from frappe.utils import now_datetime

	# Build iCal content
	lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Flexitime//Calendar Feed//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		f"X-WR-CALNAME:{escape_ical_text(calendar_name)} - Absences",
		"X-WR-TIMEZONE:UTC",
	]

	# Add events
	for event in events:
		lines.extend([
			"BEGIN:VEVENT",
			f"UID:{event['uid']}",
			f"DTSTAMP:{now_datetime().strftime('%Y%m%dT%H%M%SZ')}",
			f"DTSTART;VALUE=DATE:{format_ical_date(event['date'])}",
			f"DTEND;VALUE=DATE:{format_ical_date(getdate(event['date']) + frappe.utils.datetime.timedelta(days=1))}",
			f"SUMMARY:{escape_ical_text(event['summary'])}",
		])

		if event.get("description"):
			lines.append(f"DESCRIPTION:{escape_ical_text(event['description'])}")

		# Add employee as attendee so event appears on their personal calendar
		if attendee_email:
			lines.append(f"ATTENDEE;PARTSTAT=ACCEPTED;CN={escape_ical_text(calendar_name)}:mailto:{attendee_email}")

		lines.append("TRANSP:TRANSPARENT")  # Don't block time
		lines.append("END:VEVENT")

	lines.append("END:VCALENDAR")

	# Join with CRLF as per RFC 5545
	ical_content = "\r\n".join(lines)

	# Set response headers for .ics file
	frappe.response.filename = "calendar.ics"
	frappe.response.filecontent = ical_content
	frappe.response.type = "download"
	frappe.response.content_type = "text/calendar; charset=utf-8"

	return ical_content


@frappe.whitelist()
def get_my_calendar_url():
	"""Get the calendar subscription URL for the current user.

	Returns:
		dict with calendar_url and instructions
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please login to get your calendar URL"), frappe.AuthenticationError)

	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if not employee:
		frappe.throw(_("No employee record found for your user account"))

	token = get_or_create_calendar_token(employee)

	# Build the subscription URL
	site_url = frappe.utils.get_url()
	calendar_url = f"{site_url}/api/method/flexitime.api.calendar.get_calendar_feed?token={token}"

	return {
		"calendar_url": calendar_url,
		"instructions": _(
			"Use this URL to subscribe to your absence calendar in Google Calendar, "
			"Apple Calendar, or Outlook. The calendar updates automatically."
		)
	}


@frappe.whitelist()
def regenerate_calendar_token():
	"""Regenerate the calendar subscription token for the current user.

	Use this if you want to invalidate the old URL and create a new one.

	Returns:
		dict with new calendar_url
	"""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please login"), frappe.AuthenticationError)

	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if not employee:
		frappe.throw(_("No employee record found for your user account"))

	# Generate new token (overwrites existing)
	token = secrets.token_urlsafe(32)
	frappe.db.set_value("Employee", employee, "calendar_feed_token", token)
	frappe.db.commit()

	# Build the new subscription URL
	site_url = frappe.utils.get_url()
	calendar_url = f"{site_url}/api/method/flexitime.api.calendar.get_calendar_feed?token={token}"

	return {
		"calendar_url": calendar_url,
		"message": _("Calendar token regenerated. Update your calendar subscription with the new URL.")
	}
