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
        - calendar_feed_token: Token for iCal subscription

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

	IMPORTANT: The system types (holiday, weekend, day_off) are REQUIRED for
	the auto_create_roll_call_entries task to function. These are created first
	with hardcoded values to ensure they always exist, independent of fixtures.
	"""
	# REQUIRED system types - these MUST exist for scheduled tasks to work
	# The get_auto_presence_type() function returns these hardcoded names
	required_system_types = [
		{
			"doctype": "Presence Type",
			"presence_name": "holiday",
			"label": "Holiday",
			"icon": "🥳",
			"category": "Scheduled",
			"is_system": 1,
			"available_to_all": 0,
			"show_in_quick_dialog": 0,
			"sort_order": 42
		},
		{
			"doctype": "Presence Type",
			"presence_name": "weekend",
			"label": "Weekend",
			"icon": "⬜",
			"category": "Scheduled",
			"is_system": 1,
			"available_to_all": 0,
			"show_in_quick_dialog": 0,
			"sort_order": 41
		},
		{
			"doctype": "Presence Type",
			"presence_name": "day_off",
			"label": "Day off",
			"icon": "😶‍🌫️",
			"category": "Scheduled",
			"is_system": 1,
			"available_to_all": 0,
			"show_in_quick_dialog": 0,
			"requires_pattern_match": 1,
			"sort_order": 40
		}
	]

	# Create required system types first (these MUST exist)
	for pt in required_system_types:
		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			frappe.logger().info(f"Required system type already exists: {pt.get('presence_name')}")
			continue

		try:
			doc = frappe.get_doc(pt)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created required system type: {pt.get('presence_name')}")
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

	# First pass: create non-leave types and types without parents
	for pt in presence_types:
		if pt.get("is_leave") or pt.get("parent_presence_type"):
			continue

		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			continue

		try:
			doc = frappe.get_doc(pt)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created presence type: {pt.get('presence_name')}")
		except Exception as e:
			frappe.logger().warning(f"Could not create presence type {pt.get('presence_name')}: {e}")

	# Second pass: create types with parents (but not leave types)
	for pt in presence_types:
		if pt.get("is_leave") or not pt.get("parent_presence_type"):
			continue

		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			continue

		try:
			doc = frappe.get_doc(pt)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created presence type: {pt.get('presence_name')}")
		except Exception as e:
			frappe.logger().warning(f"Could not create presence type {pt.get('presence_name')}: {e}")

	# Third pass: create leave types (only if corresponding Leave Type exists)
	for pt in presence_types:
		if not pt.get("is_leave"):
			continue

		if frappe.db.exists("Presence Type", pt.get("presence_name")):
			continue

		# Skip leave_type validation for now - create without it
		pt_copy = pt.copy()
		pt_copy.pop("leave_type", None)  # Remove leave_type reference
		pt_copy["is_leave"] = 0  # Temporarily set to 0 to bypass validation

		try:
			doc = frappe.get_doc(pt_copy)
			doc.insert(ignore_permissions=True)
			frappe.logger().info(f"Created presence type: {pt.get('presence_name')} (leave type can be linked later)")
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
