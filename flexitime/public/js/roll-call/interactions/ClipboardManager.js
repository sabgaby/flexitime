/**
 * Clipboard Manager Module
 * Handles copy and paste operations for the Roll Call table
 */
(function() {
	'use strict';

	class ClipboardManager {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
			this.clipboard = null;
		}

		/**
		 * Copy selected cells to clipboard (pattern-based)
		 */
		copy_selection() {
			if (this.rollCall.selection.selected_cells.size === 0) return;

			// Build a list of selected cells with their row/col indices (using visible columns)
			const cells = [];
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				const row_idx = this.rollCall.employees.findIndex(e => e.name === employee);
				const col_idx = this.get_visible_column_index(date);
				if (row_idx >= 0 && col_idx >= 0) {
					cells.push({ employee, date, row_idx, col_idx, key });
				}
			}

			if (cells.length === 0) return;

			// Find the top-left corner (min row, min col) as the anchor
			const min_row = Math.min(...cells.map(c => c.row_idx));
			const min_col = Math.min(...cells.map(c => c.col_idx));
			const max_row = Math.max(...cells.map(c => c.row_idx));
			const max_col = Math.max(...cells.map(c => c.col_idx));

			// Build the pattern with relative offsets
			const pattern = [];
			let has_data = false;

			for (const cell of cells) {
				const entry = this.rollCall.entries[cell.key];
				const row_offset = cell.row_idx - min_row;
				const col_offset = cell.col_idx - min_col;

				if (entry && entry.presence_type) {
					has_data = true;
					if (entry.is_half_day && entry.am_presence_type && entry.pm_presence_type) {
						pattern.push({
							row_offset,
							col_offset,
							data: {
								type: 'split',
								am_type: entry.am_presence_type,
								pm_type: entry.pm_presence_type
							}
						});
					} else {
						pattern.push({
							row_offset,
							col_offset,
							data: {
								type: 'full',
								presence_type: entry.presence_type
							}
						});
					}
				} else {
					// Include empty cells in pattern (to clear target cells if needed)
					pattern.push({
						row_offset,
						col_offset,
						data: { type: 'empty' }
					});
				}
			}

			if (!has_data) {
				frappe.show_alert({ message: __('No data to copy (selected cells are empty)'), indicator: 'orange' });
				return;
			}

			this.clipboard = {
				pattern,
				rows: max_row - min_row + 1,
				cols: max_col - min_col + 1
			};

			const cell_count = pattern.filter(p => p.data.type !== 'empty').length;
			frappe.show_alert({
				message: __('Copied {0} cells ({1} rows x {2} cols)', [cell_count, this.clipboard.rows, this.clipboard.cols]),
				indicator: 'green'
			});
		}

		/**
		 * Get visible column index for a date (accounts for hidden weekends)
		 */
		get_visible_column_index(date) {
			const all_days = this.rollCall.get_days_in_range();
			let visible_idx = 0;
			for (const day of all_days) {
				if (!this.rollCall.show_weekends && day.is_weekend) continue;
				if (day.date === date) return visible_idx;
				visible_idx++;
			}
			return -1; // Not found
		}

		/**
		 * Get date from visible column index (accounts for hidden weekends)
		 */
		get_date_from_visible_column(visible_col_idx) {
			const all_days = this.rollCall.get_days_in_range();
			let visible_idx = 0;
			for (const day of all_days) {
				if (!this.rollCall.show_weekends && day.is_weekend) continue;
				if (visible_idx === visible_col_idx) return day.date;
				visible_idx++;
			}
			return null; // Out of range
		}

		/**
		 * Paste clipboard to selected cells (pattern-based)
		 *
		 * Behavior:
		 * - If 1 cell selected: paste pattern starting from that cell (anchor = top-left of pattern)
		 * - If multiple cells selected: tile/repeat the pattern across the selection
		 */
		async paste_selection() {
			if (!this.clipboard || !this.clipboard.pattern || this.rollCall.selection.selected_cells.size === 0) return;

			// Get selected cells with their indices (using visible columns to skip weekends)
			const selected = [];
			for (const key of this.rollCall.selection.selected_cells) {
				const [employee, date] = key.split('|');
				const row_idx = this.rollCall.employees.findIndex(e => e.name === employee);
				const col_idx = this.get_visible_column_index(date);
				if (row_idx >= 0 && col_idx >= 0) {
					selected.push({ employee, date, row_idx, col_idx, key });
				}
			}

			if (selected.length === 0) return;

			// Find the anchor point (top-left of selection)
			const anchor_row = Math.min(...selected.map(c => c.row_idx));
			const anchor_col = Math.min(...selected.map(c => c.col_idx));
			const sel_max_row = Math.max(...selected.map(c => c.row_idx));
			const sel_max_col = Math.max(...selected.map(c => c.col_idx));

			// Determine target cells by applying pattern from anchor
			const target_cells = new Map(); // key -> { employee, date, data }

			const pattern_rows = this.clipboard.rows;
			const pattern_cols = this.clipboard.cols;

			// Calculate how many times to tile the pattern
			const sel_rows = sel_max_row - anchor_row + 1;
			const sel_cols = sel_max_col - anchor_col + 1;
			const tile_rows = Math.ceil(sel_rows / pattern_rows);
			const tile_cols = Math.ceil(sel_cols / pattern_cols);

			// Apply pattern tiles across selection
			for (let tile_r = 0; tile_r < tile_rows; tile_r++) {
				for (let tile_c = 0; tile_c < tile_cols; tile_c++) {
					for (const pattern_item of this.clipboard.pattern) {
						const target_row = anchor_row + tile_r * pattern_rows + pattern_item.row_offset;
						const target_col = anchor_col + tile_c * pattern_cols + pattern_item.col_offset;

						// Only apply if target is within selection bounds
						if (target_row < anchor_row || target_row > sel_max_row) continue;
						if (target_col < anchor_col || target_col > sel_max_col) continue;

						// Get employee and date for target cell
						const employee = this.rollCall.employees[target_row];
						if (!employee) continue;

						const date = this.get_date_from_visible_column(target_col);
						if (!date) continue;

						const key = `${employee.name}|${date}`;
						target_cells.set(key, { employee: employee.name, date, data: pattern_item.data });
					}
				}
			}

			if (target_cells.size === 0) return;

			// Prepare undo state before pasting
			const cells_to_modify = Array.from(target_cells.values()).map(c => ({ employee: c.employee, date: c.date }));
			const undo_record = this.rollCall.undo.prepare_undo_state(cells_to_modify, 'paste');

			// Collect entries to save (group by type for bulk operations)
			const full_entries = [];
			const split_entries = [];
			const clear_entries = [];

			for (const [key, cell] of target_cells) {
				// Check if cell is editable
				const $cell = this.rollCall.get_cell_element(cell.employee, cell.date);
				if ($cell && $cell.data('locked')) continue;
				if (this.rollCall.get_pending_leave(cell.employee, cell.date)) continue;

				if (cell.data.type === 'split') {
					split_entries.push({
						employee: cell.employee,
						date: cell.date,
						am_type: cell.data.am_type,
						pm_type: cell.data.pm_type
					});
					// Optimistic UI update
					this.rollCall.grid.update_cell_split_optimistic(cell.employee, cell.date, cell.data.am_type, cell.data.pm_type);
				} else if (cell.data.type === 'full') {
					full_entries.push({
						employee: cell.employee,
						date: cell.date,
						presence_type: cell.data.presence_type
					});
					// Optimistic UI update
					this.rollCall.grid.update_cell_optimistic(cell.employee, cell.date, cell.data.presence_type);
				} else if (cell.data.type === 'empty') {
					clear_entries.push({ employee: cell.employee, date: cell.date });
					// Optimistic UI update
					this.rollCall.grid.update_cell_clear_optimistic(cell.employee, cell.date);
				}
			}

			// Save undo record
			undo_record.entries = undo_record.entries.filter(e => {
				const key = `${e.employee}|${e.date}`;
				return target_cells.has(key);
			});
			if (undo_record.entries.length > 0) {
				this.rollCall.undo.push_undo(undo_record);
			}

			// Batch save operations
			try {
				// Group full entries by presence_type for bulk save
				const by_type = new Map();
				for (const entry of full_entries) {
					const pt = entry.presence_type;
					if (!by_type.has(pt)) {
						by_type.set(pt, []);
					}
					by_type.get(pt).push({ employee: entry.employee, date: entry.date });
				}

				// Save full entries by type
				for (const [presence_type, entries] of by_type) {
					await frappe.call({
						method: 'flexitime.api.roll_call.save_bulk_entries',
						args: { entries, presence_type, day_part: 'full' }
					});
				}

				// Group split entries by am/pm combo
				const by_split = new Map();
				for (const entry of split_entries) {
					const key = `${entry.am_type}|${entry.pm_type}`;
					if (!by_split.has(key)) {
						by_split.set(key, { am_type: entry.am_type, pm_type: entry.pm_type, entries: [] });
					}
					by_split.get(key).entries.push({ employee: entry.employee, date: entry.date });
				}

				// Save split entries
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

				// Clear empty cells
				if (clear_entries.length > 0) {
					await frappe.call({
						method: 'flexitime.api.roll_call.delete_bulk_entries',
						args: { entries: clear_entries }
					});
				}

				// Refresh to show final state
				await this.rollCall.refresh();

				const total = full_entries.length + split_entries.length + clear_entries.length;
				frappe.show_alert({
					message: __('Pasted {0} cells', [total]),
					indicator: 'green'
				});
			} catch (e) {
				frappe.msgprint(__('Error pasting. Please try again.'));
				this.rollCall.refresh();
			}

			// Clear selection after paste
			this.rollCall.selection.clear_selection();
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.ClipboardManager = ClipboardManager;
})();

