// Copyright (c) 2025, Gaby and contributors
// For license information, please see license.txt

frappe.listview_settings['Employee Work Pattern'] = {
	filters: [
		['status', '=', 'Active']
	],
	get_indicator: function(doc) {
		if (doc.status === 'Active') {
			return [__('Active'), 'green', 'status,=,Active'];
		}
		return [__('Inactive'), 'grey', 'status,=,Inactive'];
	}
};
