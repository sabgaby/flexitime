# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Row-level permission handlers for Flexitime DocTypes.

This module implements custom permission logic for Flexitime's core DocTypes.
It provides both query conditions (for list views) and document-level permission
checks to ensure employees can only access and modify appropriate data.

Permission Model Summary:
    Roll Call Entry:
        - HR Manager: Full access (read/write/delete all)
        - HR User: Full access (read/write/create all, no delete)
        - Leave Approver: Read-only access to employees whose leave they can approve
        - Employee: Read all (team visibility), write only own, cannot edit locked

    Weekly Entry:
        - HR Manager: Full access
        - HR User: Full access (read/write/create/submit all, no delete/cancel)
        - Leave Approver: Read-only access to employees whose leave they can approve
        - Employee: Read/write only own, only when Draft

    Employee Work Pattern:
        - HR Manager: Full access
        - HR User: Full access (read/write/create/submit all, no delete/cancel)
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
    get_employees_for_leave_approver: Get employees a Leave Approver can see (User Permissions or query)
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


def get_employees_for_leave_approver(user=None):
	"""Get list of employee IDs that a Leave Approver can see.
	
	Uses User Permissions first (if configured), then falls back to querying
	Leave Applications or Employee records where user is the approver.
	
	Args:
		user: User ID (defaults to current user)
		
	Returns:
		list: Employee IDs, or None if user is not a Leave Approver
	"""
	if not user:
		user = frappe.session.user
	
	roles = frappe.get_roles(user)
	if "Leave Approver" not in roles:
		return None
	
	# Option C: Check User Permissions first (most efficient if configured)
	user_perms = frappe.permissions.get_user_permissions(user)
	if user_perms and "Employee" in user_perms:
		# Extract employee names from the permission dicts
		allowed_employees = [p.get("doc") for p in user_perms["Employee"] if p.get("doc")]
		if allowed_employees:
			return allowed_employees
	
	# Fallback: Query employees where user is leave_approver
	# This handles cases where User Permissions aren't set up
	employees = frappe.get_all(
		"Employee",
		filters={"leave_approver": user, "status": "Active"},
		pluck="name",
		limit_page_length=0
	)
	
	# Also check Leave Applications with pending status where user is approver
	# This catches cases where approver is set at application level
	pending_leave_employees = frappe.get_all(
		"Leave Application",
		filters={
			"leave_approver": user,
			"status": ["in", ["Open", "Pending Approval"]],
			"docstatus": 0
		},
		pluck="employee",
		distinct=True,
		limit_page_length=0
	)
	
	# Combine and deduplicate
	all_employees = list(set(employees + pending_leave_employees))
	return all_employees if all_employees else None


# Roll Call Entry Permissions
def roll_call_entry_query(user):
	"""Permission query for Roll Call Entry

	- HR Manager and HR User can see all
	- Leave Approver can see entries for employees whose leave they can approve
	- Employee can see all (for team visibility) but only edit own
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles or "HR User" in roles:
		return ""
	
	# Leave Approver: filter by employees they can approve
	leave_approver_employees = get_employees_for_leave_approver(user)
	if leave_approver_employees:
		# Also include their own employee record if they are an employee
		own_employee = get_employee_for_user(user)
		if own_employee and own_employee not in leave_approver_employees:
			leave_approver_employees.append(own_employee)
		
		# Build SQL condition
		escaped_employees = [frappe.db.escape(emp) for emp in leave_approver_employees]
		return f"`tabRoll Call Entry`.employee IN ({','.join(escaped_employees)})"

	# All employees can see all entries (team visibility)
	return ""


def has_roll_call_permission(doc, ptype, user):
	"""Check permission for Roll Call Entry document

	- HR Manager can do anything
	- HR User can read/write/create all (no delete)
	- Leave Approver can read entries for employees whose leave they can approve (read-only)
	- Employee can read all, but only write own (if not locked)
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles:
		return True
	
	if "HR User" in roles:
		# HR User can read/write/create, but not delete
		if ptype == "delete":
			return False
		return True
	
	# Leave Approver: read-only access to employees they can approve
	leave_approver_employees = get_employees_for_leave_approver(user)
	if leave_approver_employees:
		# Also include their own employee record if they are an employee
		own_employee = get_employee_for_user(user)
		if own_employee and own_employee not in leave_approver_employees:
			leave_approver_employees.append(own_employee)
		
		# Read access if employee is in their list
		if ptype == "read" and doc.employee in leave_approver_employees:
			return True
		
		# Write/create/delete: not allowed for Leave Approvers
		if ptype in ("write", "create", "delete"):
			return False

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

	- HR Manager and HR User can see all
	- Leave Approver can see entries for employees whose leave they can approve
	- Employee can only see own
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles or "HR User" in roles:
		return ""
	
	# Leave Approver: filter by employees they can approve
	leave_approver_employees = get_employees_for_leave_approver(user)
	if leave_approver_employees:
		# Also include their own employee record if they are an employee
		own_employee = get_employee_for_user(user)
		if own_employee and own_employee not in leave_approver_employees:
			leave_approver_employees.append(own_employee)
		
		# Build SQL condition
		escaped_employees = [frappe.db.escape(emp) for emp in leave_approver_employees]
		return f"`tabWeekly Entry`.employee IN ({','.join(escaped_employees)})"

	employee = get_employee_for_user(user)
	if not employee:
		return "1=0"  # No access if not an employee

	# Use frappe.db.escape to prevent SQL injection
	return f"`tabWeekly Entry`.employee = {frappe.db.escape(employee)}"


def has_weekly_entry_permission(doc, ptype, user):
	"""Check permission for Weekly Entry document

	- HR Manager can do anything
	- HR User can read/write/create/submit all (no delete/cancel)
	- Leave Approver can read entries for employees whose leave they can approve (read-only)
	- Employee can only access own, only when Draft
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles:
		return True
	
	if "HR User" in roles:
		# HR User can read/write/create/submit, but not delete/cancel
		if ptype in ("delete", "cancel"):
			return False
		return True
	
	employee = get_employee_for_user(user)

	# Leave Approver: read-only access to OTHER employees whose leave they can approve
	# (their own entries are handled by the Employee logic below)
	leave_approver_employees = get_employees_for_leave_approver(user)
	if leave_approver_employees and doc.employee != employee:
		# This is another employee's entry - Leave Approver can only read
		if doc.employee in leave_approver_employees:
			if ptype == "read":
				return True
			# Write/create/submit/delete/cancel: not allowed for others' entries
			return False

	if doc.employee != employee:
		return False

	if ptype == "read":
		return True

	if ptype in ("write", "submit"):
		# Can only edit/submit Draft entries (docstatus = 0)
		if doc.docstatus != 0:
			return False
		return True

	# Employees cannot delete or cancel
	if ptype in ("delete", "cancel"):
		return False

	return True


# Employee Work Pattern Permissions
def employee_work_pattern_query(user):
	"""Permission query for Employee Work Pattern

	- HR Manager and HR User can see all
	- Employee can only see own
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles or "HR User" in roles:
		return ""

	employee = get_employee_for_user(user)
	if not employee:
		return "1=0"  # No access if not an employee

	# Use frappe.db.escape to prevent SQL injection
	return f"`tabEmployee Work Pattern`.employee = {frappe.db.escape(employee)}"


def has_work_pattern_permission(doc, ptype, user):
	"""Check permission for Employee Work Pattern document

	- HR Manager can do anything
	- HR User can read/write/create/submit all (no delete/cancel)
	- Employee can only read own
	"""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "HR Manager" in roles:
		return True
	
	if "HR User" in roles:
		# HR User can read/write/create/submit, but not delete/cancel
		if ptype in ("delete", "cancel"):
			return False
		return True

	employee = get_employee_for_user(user)

	if doc.employee != employee:
		return False

	# Employees can only read their own patterns
	if ptype != "read":
		return False

	return True
