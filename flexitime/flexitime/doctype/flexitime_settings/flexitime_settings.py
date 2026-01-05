# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class FlexitimeSettings(Document):
	pass


@frappe.whitelist()
def get_palette_groups():
	"""Get palette groups with their presence types for Roll Call palette

	Returns:
		list: List of palette groups with their presence types
	"""
	# Get all palette groups ordered by sort_order
	groups = frappe.get_all(
		"Palette Group",
		fields=["name", "group_name", "label", "sort_order"],
		order_by="sort_order asc"
	)

	# Get all presence types with their palette_group
	presence_types = frappe.get_all(
		"Presence Type",
		fields=["name", "palette_group"],
		order_by="sort_order asc"
	)

	# Build groups with their presence types
	result = []
	for group in groups:
		pt_names = [
			pt["name"] for pt in presence_types
			if pt.get("palette_group") == group["name"]
		]
		result.append({
			"group_name": group["group_name"],
			"label": group["label"],
			"sort_order": group["sort_order"],
			"presence_types": pt_names
		})

	# Add unassigned presence types to a default "Other" group
	assigned = set()
	for group in result:
		assigned.update(group["presence_types"])

	unassigned = [pt["name"] for pt in presence_types if pt["name"] not in assigned]
	if unassigned:
		# If no groups exist, create a default one
		if not result:
			result.append({
				"group_name": "default",
				"label": "All",
				"sort_order": 0,
				"presence_types": unassigned
			})
		else:
			# Add unassigned to an "Other" group at the end
			result.append({
				"group_name": "other",
				"label": "Other",
				"sort_order": 999,
				"presence_types": unassigned
			})

	return result
