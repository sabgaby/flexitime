/**
 * Portal Wrapper for Roll Call Desk App
 * 
 * This script makes the portal use the exact same RollCallTable class as the desk app.
 * It creates a minimal wrapper that mimics frappe.ui.make_app_page structure.
 */

(function() {
	'use strict';

	// Wait for DOM and modules to be ready
	document.addEventListener('DOMContentLoaded', async function() {
		// Check if user is logged in
		if (!window.rollCallPortalData?.isLoggedIn) {
			window.location.href = '/login?redirect-to=/roll-call';
			return;
		}

		// Wait for jQuery and Frappe to be available (they might be loaded by the website template)
		// If not available, we'll use a minimal shim
		if (typeof jQuery === 'undefined') {
			console.error('jQuery is required for Roll Call. Please ensure it is loaded.');
			return;
		}

		// Wait for required modules to load
		const requiredModules = ['GridRenderer', 'SelectionManager', 'EventManager', 'ClipboardManager', 'UndoManager', 'DataManager', 'PresenceDialog', 'LeaveDialogs', 'BulkDialog', 'PaletteRenderer'];
		const checkModules = () => {
			if (!window.FlexitimeRollCall) return false;
			return requiredModules.every(name => window.FlexitimeRollCall[name]);
		};

		// Wait for modules (with timeout)
		let retries = 0;
		const maxRetries = 50; // 5 seconds max wait
		while (!checkModules() && retries < maxRetries) {
			await new Promise(resolve => setTimeout(resolve, 100));
			retries++;
		}

		if (!checkModules()) {
			document.getElementById('roll-call-page-wrapper').innerHTML = 
				'<div class="alert alert-danger">Failed to load page modules. Please refresh the page.</div>';
			return;
		}

		// Create a minimal Frappe shim if needed
		if (typeof frappe === 'undefined') {
			// Translation function (global)
			if (typeof window.__ === 'undefined') {
				window.__ = function(text) {
					return text; // Portal can implement proper i18n if needed
				};
			}
			
			window.frappe = {
				datetime: {
					get_today: function() {
						const today = new Date();
						const year = today.getFullYear();
						const month = String(today.getMonth() + 1).padStart(2, '0');
						const day = String(today.getDate()).padStart(2, '0');
						return `${year}-${month}-${day}`;
					},
					str_to_obj: function(dateStr) {
						return new Date(dateStr + 'T00:00:00');
					},
					obj_to_str: function(dateObj) {
						const year = dateObj.getFullYear();
						const month = String(dateObj.getMonth() + 1).padStart(2, '0');
						const day = String(dateObj.getDate()).padStart(2, '0');
						return `${year}-${month}-${day}`;
					},
					str_to_user: function(dateStr) {
						const date = new Date(dateStr + 'T00:00:00');
						return date.toLocaleDateString('en-US', { 
							year: 'numeric', 
							month: 'short', 
							day: 'numeric' 
						});
					}
				},
				call: function(options) {
					// Use fetch API for portal
					return fetch('/api/method/' + options.method, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Frappe-CSRF-Token': window.rollCallPortalData?.csrfToken || ''
						},
						body: JSON.stringify(options.args || {})
					})
					.then(response => {
						if (!response.ok) {
							throw new Error(`API call failed: ${response.status}`);
						}
						return response.json();
					})
					.then(data => {
						return { message: data.message };
					});
				},
				user_roles: [], // Will be populated if available
				session: {
					user: window.rollCallPortalData?.isLoggedIn ? 'User' : 'Guest'
				},
				defaults: {
					get_user_default: function(key) {
						// Return null for portal - filters will work without defaults
						return null;
					}
				},
				utils: {
					icon: function(name, size) {
						// Simple icon placeholder - can be enhanced
						const icons = {
							'filter': '🔍',
							'triangle-alert': '⚠️',
							'clock': '🕐'
						};
						return icons[name] || '•';
					}
				},
				show_alert: function(options) {
					// Simple alert for portal
					alert(options.message || '');
				},
				msgprint: function(options) {
					alert(options.message || options.title || '');
				},
				set_route: function() {
					// Portal doesn't have routes - could redirect to desk app
					console.log('set_route called (not available in portal)');
				},
				new_doc: function(doctype, defaults) {
					// Redirect to desk app for creating documents
					const params = new URLSearchParams(defaults || {});
					window.location.href = `/app/${doctype.toLowerCase().replace(' ', '-')}?${params.toString()}`;
				},
				ui: {
					Dialog: function(options) {
						// Simple dialog shim for portal
						return {
							show: function() {
								// Use native browser dialogs or custom modal
								console.log('Dialog.show called', options);
							},
							hide: function() {
								console.log('Dialog.hide called');
							},
							$wrapper: jQuery('<div>')
						};
					},
					form: {
						make_control: function(options) {
							// Simple control shim
							return {
								refresh: function() {},
								set_value: function() {},
								get_value: function() { return ''; }
							};
						}
					}
				}
			};
		}

		// Ensure jQuery is available globally
		if (typeof $ === 'undefined' && typeof jQuery !== 'undefined') {
			window.$ = jQuery;
		}

		// Get user roles - prefer from portal data (server-side), fallback to API
		if (window.rollCallPortalData?.userRoles) {
			frappe.user_roles = window.rollCallPortalData.userRoles;
		} else {
			// Fallback: use the whitelisted API (same as desk app)
			try {
				const userInfo = await frappe.call({
					method: 'flexitime.api.roll_call.get_current_user_info'
				});
				if (userInfo && userInfo.roles) {
					frappe.user_roles = userInfo.roles;
				} else {
					frappe.user_roles = [];
				}
			} catch (e) {
				console.warn('Could not load user roles:', e);
				frappe.user_roles = [];
			}
		}

		// Set current employee in Frappe session if available
		if (window.rollCallPortalData?.currentEmployee && frappe.session) {
			frappe.session.current_employee = window.rollCallPortalData.currentEmployee;
		}

		// Create a fake page object that mimics frappe.ui.make_app_page
		const wrapper = jQuery('#roll-call-page-wrapper .roll-call-page-body');
		const fakePage = {
			body: wrapper[0],
			wrapper: wrapper
		};

		// Create wrapper div that RollCallTable expects
		wrapper.html('<div class="roll-call-loading text-muted">Loading...</div>');

		// Initialize RollCallTable with the fake page
		// RollCallTable is defined in roll_call.js
		if (typeof RollCallTable === 'undefined') {
			wrapper.html('<div class="alert alert-danger">RollCallTable class not found. Please ensure roll_call.js is loaded.</div>');
			return;
		}

		try {
			const rollCallInstance = new RollCallTable(fakePage);
			fakePage.roll_call = rollCallInstance;
			
			// Override current_employee if we have it from portal data
			if (window.rollCallPortalData?.currentEmployee) {
				rollCallInstance.current_employee = window.rollCallPortalData.currentEmployee;
			}
			
			// Store reference globally for debugging
			window.rollCallInstance = rollCallInstance;
		} catch (error) {
			console.error('Failed to initialize RollCallTable:', error);
			wrapper.html(`<div class="alert alert-danger">Failed to initialize: ${error.message}</div>`);
		}
	});
})();

