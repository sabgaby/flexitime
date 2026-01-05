/**
 * Roll Call Main Entry Point
 * 
 * This is the main entry point for the roll call desk page.
 * It initializes the RollCallTable class and sets up the page.
 * 
 * Note: This is a refactoring in progress. The full RollCallTable class
 * is still in roll_call.js but will be gradually split into modules.
 */

frappe.pages['roll-call'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Roll Call'),
		single_column: true
	});

	// Initialize Roll Call (toolbar is built inside the RollCallTable class)
	// TODO: Once RollCallTable is fully modularized, import it here
	page.roll_call = new RollCallTable(page);
};

frappe.pages['roll-call'].refresh = function(wrapper) {
	const page = wrapper.page;
	if (page.roll_call) {
		page.roll_call.refresh();
	}
};

// Note: RollCallTable class is currently still in roll_call.js
// This file serves as the entry point and will be updated as modules are extracted
