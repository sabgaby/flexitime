# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, today


def execute():
	"""Set status field on all existing Employee Work Pattern records.

	Active = valid_from <= today AND (valid_to IS NULL OR valid_to >= today)
	Inactive = pattern has ended (valid_to < today)
	"""
	patterns = frappe.get_all("Employee Work Pattern",
		fields=["name", "valid_from", "valid_to"])

	if not patterns:
		return

	today_date = getdate(today())

	for p in patterns:
		valid_from = getdate(p.valid_from)
		valid_to = getdate(p.valid_to) if p.valid_to else None

		if valid_from <= today_date:
			if not valid_to or valid_to >= today_date:
				status = "Active"
			else:
				status = "Inactive"
		else:
			# Future pattern - still considered Active
			status = "Active"

		frappe.db.set_value("Employee Work Pattern", p.name, "status", status,
			update_modified=False)
