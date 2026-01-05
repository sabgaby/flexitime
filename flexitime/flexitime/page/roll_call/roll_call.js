/**
 * Roll Call Desk App Page
 * 
 * This file handles the desk app page initialization.
 * The RollCallTable class is now shared between desk app and portal,
 * loaded from /assets/flexitime/js/roll-call/RollCallTable.js
 * 
 * This ensures both desk app and portal always use the exact same code.
 */

frappe.pages['roll-call'].on_page_load = async function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Roll Call'),
		single_column: true
	});

	// Wait for dialog and palette modules to load (they're loaded via app_include_js)
	// Modules are loaded synchronously with app_include_js, but add a small check just in case
	const requiredModules = ['GridRenderer', 'SelectionManager', 'EventManager', 'ClipboardManager', 'UndoManager', 'DataManager', 'PresenceDialog', 'LeaveDialogs', 'BulkDialog', 'PaletteRenderer'];
	const checkModules = () => {
		if (!window.FlexitimeRollCall) return false;
		return requiredModules.every(name => window.FlexitimeRollCall[name]);
	};
	
	// Quick check - if not loaded, wait a bit (should be instant with app_include_js)
	if (!checkModules()) {
		let retries = 0;
		const maxRetries = 10; // 1 second max wait
		while (!checkModules() && retries < maxRetries) {
			await new Promise(resolve => setTimeout(resolve, 100));
			retries++;
		}
		
		if (!checkModules()) {
			$(wrapper).html(`<div class="alert alert-danger">${__('Failed to load page modules. Please refresh the page.')}</div>`);
			return;
		}
	}

	// Ensure RollCallTable class is loaded (from shared file in app_include_js)
	if (typeof RollCallTable === 'undefined') {
		$(wrapper).html(`<div class="alert alert-danger">${__('RollCallTable class not found. Please ensure RollCallTable.js is loaded.')}</div>`);
		return;
	}

	// Initialize Roll Call (toolbar is built inside the RollCallTable class)
	page.roll_call = new RollCallTable(page);
};

frappe.pages['roll-call'].refresh = function(wrapper) {
	const page = wrapper.page;
	if (page.roll_call) {
		page.roll_call.refresh();
	}
};
