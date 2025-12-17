# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Row-level permission handlers for Flexitime DocTypes.

This module implements custom permission logic for Flexitime's core DocTypes.
It provides both query conditions (for list views) and document-level permission
checks to ensure employees can only access and modify appropriate data.

Permission Model Summary:
    Roll Call Entry:
        - HR Manager: Full access (read/write/delete all)
        - Employee: Read all (team visibility), write only own, cannot edit locked

    Weekly Entry:
        - HR Manager: Full access
        - Employee: Read/write only own, only when Draft

    Employee Work Pattern:
        - HR Manager: Full access
        - Employee: Read-only access to own pattern

Configuration:
    These handlers are registered in hooks.py:
        permission_query_conditions = {
            "Roll Call Entry": "flexitime.flexitime.permissions.roll_call_entry_query",
            ...
        }
        has_permission = {
            "Roll Call Entry": "flexitime.flexitime.permissions.has_roll_call_permission",
            ...
        }

Key Functions:
    get_employee_for_user: Get employee ID for a user
    roll_call_entry_query: List filter for Roll Call Entry
    has_roll_call_permission: Document-level check for Roll Call Entry
    weekly_entry_query: List filter for Weekly Entry
    has_weekly_entry_permission: Document-level check for Weekly Entry
    employee_work_pattern_query: List filter for Work Pattern
    has_work_pattern_permission: Document-level check for Work Pattern
"""

import frappe


def get_employee_for_user(user=None):
	"""Get employee ID for a user"""
	if not user:
		user = frappe.session.user

	return frappe.db.get_value("Employee", {"user_id": user}, "name")


# Roll Call Entry Permissions
def roll_call_entry_query(user):
	"""Permission query for Roll Call Entry

	- HR Manager can see all
	- Employee can see all (for team visibility) but only edit own
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return ""

	# All employees can see all entries (team visibility)
	return ""


def has_roll_call_permission(doc, ptype, user):
	"""Check permission for Roll Call Entry document

	- HR Manager can do anything
	- Employee can read all, but only write own (if not locked)
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return True

	employee = get_employee_for_user(user)

	if ptype == "read":
		# All employees can read all entries
		return True

	if ptype in ("write", "create"):
		# Can only write own entries
		if doc.employee != employee:
			return False

		# Cannot write if locked (unless it's a Leave source update)
		if doc.is_locked and doc.source != "Leave":
			return False

		return True

	return False


# Weekly Entry Permissions
def weekly_entry_query(user):
	"""Permission query for Weekly Entry

	- HR Manager can see all
	- Employee can only see own
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return ""

	employee = get_employee_for_user(user)
	if not employee:
		return "1=0"  # No access if not an employee

	# Use frappe.db.escape to prevent SQL injection
	return f"`tabWeekly Entry`.employee = {frappe.db.escape(employee)}"


def has_weekly_entry_permission(doc, ptype, user):
	"""Check permission for Weekly Entry document

	- HR Manager can do anything
	- Employee can only access own
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return True

	employee = get_employee_for_user(user)

	if doc.employee != employee:
		return False

	if ptype == "write":
		# Can only edit Draft entries
		if doc.status != "Draft":
			return False

	return True


# Employee Work Pattern Permissions
def employee_work_pattern_query(user):
	"""Permission query for Employee Work Pattern

	- HR Manager can see all
	- Employee can only see own
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return ""

	employee = get_employee_for_user(user)
	if not employee:
		return "1=0"  # No access if not an employee

	# Use frappe.db.escape to prevent SQL injection
	return f"`tabEmployee Work Pattern`.employee = {frappe.db.escape(employee)}"


def has_work_pattern_permission(doc, ptype, user):
	"""Check permission for Employee Work Pattern document

	- HR Manager can do anything
	- Employee can only read own
	"""
	if not user:
		user = frappe.session.user

	if "HR Manager" in frappe.get_roles(user):
		return True

	employee = get_employee_for_user(user)

	if doc.employee != employee:
		return False

	# Employees can only read their own patterns
	if ptype != "read":
		return False

	return True
