#!/usr/bin/env python3
"""Verification script to check if Flexitime app installation is complete.

This script verifies that all components created by install.py are present:
- Custom Fields
- Client Scripts
- Leave Types
- Presence Types
- Email Templates
- Default Settings

Usage:
    bench --site <site> execute flexitime.verify_installation.check_installation
"""

import frappe


def check_installation():
	"""Verify all installation components are present"""
	results = {
		"custom_fields": check_custom_fields(),
		"client_scripts": check_client_scripts(),
		"leave_types": check_leave_types(),
		"presence_types": check_presence_types(),
		"email_templates": check_email_templates(),
		"settings": check_settings(),
	}
	
	# Print results
	print("\n" + "=" * 60)
	print("Flexitime Installation Verification")
	print("=" * 60 + "\n")
	
	all_passed = True
	for component, status in results.items():
		status_icon = "✓" if status["passed"] else "✗"
		status_text = "PASS" if status["passed"] else "FAIL"
		print(f"{status_icon} {component.replace('_', ' ').title()}: {status_text}")
		if not status["passed"]:
			all_passed = False
			if status.get("missing"):
				print(f"   Missing: {', '.join(status['missing'])}")
			if status.get("errors"):
				for error in status["errors"]:
					print(f"   Error: {error}")
	
	print("\n" + "=" * 60)
	if all_passed:
		print("✓ All installation components verified successfully!")
	else:
		print("✗ Some installation components are missing or incorrect.")
	print("=" * 60 + "\n")
	
	return all_passed


def check_custom_fields():
	"""Verify custom fields exist"""
	result = {"passed": True, "missing": []}
	
	expected_fields = [
		{"dt": "Employee", "fieldname": "custom_flexitime_balance"},
		{"dt": "Employee", "fieldname": "nickname"},
		{"dt": "Leave Application", "fieldname": "google_calendar_event_id"},
		{"dt": "Leave Application", "fieldname": "google_calendar_event_url"},
	]
	
	for field in expected_fields:
		exists = frappe.db.exists("Custom Field", {
			"dt": field["dt"],
			"fieldname": field["fieldname"]
		})
		if not exists:
			result["passed"] = False
			result["missing"].append(f"{field['dt']}.{field['fieldname']}")
	
	return result


def check_client_scripts():
	"""Verify client scripts exist"""
	result = {"passed": True, "missing": []}
	
	# Check if any client scripts from Flexitime module exist
	count = frappe.db.count("Client Script", {
		"module": "Flexitime"
	})
	
	if count == 0:
		result["passed"] = False
		result["missing"].append("All Flexitime client scripts")
	
	return result


def check_leave_types():
	"""Verify Flex Off leave type exists"""
	result = {"passed": True, "missing": []}
	
	if not frappe.db.exists("Leave Type", "Flex Off"):
		result["passed"] = False
		result["missing"].append("Flex Off")
	
	return result


def check_presence_types():
	"""Verify required presence types exist"""
	result = {"passed": True, "missing": []}
	
	required_types = ["holiday", "day_off"]
	
	for pt_name in required_types:
		if not frappe.db.exists("Presence Type", pt_name):
			result["passed"] = False
			result["missing"].append(pt_name)
	
	return result


def check_email_templates():
	"""Verify email templates exist"""
	result = {"passed": True, "missing": []}
	
	expected_templates = [
		"Roll Call Reminder",
		"Timesheet Reminder",
		"Missing Timesheet Alert",
		"HR Missing Timesheet Summary",
		"Balance Over Limit",
		"Balance Warning",
		"HR Balance Alerts Summary",
	]
	
	for template_name in expected_templates:
		if not frappe.db.exists("Email Template", template_name):
			result["passed"] = False
			result["missing"].append(template_name)
	
	return result


def check_settings():
	"""Verify Flexitime Settings can be loaded"""
	result = {"passed": True, "errors": []}
	
	try:
		settings = frappe.get_single("Flexitime Settings")
		# Just verify it loads without error
		_ = settings.name
	except Exception as e:
		result["passed"] = False
		result["errors"].append(str(e))
	
	return result


if __name__ == "__main__":
	# Allow running as bench execute script
	import sys
	if len(sys.argv) > 1 and sys.argv[1] == "execute":
		check_installation()

