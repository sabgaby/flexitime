# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cstr

no_cache = 1


def get_context(context):
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()

	context.csrf_token = csrf_token
	context.site_name = cstr(frappe.local.site)

	# Check if user is logged in
	if frappe.session.user == "Guest":
		context.is_guest = True
	else:
		context.is_guest = False
		context.user = frappe.session.user

	return context
