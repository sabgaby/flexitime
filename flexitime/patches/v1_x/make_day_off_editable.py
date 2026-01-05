# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Migration: Make day_off editable and remove auto-created weekend entries.

This patch:
1. Updates the day_off Presence Type to available_to_all=1 (is_system field removed in later version)
2. Converts existing source="System" day_off entries to source="Pattern"
3. Deletes all auto-created weekend entries (weekends are now left empty)

After this migration:
- Employees can edit their pre-filled day_off entries
- Employees can select day_off from the palette to swap their day off
- Weekend cells are empty (employees can record work if they work weekends)

Note: This patch may have already been executed. The is_system and requires_pattern_match
fields have been removed from Presence Type in favor of Flexitime Settings configuration.
"""

import frappe


def execute():
	# 1. Update day_off Presence Type to be selectable
	if frappe.db.exists("Presence Type", "day_off"):
		# Check if fields exist before trying to set them (for backward compatibility)
		update_values = {"available_to_all": 1}
		
		# Only set is_system if the field still exists (for older versions)
		if frappe.db.exists("Custom Field", {"dt": "Presence Type", "fieldname": "is_system"}):
			update_values["is_system"] = 0
		
		# Only set requires_pattern_match if the field still exists (for older versions)
		if frappe.db.exists("Custom Field", {"dt": "Presence Type", "fieldname": "requires_pattern_match"}):
			update_values["requires_pattern_match"] = 0  # Can be selected on any day for swapping
		
		frappe.db.set_value("Presence Type", "day_off", update_values)
		print("Updated day_off Presence Type: available_to_all=1")

	# 2. Convert existing System day_off entries to Pattern
	# This allows employees to edit them
	frappe.db.sql("""
		UPDATE `tabRoll Call Entry`
		SET source = 'Pattern'
		WHERE presence_type = 'day_off' AND source = 'System'
	""")

	day_off_count = frappe.db.sql("""
		SELECT COUNT(*) FROM `tabRoll Call Entry`
		WHERE presence_type = 'day_off' AND source = 'Pattern'
	""")[0][0]

	print(f"Converted day_off entries to source='Pattern': {day_off_count} entries")

	# 3. Delete all auto-created weekend entries
	# Weekends are now left empty - employees can record work if needed
	weekend_count = frappe.db.sql("""
		SELECT COUNT(*) FROM `tabRoll Call Entry`
		WHERE presence_type = 'weekend' AND source = 'System'
	""")[0][0]

	if weekend_count > 0:
		frappe.db.sql("""
			DELETE FROM `tabRoll Call Entry`
			WHERE presence_type = 'weekend' AND source = 'System'
		""")
		print(f"Deleted {weekend_count} auto-created weekend entries")

	# 4. Delete the weekend Presence Type itself
	# Weekend is not a presence type - it's just a day of the week
	if frappe.db.exists("Presence Type", "weekend"):
		frappe.delete_doc("Presence Type", "weekend", force=True)
		print("Deleted 'weekend' Presence Type - weekends are just empty cells now")

	frappe.db.commit()
