/**
 * Data Manager Module
 * Handles all data loading and saving operations for the Roll Call table
 */
(function() {
	'use strict';

	class DataManager {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		/**
		 * Load employees and entries from the server
		 */
		async load_data() {
			const range_start = this.rollCall.start_date;
			const range_end = this.rollCall.get_end_date();

			try {
				// Single API call - get_events now includes employee data
				const events_result = await frappe.call({
					method: 'flexitime.api.roll_call.get_events',
					args: {
						month_start: range_start,
						month_end: range_end,
						employee_filters: {}
					}
				});

				// Get data from the combined API response
				const events_data = events_result.message || {};

				// Get employees from the same response (avoids duplicate API call)
				const employees = events_data.employees || [];
				this.rollCall.employees = employees;
				// Build O(1) lookup map for employees
				this.rollCall.employees_map.clear();
				this.rollCall.employees.forEach(emp => this.rollCall.employees_map.set(emp.name, emp));

				// Get entries from the API response
				const entries_by_employee = events_data.entries || {};

				// Sort: own employee first
				this.rollCall.employees.sort((a, b) => {
					if (a.name === this.rollCall.current_employee) return -1;
					if (b.name === this.rollCall.current_employee) return 1;
					return a.employee_name.localeCompare(b.employee_name);
				});

				// Index entries by employee+date
				this.rollCall.entries = {};
				for (const [employee, entries] of Object.entries(entries_by_employee)) {
					for (const entry of entries) {
						const key = `${entry.employee}|${entry.date}`;
						this.rollCall.entries[key] = entry;
					}
				}

				// Store pending leave applications (not yet approved)
				// Structure: { employee: { date: [leave_info, ...] } }
				this.rollCall.pending_leaves = events_data.pending_leaves || {};

				// Fetch pending review count for approvers (non-blocking)
				this.load_pending_review_count();

			} catch (e) {
				const error_msg = e.message || e._server_messages || e;
				frappe.msgprint({
					title: __('Error loading roll call data'),
					message: `<pre>${JSON.stringify(error_msg, null, 2)}</pre>`,
					indicator: 'red'
				});
			}
		}

		/**
		 * Load pending review count for leave approvers.
		 * This is called asynchronously after main data load to avoid blocking.
		 */
		async load_pending_review_count() {
			try {
				const result = await frappe.call({
					method: 'flexitime.api.roll_call.get_pending_review_count'
				});
				const data = result.message || {};
				this.rollCall.pending_review_count = data.count || 0;
				this.rollCall.can_approve_leaves = data.can_approve || false;

				// Re-render toolbar to show the badge if count > 0
				if (this.rollCall.pending_review_count > 0) {
					this.rollCall.grid.render_toolbar();
				}
			} catch (e) {
				// Non-critical - just log and continue
				console.warn('Failed to load pending review count:', e);
				this.rollCall.pending_review_count = 0;
				this.rollCall.can_approve_leaves = false;
			}
		}

		/**
		 * Apply presence type to a single cell (optimistic update)
		 */
		apply_to_cell(employee, date, presence_type) {
			const key = `${employee}|${date}`;

			// 1. Check for locked/pending leave
			const $cell = this.rollCall.get_cell_element(employee, date);
			if ($cell && $cell.data('locked')) {
				return { skipped: true, reason: 'locked' };
			}

			const pending_leave = this.rollCall.get_pending_leave(employee, date);
			if (pending_leave) {
				return { skipped: true, reason: 'pending_leave' };
			}

			// 2. Optimistic UI update
			this.rollCall.grid.update_cell_optimistic(employee, date, presence_type);

			// 3. Queue the save
			this.rollCall.pending_saves.set(key, { employee, date, presence_type, day_part: 'full' });

			// 4. Debounce - flush after 300ms of inactivity
			clearTimeout(this.rollCall.save_timeout);
			this.rollCall.save_timeout = setTimeout(() => this.flush_saves(), 300);

			return { skipped: false };
		}

		/**
		 * Clear a cell (optimistic update)
		 */
		clear_cell(employee, date) {
			const key = `${employee}|${date}`;

			// Check for locked/pending leave
			const $cell = this.rollCall.get_cell_element(employee, date);
			if ($cell && $cell.data('locked')) {
				return { skipped: true, reason: 'locked' };
			}

			const pending_leave = this.rollCall.get_pending_leave(employee, date);
			if (pending_leave) {
				return { skipped: true, reason: 'pending_leave' };
			}

			// Get entry from cache
			const entry = this.rollCall.entries[key];
			if (entry) {
				// Check if it's a holiday - holidays should not be cleared
				if (entry.presence_type === 'holiday') {
					return { skipped: true, reason: 'holiday' };
				}

				// Check if it's an approved leave - approved leaves should not be cleared
				// Check full day leave_status
				if (entry.leave_status === 'approved') {
					return { skipped: true, reason: 'approved_leave' };
				}

				// Check split day leave statuses (AM/PM)
				if (entry.am_leave_status === 'approved' || entry.pm_leave_status === 'approved') {
					return { skipped: true, reason: 'approved_leave' };
				}
			}

			// Optimistic UI update - clear the cell
			this.rollCall.grid.update_cell_clear_optimistic(employee, date);

			// Queue the delete
			this.rollCall.pending_saves.set(key, { employee, date, action: 'delete' });

			// Debounce
			clearTimeout(this.rollCall.save_timeout);
			this.rollCall.save_timeout = setTimeout(() => this.flush_saves(), 300);

			return { skipped: false };
		}

		/**
		 * Flush pending saves to the server (batched)
		 */
		async flush_saves() {
			if (this.rollCall.pending_saves.size === 0) return;

			// Prevent concurrent flushes (deadlock prevention)
			if (this.rollCall.is_flushing) {
				// Re-schedule flush for later
				clearTimeout(this.rollCall.save_timeout);
				this.rollCall.save_timeout = setTimeout(() => this.flush_saves(), 500);
				return;
			}

			this.rollCall.is_flushing = true;

			const saves = Array.from(this.rollCall.pending_saves.entries());
			this.rollCall.pending_saves.clear();

			// Separate saves and deletes
			const to_save = saves.filter(([k, v]) => !v.action);
			const to_delete = saves.filter(([k, v]) => v.action === 'delete');

			// Group saves by presence_type for bulk API
			const by_type = new Map();
			for (const [key, data] of to_save) {
				const pt = data.presence_type;
				if (!by_type.has(pt)) {
					by_type.set(pt, []);
				}
				by_type.get(pt).push({ employee: data.employee, date: data.date });
			}

			try {
				// Process each type group sequentially to avoid deadlocks
				for (const [presence_type, entries] of by_type) {
					const response = await frappe.call({
						method: 'flexitime.api.roll_call.save_bulk_entries',
						args: {
							entries: entries,
							presence_type: presence_type,
							day_part: 'full'
						}
					});

					// Update cells with full entry data (includes leave_status for proper styling)
					if (response.message?.entries) {
						for (const entry of response.message.entries) {
							this.rollCall.grid.update_cell(entry.employee, entry.date, entry);
							// Remove saving class that update_cell doesn't handle
							const $cell = this.rollCall.get_cell_element(entry.employee, entry.date);
							if ($cell) $cell.removeClass('saving');
						}
					}
				}

				// Process deletes in bulk (to_delete is an array, not Map)
				if (to_delete.length > 0) {
					const delete_entries = to_delete.map(([k, d]) => ({
						employee: d.employee,
						date: d.date
					}));

					const delete_response = await frappe.call({
						method: 'flexitime.api.roll_call.delete_bulk_entries',
						args: { entries: delete_entries }
					});

					// Update local cache for deleted entries
					if (delete_response.message?.entries) {
						for (const entry of delete_response.message.entries) {
							const key = `${entry.employee}|${entry.date}`;
							delete this.rollCall.entries[key];
							const $cell = this.rollCall.get_cell_element(entry.employee, entry.date);
							if ($cell) $cell.removeClass('saving');
						}
					}
				}

				// Silent save - no toast notification

			} catch (e) {
				frappe.msgprint(__('Error saving. Please try again.'));
				// Revert optimistic updates on error
				this.rollCall.refresh();
			} finally {
				this.rollCall.is_flushing = false;
			}
		}

		/**
		 * Apply selected palette type to all cells in current selection
		 * Optimized for bulk operations - batches DOM updates and API calls
		 */
		async apply_to_selection(presence_type) {
			if (this.rollCall.selection.selected_cells.size === 0) return;

			// Prepare undo state before applying
			const cells_to_modify = [];
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				cells_to_modify.push({ employee, date });
			}
			const undo_record = this.rollCall.undo.prepare_undo_state(cells_to_modify, 'apply');

			// Collect valid entries (skip locked/pending leave) - batch check
			const entries = [];
			const skipped_keys = [];
			const pt = this.rollCall.presence_types_map.get(presence_type);
			const color_var = pt ? this.rollCall.get_color_var(pt.color) : '';

			// Batch collect all valid entries first
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				const $cell = this.rollCall.get_cell_element(employee, date);
				
				// Skip locked cells
				if ($cell && $cell.data('locked')) {
					skipped_keys.push({ key, reason: 'locked' });
					continue;
				}

				// Skip pending leave
				if (this.rollCall.get_pending_leave(employee, date)) {
					skipped_keys.push({ key, reason: 'pending_leave' });
					continue;
				}

				// Get entry from cache and check for holidays/approved leaves
				const entry = this.rollCall.entries[key];
				if (entry) {
					// Skip holidays - they should not be modified
					if (entry.presence_type === 'holiday') {
						skipped_keys.push({ key, reason: 'holiday' });
						continue;
					}

					// Skip approved leaves - they should not be modified
					if (entry.leave_status === 'approved') {
						skipped_keys.push({ key, reason: 'approved_leave' });
						continue;
					}

					// Skip split days with approved leave status
					if (entry.am_leave_status === 'approved' || entry.pm_leave_status === 'approved') {
						skipped_keys.push({ key, reason: 'approved_leave' });
						continue;
					}
				}

				entries.push({ employee, date });
			}

			// Bulk save via API (single call instead of individual saves)
			if (entries.length > 0) {
				// Show loading state on cells (lightweight - just add class)
				for (const { employee, date } of entries) {
					const $cell = this.rollCall.get_cell_element(employee, date);
					if ($cell) $cell.addClass('saving');
				}

				try {
					const response = await frappe.call({
						method: 'flexitime.api.roll_call.save_bulk_entries',
						args: {
							entries: entries,
							presence_type: presence_type,
							day_part: 'full'
						}
					});

					// Batch update cells with response data - use document fragment for better performance
					if (response.message?.entries) {
						// Pre-cache presence type info to avoid repeated lookups
						const pt_cache = new Map();
						for (const entry of response.message.entries) {
							if (entry.presence_type && !pt_cache.has(entry.presence_type)) {
								pt_cache.set(entry.presence_type, this.rollCall.presence_types_map.get(entry.presence_type));
							}
						}

						// Update all cells in batch
						for (const entry of response.message.entries) {
							this.rollCall.grid.update_cell(entry.employee, entry.date, entry);
							const $cell = this.rollCall.get_cell_element(entry.employee, entry.date);
							if ($cell) $cell.removeClass('saving');
						}
					}

					// Save undo record
					undo_record.entries = undo_record.entries.filter(e => {
						const key = `${e.employee}|${e.date}`;
						return entries.some(ent => `${ent.employee}|${ent.date}` === key);
					});
					if (undo_record.entries.length > 0) {
						this.rollCall.undo.push_undo(undo_record);
					}

					// Show feedback
					const skipped = skipped_keys.length;
					let msg = __('Applied to {0} cells', [entries.length]);
					if (skipped > 0) {
						msg += __(', {0} skipped', [skipped]);
					}
					frappe.show_alert({ message: msg, indicator: 'green' });
				} catch (e) {
					frappe.msgprint(__('Error saving. Please try again.'));
					// Revert optimistic updates on error
					this.rollCall.refresh();
				}
			} else if (skipped_keys.length > 0) {
				frappe.show_alert({
					message: __('All {0} cells skipped', [skipped_keys.length]),
					indicator: 'red'
				});
			}

			// Clear selection and exit paint mode after applying
			this.rollCall.selection.clear_selection();
			this.rollCall.exit_paint_mode();
		}

		/**
		 * Apply split (AM/PM) to all cells in current selection
		 */
		async apply_split_to_selection() {
			// Use stored split cells if main selection was cleared
			const cells_to_use = this.rollCall.selection.selected_cells.size > 0 ? this.rollCall.selection.selected_cells : this.rollCall.split_selected_cells;

			if (!cells_to_use || cells_to_use.size === 0) {
				return;
			}
			if (!this.rollCall.split_am_type || !this.rollCall.split_pm_type) {
				return;
			}

			// Save the types before they get cleared by exit_paint_mode
			const am_type = this.rollCall.split_am_type;
			const pm_type = this.rollCall.split_pm_type;

			// Collect entries to save
			const entries = [];
			for (const key of cells_to_use) {
				const [employee, date] = key.split('|');

				// Check if cell is editable
				const $cell = this.rollCall.get_cell_element(employee, date);
				if ($cell && $cell.data('locked')) continue;
				if (this.rollCall.get_pending_leave(employee, date)) continue;

				// Get entry from cache and check for holidays/approved leaves
				const entry = this.rollCall.entries[key];
				if (entry) {
					// Skip holidays - they should not be modified
					if (entry.presence_type === 'holiday') continue;

					// Skip approved leaves - they should not be modified
					if (entry.leave_status === 'approved') continue;

					// Skip split days with approved leave status
					if (entry.am_leave_status === 'approved' || entry.pm_leave_status === 'approved') continue;
				}

				entries.push({ employee, date });

				// Optimistic UI update for split cell
				this.rollCall.grid.update_cell_split_optimistic(employee, date, am_type, pm_type);
			}

			// Prepare undo state before applying
			const undo_record = entries.length > 0 ? this.rollCall.undo.prepare_undo_state(entries, 'split') : null;

			// Clear selection and exit split mode after applying
			this.rollCall.selection.clear_selection();
			this.rollCall.exit_paint_mode();

			// Bulk save (using saved type values)
			if (entries.length > 0) {
				// Push undo record
				if (undo_record) this.rollCall.undo.push_undo(undo_record);

				// Use silent version directly since we already have the entries array
				await this.save_bulk_split_entries_silent(entries, am_type, pm_type);

				// Show single alert after all updates complete
				frappe.show_alert({
					message: __('Applied split to {0} cells', [entries.length]),
					indicator: 'green'
				});
			}
		}

		/**
		 * Save bulk split entries silently (no toast)
		 */
		async save_bulk_split_entries_silent(entries, am_type, pm_type) {
			try {
				const response = await frappe.call({
					method: 'flexitime.api.roll_call.save_bulk_split_entries',
					args: {
						entries: entries,
						am_presence_type: am_type,
						pm_presence_type: pm_type
					}
				});

				// Update cells with full entry data (includes leave_status for proper styling)
				if (response.message?.entries) {
					for (const entry of response.message.entries) {
						this.rollCall.grid.update_cell(entry.employee, entry.date, entry);
						// Remove saving class that update_cell doesn't handle
						const $cell = this.rollCall.get_cell_element(entry.employee, entry.date);
						if ($cell) $cell.removeClass('saving');
					}
				}
			} catch (e) {
				frappe.msgprint(__('Error saving. Please try again.'));
				this.rollCall.refresh();
			}
		}

		/**
		 * Save a single entry
		 */
		async save_entry(employee, date, presence_type, is_half_day = false) {
			try {
				const result = await frappe.call({
					method: 'flexitime.api.roll_call.save_entry',
					args: { employee, date, presence_type, is_half_day }
				});
				// Silent save - no toast (bulk operations show toast)
				// Use targeted cell update instead of full re-render for better performance
				if (result.message) {
					this.rollCall.grid.update_cell(employee, date, result.message);
				}
			} catch (e) {
				frappe.msgprint(__('Error: {0}', [e.message || e]));
			}
		}

		/**
		 * Save a split entry
		 */
		async save_split_entry(employee, date, am_type, pm_type) {
			try {
				const result = await frappe.call({
					method: 'flexitime.api.roll_call.save_split_entry',
					args: { employee, date, am_presence_type: am_type, pm_presence_type: pm_type }
				});
				// Silent save - no toast (bulk operations show toast)
				// Use targeted cell update instead of full re-render for better performance
				if (result.message) {
					this.rollCall.grid.update_cell(employee, date, result.message);
				}
			} catch (e) {
				frappe.msgprint(__('Error: {0}', [e.message || e]));
			}
		}

		/**
		 * Save bulk entries
		 */
		async save_bulk_entries(presence_type, day_part) {
			try {
				const entries = Array.from(this.rollCall.selection.selected_cells).map(key => {
					const [employee, date] = key.split('|');
					return { employee, date };
				});

				const response = await frappe.call({
					method: 'flexitime.api.roll_call.save_bulk_entries',
					args: { entries, presence_type, day_part }
				});

				// Note: Alert is shown by apply_to_selection, so we don't show it here to avoid duplicates
				this.rollCall.selection.clear_selection();

				// Update cells individually instead of full refresh
				if (response.message?.entries) {
					for (const entry of response.message.entries) {
						this.rollCall.grid.update_cell(entry.employee, entry.date, entry);
					}
				} else {
					// Fallback to full refresh if entries not returned
					await this.rollCall.refresh();
				}
			} catch (e) {
				frappe.msgprint(__('Error: {0}', [e.message || e]));
			}
		}

		/**
		 * Save bulk split entries
		 */
		async save_bulk_split_entries(am_type, pm_type) {
			try {
				const entries = Array.from(this.rollCall.selection.selected_cells).map(key => {
					const [employee, date] = key.split('|');
					return { employee, date };
				});

				// Use the silent version which is faster (batches updates)
				await this.save_bulk_split_entries_silent(entries, am_type, pm_type);

				// Show single alert after all updates complete
				frappe.show_alert({ message: __('Saved {0} entries', [entries.length]), indicator: 'green' });
				this.rollCall.selection.clear_selection();
			} catch (e) {
				frappe.msgprint(__('Error: {0}', [e.message || e]));
			}
		}

		/**
		 * Delete a single entry
		 */
		async delete_entry(employee, date) {
			try {
				const key = `${employee}|${date}`;
				const entry = this.rollCall.entries[key];
				if (entry) {
					await frappe.call({
						method: 'frappe.client.delete',
						args: { doctype: 'Roll Call Entry', name: entry.name }
					});
					frappe.show_alert({ message: __('Cleared'), indicator: 'green' });
					await this.rollCall.refresh();
				}
			} catch (e) {
				frappe.msgprint(__('Error: {0}', [e.message || e]));
			}
		}

		/**
		 * Delete all selected cells
		 */
		async delete_selected_cells() {
			if (this.rollCall.selection.selected_cells.size === 0) return;

			// Prepare undo state before deleting
			const cells_to_delete = [];
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				cells_to_delete.push({ employee, date });
			}
			const undo_record = this.rollCall.undo.prepare_undo_state(cells_to_delete, 'delete');

			// Collect entries to delete
			const delete_entries = [];
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				const $cell = this.rollCall.get_cell_element(employee, date);
				
				// Skip locked cells
				if ($cell && $cell.data('locked')) continue;
				if (this.rollCall.get_pending_leave(employee, date)) continue;

				// Get entry from cache and check for holidays/approved leaves
				const entry = this.rollCall.entries[key];
				if (entry) {
					// Skip holidays - they should not be deleted
					if (entry.presence_type === 'holiday') continue;

					// Skip approved leaves - they should not be deleted
					if (entry.leave_status === 'approved') continue;

					// Skip split days with approved leave status
					if (entry.am_leave_status === 'approved' || entry.pm_leave_status === 'approved') continue;
				}

				delete_entries.push({ employee, date });
			}

			if (delete_entries.length > 0) {
				try {
					const response = await frappe.call({
						method: 'flexitime.api.roll_call.delete_bulk_entries',
						args: { entries: delete_entries }
					});

					// Update local cache and UI
					if (response.message?.entries) {
						for (const entry of response.message.entries) {
							const key = `${entry.employee}|${entry.date}`;
							delete this.rollCall.entries[key];
							this.rollCall.grid.update_cell_clear_optimistic(entry.employee, entry.date);
						}
					}

					// Save undo record
					undo_record.entries = undo_record.entries.filter(e => {
						const key = `${e.employee}|${e.date}`;
						return delete_entries.some(ent => `${ent.employee}|${ent.date}` === key);
					});
					if (undo_record.entries.length > 0) {
						this.rollCall.undo.push_undo(undo_record);
					}

					frappe.show_alert({ message: __('Deleted {0} entries', [delete_entries.length]), indicator: 'green' });
				} catch (e) {
					frappe.msgprint(__('Error deleting. Please try again.'));
					this.rollCall.refresh();
				}
			}

			// Clear selection after deleting
			this.rollCall.selection.clear_selection();
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.DataManager = DataManager;
})();

