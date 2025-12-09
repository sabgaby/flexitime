# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class EmployeePresenceSettings(Document):
	def validate(self):
		self.validate_duplicate_permissions()
		self.validate_date_ranges()

	def validate_duplicate_permissions(self):
		"""Check for duplicate presence types in permissions"""
		seen = set()
		for row in self.presence_permissions:
			if row.presence_type in seen:
				frappe.throw(f"Duplicate presence type: {row.presence_type}")
			seen.add(row.presence_type)

	def validate_date_ranges(self):
		"""Ensure from_date is before to_date when both are set"""
		for row in self.presence_permissions:
			if row.from_date and row.to_date and row.from_date > row.to_date:
				frappe.throw(f"From Date must be before To Date for {row.presence_type}")
