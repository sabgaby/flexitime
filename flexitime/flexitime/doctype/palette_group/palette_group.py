# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PaletteGroup(Document):
	def validate(self):
		if not self.label:
			self.label = self.group_name.replace("_", " ").title()
