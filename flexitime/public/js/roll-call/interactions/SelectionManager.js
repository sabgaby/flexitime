/**
 * Selection Manager Module
 * Handles all cell selection logic including single, multi, and drag selection
 */
(function() {
	'use strict';

	class SelectionManager {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
			
			// Selection state
			this.selected_cells = new Set();
			
			// Drag-to-select state
			this.is_dragging = false;
			this.drag_actually_moved = false;  // Track if mouse actually moved during drag
			this.drag_start_cell = null;  // {employee, date, row_idx, col_idx}
			this.drag_current_cell = null;
		}

		/**
		 * Select a single cell (add to selection)
		 */
		select_cell($cell) {
			const key = `${$cell.data('employee')}|${$cell.data('date')}`;
			// Only allow selection of editable, unlocked, non-weekend cells
			if ($cell.hasClass('editable') && !$cell.data('locked') && !$cell.hasClass('weekend')) {
				this.selected_cells.add(key);
				$cell.addClass('selected');
				this.update_selection_toolbar();
			}
		}

		/**
		 * Toggle cell selection (add if not selected, remove if selected)
		 */
		toggle_cell_selection($cell) {
			const key = `${$cell.data('employee')}|${$cell.data('date')}`;

			// Only allow selection of editable, unlocked cells
			if (!$cell.hasClass('editable') || $cell.data('locked')) return;

			if (this.selected_cells.has(key)) {
				this.selected_cells.delete(key);
				$cell.removeClass('selected');
			} else {
				this.selected_cells.add(key);
				$cell.addClass('selected');
			}

			this.update_selection_toolbar();
		}

		/**
		 * Clear all selected cells
		 */
		clear_selection() {
			this.selected_cells.clear();
			this.rollCall.wrapper.find('.day-cell.selected').removeClass('selected');
			this.update_selection_toolbar();
		}

		/**
		 * Get cell coordinates for drag selection
		 */
		get_cell_coords($cell) {
			const employee = $cell.data('employee');
			const date = $cell.data('date');
			if (!employee || !date) return null;

			// Find row and column indices
			const row_idx = this.rollCall.employees.findIndex(e => e.name === employee);
			const all_days = this.rollCall.get_days_in_range();
			const visible_days = all_days.filter(d => this.rollCall.show_weekends || !d.is_weekend);
			const col_idx = visible_days.findIndex(d => d.date === date);

			return { employee, date, row_idx, col_idx };
		}

		/**
		 * Update selection based on drag rectangle
		 */
		update_drag_selection() {
			if (!this.drag_start_cell || !this.drag_current_cell) return;

			// Get min/max row and column indices
			const min_row = Math.min(this.drag_start_cell.row_idx, this.drag_current_cell.row_idx);
			const max_row = Math.max(this.drag_start_cell.row_idx, this.drag_current_cell.row_idx);
			const min_col = Math.min(this.drag_start_cell.col_idx, this.drag_current_cell.col_idx);
			const max_col = Math.max(this.drag_start_cell.col_idx, this.drag_current_cell.col_idx);

			// Get visible days for column mapping
			const all_days = this.rollCall.get_days_in_range();
			const visible_days = all_days.filter(d => this.rollCall.show_weekends || !d.is_weekend);

			// Clear current selection (batch DOM operation)
			this.selected_cells.clear();
			this.rollCall.wrapper.find('.day-cell.selected').removeClass('selected');

			// Collect cells to select for batch DOM update
			const cells_to_select = [];

			// Select all cells in the rectangle using cached element map
			for (let r = min_row; r <= max_row; r++) {
				const emp = this.rollCall.employees[r];
				if (!emp) continue;

				for (let c = min_col; c <= max_col; c++) {
					const day = visible_days[c];
					if (!day || day.is_weekend) continue;

					// Use O(1) cached lookup instead of DOM query
					const $cell = this.rollCall.get_cell_element(emp.name, day.date);
					if ($cell && $cell.length && $cell.hasClass('editable') && !$cell.data('locked')) {
						const key = `${emp.name}|${day.date}`;
						this.selected_cells.add(key);
						cells_to_select.push($cell[0]);
					}
				}
			}

			// Batch add 'selected' class to all cells at once
			if (cells_to_select.length > 0) {
				$(cells_to_select).addClass('selected');
			}

			this.update_selection_toolbar();
		}

		/**
		 * Get unique employees from current selection
		 */
		get_selected_employees() {
			const employees = new Set();
			for (const key of this.selected_cells) {
				const [employee] = key.split('|');
				employees.add(employee);
			}
			return Array.from(employees);
		}

		/**
		 * Get presence types available to ALL specified employees (intersection).
		 * Returns Set of presence type names.
		 *
		 * Logic:
		 * - Types with available_to_all=1 are always available
		 * - Types with available_to_all=0 require employee-specific permissions
		 *   (for now, we grey them out when multiple employees selected,
		 *    as we can't easily check cross-employee permissions synchronously)
		 */
		get_available_types_for_employees(employee_names) {
			// For single employee or no selection, all types are potentially available
			// (actual validation happens on save via API)
			if (employee_names.length <= 1) {
				return new Set(this.rollCall.presence_types.map(pt => pt.name));
			}

			// For multiple employees, only allow types that are available_to_all
			// since we can't easily check per-employee permissions synchronously
			const available = new Set();
			for (const pt of this.rollCall.presence_types) {
				if (pt.available_to_all) {
					available.add(pt.name);
				}
			}

			return available;
		}

		/**
		 * Get detailed information about the current selection
		 */
		get_selection_info() {
			const info = {
				count: this.selected_cells.size,
				employees: new Set(),
				dates: [],
				cells: [],
				hasEmpty: false,
				hasEntry: false,
				hasTentative: false,
				hasDraft: false,
				hasApproved: false,
				hasLocked: false,
				hasPendingLeave: false,  // Open leave applications (not yet linked to entry)
				leaveApps: new Set(),
				presenceTypes: new Set(),
				editableCount: 0,
				lockedCount: 0
			};

			for (const key of this.selected_cells) {
				const [employee, date] = key.split('|');
				info.employees.add(employee);
				info.dates.push(date);

				const entry = this.rollCall.entries[key];
				const pendingLeave = this.rollCall.get_pending_leave(employee, date);
				const cellInfo = { employee, date, entry, key, pendingLeave };
				info.cells.push(cellInfo);

				// Check for pending leave first (open leave applications not yet linked)
				if (pendingLeave) {
					info.hasPendingLeave = true;
					info.leaveApps.add(pendingLeave.name);
					info.lockedCount++;
					info.hasLocked = true;
				} else if (!entry || !entry.presence_type) {
					info.hasEmpty = true;
					info.editableCount++;
				} else {
					info.hasEntry = true;
					info.presenceTypes.add(entry.presence_type);

					// Check leave status and locked state
					if (entry.is_locked) {
						// Entry is locked - either approved leave or system entry
						info.hasLocked = true;
						info.lockedCount++;
						if (entry.leave_application) {
							info.leaveApps.add(entry.leave_application);
							info.hasApproved = true;
						}
					} else if (entry.leave_application) {
						info.leaveApps.add(entry.leave_application);
						if (entry.leave_status === 'approved') {
							info.hasApproved = true;
							info.hasLocked = true;
							info.lockedCount++;
						} else if (entry.leave_status === 'draft') {
							info.hasDraft = true;
							info.editableCount++;
						} else {
							info.editableCount++;
						}
					} else if (entry.leave_status === 'tentative') {
						info.hasTentative = true;
						info.editableCount++;
					} else {
						info.editableCount++;
					}
				}
			}

			// Convert dates to sorted array
			info.dates = [...new Set(info.dates)].sort();
			info.employees = [...info.employees];

			return info;
		}

		/**
		 * Update selection toolbar (status bar and palette availability)
		 */
		update_selection_toolbar() {
			// Update the status bar based on current selection
			this.rollCall.update_status_bar();
			// Update palette availability based on selected employees
			this.update_palette_availability();
		}

		/**
		 * Update palette item availability based on selected employees.
		 * Types not available to ALL selected employees are greyed out.
		 */
		update_palette_availability() {
			const selected_employees = this.get_selected_employees();

			if (selected_employees.length === 0) {
				// No selection - all types available
				this.rollCall.wrapper.find('.palette-item[data-type]').removeClass('unavailable');
				return;
			}

			// Get intersection of available types for all selected employees
			const available_types = this.get_available_types_for_employees(selected_employees);

			// Mark unavailable types
			this.rollCall.wrapper.find('.palette-item[data-type]').each(function() {
				const $el = $(this);
				const type = $el.data('type');
				if (available_types.has(type)) {
					$el.removeClass('unavailable');
				} else {
					$el.addClass('unavailable');
				}
			});
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.SelectionManager = SelectionManager;
})();

