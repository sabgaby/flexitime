/**
 * Undo Manager Module
 * Handles undo/redo functionality for the Roll Call table
 */
(function() {
	'use strict';

	class UndoManager {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
			this.undo_stack = [];
			this.MAX_UNDO_STACK = 50; // Limit undo stack size
		}

		/**
		 * Save the current state of cells before an operation for undo
		 * @param {Array} cells - Array of {employee, date} objects
		 * @param {string} action - The action being performed ('apply', 'paste', 'delete', 'split')
		 * @returns {Object} Undo record to push to stack after operation completes
		 */
		prepare_undo_state(cells, action) {
			const entries = [];
			for (const cell of cells) {
				const key = `${cell.employee}|${cell.date}`;
				const existing = this.rollCall.entries[key];

				// Deep clone the existing state (or null if empty)
				entries.push({
					employee: cell.employee,
					date: cell.date,
					previous_state: existing ? JSON.parse(JSON.stringify(existing)) : null
				});
			}
			return { action, entries, timestamp: Date.now() };
		}

		/**
		 * Push an undo record to the stack
		 * @param {Object} undo_record - Record from prepare_undo_state
		 */
		push_undo(undo_record) {
			if (!undo_record || !undo_record.entries || undo_record.entries.length === 0) return;

			this.undo_stack.push(undo_record);

			// Trim stack if too large
			while (this.undo_stack.length > this.MAX_UNDO_STACK) {
				this.undo_stack.shift();
			}
		}

		/**
		 * Undo the last action
		 */
		async undo_last_action() {
			if (this.undo_stack.length === 0) {
				frappe.show_alert({ message: __('Nothing to undo'), indicator: 'orange' });
				return;
			}

			const undo_record = this.undo_stack.pop();
			const { action, entries } = undo_record;

			// Group entries by what needs to happen
			const to_restore = [];  // Entries that need to be restored to previous state
			const to_delete = [];   // Entries that need to be deleted (were created by the action)

			for (const entry of entries) {
				if (entry.previous_state) {
					// Had a previous state - restore it
					to_restore.push(entry);
				} else {
					// Was empty before - delete the current entry
					to_delete.push(entry);
				}
			}

			try {
				// Delete entries that were newly created
				if (to_delete.length > 0) {
					const delete_entries = to_delete.map(e => ({ employee: e.employee, date: e.date }));
					await frappe.call({
						method: 'flexitime.api.roll_call.delete_bulk_entries',
						args: { entries: delete_entries }
					});
				}

				// Restore entries to their previous state
				if (to_restore.length > 0) {
					// Group by presence type for bulk restore
					const by_type = new Map();
					const split_entries = [];

					for (const entry of to_restore) {
						const prev = entry.previous_state;
						if (prev.is_half_day && prev.am_presence_type && prev.pm_presence_type) {
							split_entries.push({
								employee: entry.employee,
								date: entry.date,
								am_type: prev.am_presence_type,
								pm_type: prev.pm_presence_type
							});
						} else if (prev.presence_type) {
							const pt = prev.presence_type;
							if (!by_type.has(pt)) by_type.set(pt, []);
							by_type.get(pt).push({ employee: entry.employee, date: entry.date });
						}
					}

					// Restore full-day entries by type
					for (const [presence_type, type_entries] of by_type) {
						await frappe.call({
							method: 'flexitime.api.roll_call.save_bulk_entries',
							args: { entries: type_entries, presence_type, day_part: 'full' }
						});
					}

					// Restore split entries
					if (split_entries.length > 0) {
						// Group by am/pm combo
						const by_split = new Map();
						for (const e of split_entries) {
							const key = `${e.am_type}|${e.pm_type}`;
							if (!by_split.has(key)) {
								by_split.set(key, { am_type: e.am_type, pm_type: e.pm_type, entries: [] });
							}
							by_split.get(key).entries.push({ employee: e.employee, date: e.date });
						}

						for (const group of by_split.values()) {
							await frappe.call({
								method: 'flexitime.api.roll_call.save_bulk_split_entries',
								args: {
									entries: group.entries,
									am_presence_type: group.am_type,
									pm_presence_type: group.pm_type
								}
							});
						}
					}
				}

				const total = entries.length;
				const action_name = {
					'apply': __('application'),
					'paste': __('paste'),
					'delete': __('deletion'),
					'split': __('split')
				}[action] || action;

				frappe.show_alert({
					message: __('Undid {0} ({1} cells)', [action_name, total]),
					indicator: 'blue'
				});

				// Refresh to show restored state
				await this.rollCall.refresh();

			} catch (e) {
				frappe.msgprint(__('Error undoing: {0}', [e.message || e]));
				// Put the record back since undo failed
				this.undo_stack.push(undo_record);
			}
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.UndoManager = UndoManager;
})();

