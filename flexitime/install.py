# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Post-installation setup for Flexitime application.

This module runs after the app is installed via `bench install-app flexitime`.
It creates the default data and custom fields required for the app to function.

Installation Steps:
    1. Custom Fields: Adds fields to Employee, Leave Application
    2. Client Scripts: Adds form customizations
    3. Leave Types: Creates "Flex Off" leave type
    4. Presence Types: Creates default presence types (Office, Home, Vacation, etc.)
    5. Email Templates: Creates reminder and alert templates

Custom Fields Created:
    Employee:
        - custom_flexitime_balance: Running flexitime balance
        - nickname: Short name for display in Roll Call
    
    Employee Presence Settings:
        - flexitime_balance: Read-only display of employee's flexitime balance (fetched from Employee)
        - uses_timesheet: Whether employee uses ERPNext Timesheets for time tracking
        - show_in_roll_call: Controls which employees appear in Roll Call view
        - requires_weekly_entry: Controls which employees must submit weekly entries

    Leave Application:
        - google_calendar_event_id: For calendar sync
        - google_calendar_event_url: Link to calendar event

Presence Types Created:
    Working: office, home_office, working_offsite
    Leave: vacation, sick_leave, flex_off, leave (generic)
    Scheduled: holiday, weekend, day_off

Email Templates:
    - Roll Call Reminder
    - Timesheet Reminder
    - Missing Timesheet Alert
    - HR Missing Timesheet Summary
    - Balance Over Limit
    - Balance Warning
    - HR Balance Alerts Summary

Usage:
    This module is called automatically via hooks.py:
        after_install = "flexitime.install.after_install"

    To re-run manually:
        bench --site <site> execute flexitime.install.after_install
"""

import frappe
import json
import os


def after_install():
	"""Post-installation setup for Flexitime app"""
	create_custom_fields()
	create_client_scripts()
	create_leave_types()
	create_presence_types()
	create_email_templates()
	configure_default_settings()
	create_default_palette_groups()
	frappe.db.commit()


def create_custom_fields():
	"""Create custom fields on various DocTypes"""
	custom_dir = os.path.join(os.path.dirname(__file__), "flexitime", "custom")

	if not os.path.exists(custom_dir):
		return

	# Process all JSON files in custom directory
	for filename in os.listdir(custom_dir):
		if not filename.endswith(".json"):
			continue

		custom_fields_path = os.path.join(custom_dir, filename)

		with open(custom_fields_path) as f:
			custom_fields = json.load(f)

		for field in custom_fields:
			# Check if field already exists
			existing = frappe.db.exists("Custom Field", {
				"dt": field.get("dt"),
				"fieldname": field.get("fieldname")
			})

			if not existing:
				doc = frappe.get_doc(field)
				doc.insert(ignore_permissions=True)
				frappe.logger().info(f"Created custom field: {field.get('dt')}.{field.get('fieldname')}")


def create_client_scripts():
	"""Create Client Scripts for form customizations"""
	fixture_path = os.path.join(
		os.path.dirname(__file__),
		"flexitime", "fixtures", "client_script.json"
	)

	if not os.path.exists(fixture_path):
		return

	with open(fixture_path) as f:
		scripts = json.load(f)

	for script in scripts:
		# Check if already exists
		if frappe.db.exists("Client Script", script.get("name")):
			frappe.logger().info(f"Client Script already exists: {script.get('name')}")
			continue

		try:
			doc = frappe.get_doc(script)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created Client Script: {script.get('name')}")
		except Exception as e:
			frappe.logger().warning(f"Could not create Client Script {script.get('name')}: {e}")


def create_leave_types():
	"""Create Leave Types required by Flexitime"""
	leave_types = [
		{
			"doctype": "Leave Type",
			"leave_type_name": "Flex Off",
			"is_lwp": 1,  # Leave Without Pay - no salary deduction, just balance tracking
			"max_leaves_allowed": 0,  # Unlimited
			"applicable_after": 0,
			"max_continuous_days_allowed": 0,  # Unlimited
			"include_holiday": 0,
			"is_compensatory": 0,
			"allow_encashment": 0,
			"is_earned_leave": 0,
			"is_carry_forward": 0,
		}
	]

	for lt in leave_types:
		if frappe.db.exists("Leave Type", lt.get("leave_type_name")):
			frappe.logger().info(f"Leave Type already exists: {lt.get('leave_type_name')}")
			continue

		try:
			doc = frappe.get_doc(lt)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created Leave Type: {lt.get('leave_type_name')}")
		except Exception as e:
			frappe.logger().warning(f"Could not create Leave Type {lt.get('leave_type_name')}: {e}")


def create_presence_types():
	"""Create default Presence Types.

	System types:
	- holiday: Auto-created by scheduled task, locked (employees can't edit)

	Non-system types:
	- day_off: Selectable by employees, created by Employee Work Pattern

	Note: Weekend is NOT a presence type - weekend cells are just empty.
	"""
	# REQUIRED presence types - these MUST exist for scheduled tasks to work
	required_presence_types = [
		{
			"doctype": "Presence Type",
			"presence_name": "holiday",
			"label": "Holiday",
			"icon": "🎊",
			"expect_work_hours": 0,
			"available_to_all": 0,
			"sort_order": 42
		},
		{
			# day_off is selectable by employees
			# and created by Employee Work Pattern with source="Pattern"
			"doctype": "Presence Type",
			"presence_name": "day_off",
			"label": "Day off",
			"icon": "🪁",
			"expect_work_hours": 0,
			"available_to_all": 1,  # Any employee can choose day_off
			"sort_order": 40
		}
	]

	# Create required presence types first (these MUST exist)
	for pt in required_presence_types:
		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			frappe.logger().info(f"Required presence type already exists: {pt.get('presence_name')}")
			continue

		try:
			doc = frappe.get_doc(pt)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created required presence type: {pt.get('presence_name')}")
		except Exception as e:
			# This is a critical error - log it prominently
			frappe.log_error(
				f"CRITICAL: Could not create required presence type {pt.get('presence_name')}: {e}",
				"Flexitime Install Error"
			)

	# Now load optional presence types from fixture file
	fixture_path = os.path.join(
		os.path.dirname(__file__),
		"flexitime", "fixtures", "presence_type.json"
	)

	if not os.path.exists(fixture_path):
		frappe.logger().info("No presence_type.json fixture found, skipping optional types")
		return

	with open(fixture_path) as f:
		presence_types = json.load(f)

	# Create all presence types from fixture (single pass)
	for pt in presence_types:
		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			continue

		# Skip leave_type validation if requires_leave_application but leave_type not set
		pt_copy = pt.copy()
		if pt_copy.get("requires_leave_application") and not pt_copy.get("leave_type"):
			pt_copy.pop("leave_type", None)  # Remove leave_type reference
			pt_copy["requires_leave_application"] = 0  # Temporarily set to 0 to bypass validation

		try:
			doc = frappe.get_doc(pt_copy)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created presence type: {pt.get('presence_name')}")
		except Exception as e:
			frappe.logger().warning(f"Could not create presence type {pt.get('presence_name')}: {e}")


def create_email_templates():
	"""Create email templates for notifications"""
	fixture_path = os.path.join(
		os.path.dirname(__file__),
		"flexitime", "fixtures", "email_template.json"
	)

	if not os.path.exists(fixture_path):
		return

	with open(fixture_path) as f:
		templates = json.load(f)

	for template in templates:
		# Check if already exists
		if frappe.db.exists("Email Template", template.get("name")):
			continue

		doc = frappe.get_doc(template)
		doc.insert(ignore_permissions=True)
		frappe.logger().info(f"Created email template: {template.get('name')}")


def configure_default_settings():
	"""Set default values in Flexitime Settings if not already set"""
	try:
		settings = frappe.get_single("Flexitime Settings")
		changed = False

		# Set default sick leave type if not set
		if not settings.sick_leave_type:
			# Try to find a leave type named "Sick Leave" or similar
			sick_leave = frappe.db.get_value("Leave Type", {"leave_type_name": ["like", "%Sick%"]}, "name")
			if sick_leave:
				settings.sick_leave_type = sick_leave
				changed = True
				frappe.logger().info(f"Set default sick leave type: {sick_leave}")

		# Set default holiday presence type if not set
		if not settings.holiday_presence_type:
			if frappe.db.exists("Presence Type", "holiday"):
				settings.holiday_presence_type = "holiday"
				changed = True
				frappe.logger().info("Set default holiday presence type: holiday")

		# Set default day off presence type if not set
		if not settings.day_off_presence_type:
			if frappe.db.exists("Presence Type", "day_off"):
				settings.day_off_presence_type = "day_off"
				changed = True
				frappe.logger().info("Set default day off presence type: day_off")

		if changed:
			settings.save(ignore_permissions=True)
			frappe.logger().info("Configured default Flexitime Settings")
	except Exception as e:
		frappe.logger().warning(f"Could not configure default settings: {e}")


def create_default_palette_groups():
	"""Create default Palette Group and assign all presence types to it"""
	try:
		# Check if Default palette group exists
		if not frappe.db.exists("Palette Group", "Default"):
			doc = frappe.get_doc({
				"doctype": "Palette Group",
				"group_name": "Default",
				"label": "Default",
				"sort_order": 0
			})
			doc.insert(ignore_permissions=True)
			frappe.logger().info("Created default Palette Group: Default")

		# Assign all presence types without a palette_group to Default
		frappe.db.sql("""
			UPDATE `tabPresence Type`
			SET palette_group = 'Default'
			WHERE palette_group IS NULL OR palette_group = ''
		""")
		frappe.db.commit()
		frappe.logger().info("Assigned unassigned presence types to Default palette group")

	except Exception as e:
		frappe.logger().warning(f"Could not create default palette group: {e}")
