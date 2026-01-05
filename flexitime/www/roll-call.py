# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Portal Roll Call page context provider.

This module provides the context for the website Roll Call page,
which allows employees to view and edit their roll call entries
without access to the Frappe Desk.

Requirements:
    - User must be logged in (not Guest)
    - User must have an active Employee record linked to their account
"""

import frappe
from frappe import _


def get_context(context):
    """Build context for the Roll Call portal page.

    Args:
        context: Frappe context object to populate

    Returns:
        dict: Context with current_employee and other page data

    Raises:
        frappe.PermissionError: If user is not logged in
    """
    # Require login
    if frappe.session.user == "Guest":
        frappe.throw(_("Please login to access Roll Call"), frappe.PermissionError)

    # Get current employee
    current_employee = frappe.db.get_value(
        "Employee",
        {"user_id": frappe.session.user, "status": "Active"},
        "name"
    )

    if not current_employee:
        frappe.throw(
            _("No active employee record found for your account. "
              "Please contact HR to set up your employee profile."),
            frappe.PermissionError
        )

    # Get user roles for JavaScript
    user_doc = frappe.get_doc("User", frappe.session.user)
    user_roles = [r.role for r in user_doc.roles]

    context.current_employee = current_employee
    context.user_roles = user_roles
    context.no_cache = 1
    context.show_sidebar = False

    return context
