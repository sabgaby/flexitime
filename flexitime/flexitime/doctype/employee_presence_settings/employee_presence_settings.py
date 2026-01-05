# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class EmployeePresenceSettings(Document):
	def onload(self):
		"""Load flexitime balance from Employee doctype"""
		if self.employee:
			balance = frappe.db.get_value("Employee", self.employee, "custom_flexitime_balance") or 0
			self.flexitime_balance = balance

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


@frappe.whitelist()
def get_employee_query(doctype, txt, searchfield, start, page_len, filters):
	"""Filter Employee link field to show only employees without Employee Presence Settings
	
	This query is used when selecting an employee in the Employee Presence Settings form.
	It excludes employees who already have an Employee Presence Settings record.
	"""
	# Get current document name from filters (if editing existing record)
	current_docname = None
	if filters and isinstance(filters, dict):
		current_docname = filters.get("name")
	
	# Get current employee if editing existing record
	current_employee = None
	if current_docname and current_docname != "new-employee-presence-settings":
		try:
			current_employee = frappe.db.get_value("Employee Presence Settings", current_docname, "employee")
		except frappe.DoesNotExistError:
			pass
	
	# Get all employees who already have settings
	existing_employees = frappe.get_all(
		"Employee Presence Settings",
		fields=["employee"],
		pluck="employee"
	)
	
	# Build query filters
	query_filters = {
		"status": "Active"
	}
	
	# Exclude employees who already have settings, but allow current employee if editing
	if existing_employees:
		employees_to_exclude = [e for e in existing_employees if e != current_employee]
		if employees_to_exclude:
			query_filters["name"] = ["not in", employees_to_exclude]
	
	# Add search text filter if provided
	if txt:
		query_filters["employee_name"] = ["like", f"%{txt}%"]
	
	# Get employees matching filters
	employees = frappe.get_all(
		"Employee",
		filters=query_filters,
		fields=["name", "employee_name"],
		limit_start=start,
		limit_page_length=page_len,
		order_by="employee_name asc"
	)
	
	return [[emp.name, emp.employee_name] for emp in employees]
