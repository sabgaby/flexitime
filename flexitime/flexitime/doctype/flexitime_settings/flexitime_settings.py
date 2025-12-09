# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class FlexitimeSettings(Document):
	pass


def get_settings():
	"""Get Flexitime Settings (cached)

	Returns:
		FlexitimeSettings document
	"""
	return frappe.get_cached_doc("Flexitime Settings")
