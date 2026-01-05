/**
 * Event Manager Module
 * Handles all event binding and keyboard shortcuts for the Roll Call table
 */
(function() {
	'use strict';

	class EventManager {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		/**
		 * Bind all events for the roll call table
		 */
		bind_events() {
			const rollCall = this.rollCall; // Keep reference to RollCallTable instance
			const self = rollCall; // Alias for backward compatibility with existing code
			const $table = self.wrapper.find('.roll-call-table');
			const $tableWrapper = self.wrapper.find('.roll-call-table-wrapper');

			// Defensive check: ensure table exists
			if (!$table.length) {
				console.warn('Roll Call: Table not found when binding events');
				return;
			}

			// Prevent duplicate bindings - unbind all rollcall namespaced events first
			self.wrapper.off('.rollcall-nav').off('.rollcall-drag').off('.rollcall-cell').off('.rollcall-deselect');
			$tableWrapper.off('.rollcall');
			$table.off('.rollcall-drag').off('.rollcall-cell');
			$(document).off('.rollcall-drag').off('.rollcall-deselect').off('.rollcall');

			// Use event delegation on the wrapper to handle dynamically created buttons
			// This ensures handlers persist even after re-renders
			
			// Today button - use event delegation
			self.wrapper.off('click.rollcall-nav', '.btn-today').on('click.rollcall-nav', '.btn-today', function(e) {
				e.preventDefault();
				e.stopPropagation();
				// Use rollCall from closure (bound at event binding time)
				if (rollCall && typeof rollCall.goto_today === 'function') {
					rollCall.goto_today();
				} else {
					console.error('Roll Call: goto_today not available', rollCall, typeof rollCall?.goto_today);
				}
			});

			// Navigation arrows - use event delegation
			self.wrapper.off('click.rollcall-nav', '.btn-nav-left').on('click.rollcall-nav', '.btn-nav-left', function(e) {
				e.preventDefault();
				e.stopPropagation();
				// Use rollCall from closure (bound at event binding time)
				if (rollCall && typeof rollCall.scroll_by_week === 'function') {
					rollCall.scroll_by_week(-1);
				} else {
					console.error('Roll Call: scroll_by_week not available', rollCall);
				}
			});
			self.wrapper.off('click.rollcall-nav', '.btn-nav-right').on('click.rollcall-nav', '.btn-nav-right', function(e) {
				e.preventDefault();
				e.stopPropagation();
				// Use rollCall from closure (bound at event binding time)
				if (rollCall && typeof rollCall.scroll_by_week === 'function') {
					rollCall.scroll_by_week(1);
				} else {
					console.error('Roll Call: scroll_by_week not available', rollCall);
				}
			});

			// Date range click - open date picker - use event delegation
			self.wrapper.off('click.rollcall-nav', '.visible-date-range').on('click.rollcall-nav', '.visible-date-range', function(e) {
				e.preventDefault();
				e.stopPropagation();
				// Use rollCall from closure (bound at event binding time)
				if (rollCall && typeof rollCall.show_date_picker === 'function') {
					rollCall.show_date_picker();
				} else {
					console.error('Roll Call: show_date_picker not available', rollCall);
				}
			});

			// Show weekends checkbox
			self.wrapper.find('.show-weekends-check').off('change.rollcall').on('change.rollcall', function() {
				self.show_weekends = $(this).is(':checked');
				self.render();
			});

			// Leave badge clicks - open dialogs
			// Yellow badge (needed) - opens "Create Leave Applications" dialog
			self.wrapper.off('click.leave-badge-needed').on('click.leave-badge-needed', '.leave-badge-needed', function(e) {
				e.preventDefault();
				e.stopPropagation();
				self.dialogs.leave.showCreate();
			});

			// Blue badge (open) - opens "View Open Applications" dialog
			self.wrapper.off('click.leave-badge-open').on('click.leave-badge-open', '.leave-badge-open', function(e) {
				e.preventDefault();
				e.stopPropagation();
				self.dialogs.leave.showView();
			});

			// Infinite scroll - detect scroll edges
			self.scroll_handler = self.throttle(() => {
				if (!$tableWrapper.length || self.is_expanding) return;

				const scrollLeft = $tableWrapper[0].scrollLeft;
				const scrollWidth = $tableWrapper[0].scrollWidth;
				const clientWidth = $tableWrapper[0].clientWidth;

				// Check if near right edge - load more future days
				// Defensive check: ensure method exists before calling
				if (scrollWidth - scrollLeft - clientWidth < self.EDGE_THRESHOLD) {
					if (typeof self.expand_right === 'function') {
						self.expand_right();
					}
				}

				// Check if near left edge - load more past days (bi-directional scrolling)
				// Defensive check: ensure method exists before calling
				if (scrollLeft < self.EDGE_THRESHOLD) {
					if (typeof self.expand_left === 'function') {
						self.expand_left();
					}
				}

				// Update visible date range in header
				// Defensive check: ensure method exists before calling
				if (typeof self.update_visible_date_range === 'function') {
					self.update_visible_date_range(scrollLeft, clientWidth);
				}
			}, 100, { leading: true, trailing: true });

			$tableWrapper.off('scroll.rollcall').on('scroll.rollcall', self.scroll_handler);

			// Bind drag-to-select events
			this.bind_drag_selection($table);

			// Bind cell click events
			this.bind_cell_clicks($table);

			// Bind keyboard shortcuts
			this.bind_keyboard_shortcuts();
		}

		/**
		 * Bind drag-to-select events
		 */
		bind_drag_selection($table) {
			const self = this.rollCall;

			// Mousedown on editable cell starts drag
			$table.off('mousedown.rollcall-drag').on('mousedown.rollcall-drag', '.day-cell.editable', (e) => {
				// Only left click, and not with modifier keys (let those do their thing)
				if (e.button !== 0) return;
				if (e.ctrlKey || e.metaKey || e.shiftKey) return;

				const $cell = $(e.currentTarget);
				if ($cell.data('locked')) return;

				// Start drag
				self.selection.is_dragging = true;
				self.selection.drag_actually_moved = false; // Track if mouse actually moved
				self.selection.drag_start_cell = self.selection.get_cell_coords($cell);
				self.selection.drag_current_cell = self.selection.drag_start_cell;

				// Clear previous selection and select start cell
				self.selection.clear_selection();
				self.selection.select_cell($cell);

				// Prevent text selection during drag
				e.preventDefault();
			});

			// Mousemove updates selection during drag
			$table.off('mousemove.rollcall-drag').on('mousemove.rollcall-drag', '.day-cell.editable', (e) => {
				if (!self.selection.is_dragging) return;

				const $cell = $(e.currentTarget);
				const coords = self.selection.get_cell_coords($cell);

				// Only update if we moved to a different cell
				if (coords && (!self.selection.drag_current_cell ||
					coords.employee !== self.selection.drag_current_cell.employee ||
					coords.date !== self.selection.drag_current_cell.date)) {

					self.selection.drag_current_cell = coords;
					self.selection.drag_actually_moved = true; // Mark that drag actually occurred
					self.selection.update_drag_selection();
				}
			});

			// Mouseup ends drag (on document to catch mouseup outside table)
			$(document).off('mouseup.rollcall-drag').on('mouseup.rollcall-drag', (e) => {
				if (self.selection.is_dragging) {
					const was_drag = self.selection.drag_actually_moved;
					self.selection.is_dragging = false;
					self.selection.drag_actually_moved = false;

					// SPLIT MODE: Apply split to selected cells if both AM and PM selected
					if (was_drag && self.palette_mode === 'split' && self.split_am_type && self.split_pm_type) {
						self.data.apply_split_to_selection();
					}
					// Otherwise: Just keep selection, user clicks palette to apply
					// (No auto-apply on drag - user must click palette item)

					self.selection.drag_start_cell = null;
					self.selection.drag_current_cell = null;
				}
			});
		}

		/**
		 * Bind cell click events
		 */
		bind_cell_clicks($table) {
			const self = this.rollCall;

			// Click on editable cells - using event delegation for better performance
			$table.off('click.rollcall-cell').on('click.rollcall-cell', '.day-cell.editable', function(e) {
				// If we just finished dragging, don't also trigger click
				if (self.selection.is_dragging) return;

				const $cell = $(this);

				if ($cell.data('locked')) {
					frappe.show_alert({ message: __('This entry is locked'), indicator: 'orange' });
					return;
				}

				// Ctrl/Cmd+Click or Shift+Click for multi-select
				if (e.ctrlKey || e.metaKey || e.shiftKey) {
					e.preventDefault();
					e.stopPropagation();
					self.selection.toggle_cell_selection($cell);
					return;
				}

				// Single click: select the cell (clear previous selection first)
				e.preventDefault();
				e.stopPropagation();
				self.selection.clear_selection();
				self.selection.select_cell($cell);
			});

			// Click outside table/palette to deselect cells
			$(document).off('click.rollcall-deselect').on('click.rollcall-deselect', (e) => {
				const $target = $(e.target);

				// Don't deselect if clicking inside the table, palette, or status bar
				if ($target.closest('.roll-call-table').length) return;
				if ($target.closest('.roll-call-palette').length) return;
				if ($target.closest('.palette-status-bar').length) return;
				if ($target.closest('.palette-split-item').length) return;
				if ($target.closest('.palette-item').length) return;

				// Don't deselect if clicking on inputs
				if ($target.closest('.frappe-control').length) return;

				// Don't deselect if in split mode (let split mode handle its own exit)
				if (self.palette_mode === 'split') return;

				// Deselect cells if we have a selection
				if (self.selection.selected_cells.size > 0) {
					self.selection.clear_selection();
				}
			});
		}

		/**
		 * Bind keyboard shortcuts
		 */
		bind_keyboard_shortcuts() {
			const self = this.rollCall;

			$(document).off('keydown.rollcall').on('keydown.rollcall', (e) => {
				// Don't handle if typing in an input
				if ($(e.target).is('input, textarea, select')) return;

				// Escape - clear selection
				if (e.key === 'Escape') {
					if (self.selection.selected_cells.size > 0) {
						self.selection.clear_selection();
						e.preventDefault();
					}
					return;
				}

				// Copy: Ctrl/Cmd + C
				if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
					if (self.selection.selected_cells.size > 0) {
						e.preventDefault();
						self.clipboard.copy_selection();
					}
					return;
				}

				// Paste: Ctrl/Cmd + V
				if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
					if (self.clipboard.clipboard && self.selection.selected_cells.size > 0) {
						e.preventDefault();
						self.clipboard.paste_selection();
					}
					return;
				}

				// Undo: Ctrl/Cmd + Z
				if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
					e.preventDefault();
					self.undo.undo_last_action();
					return;
				}

				// Delete/Backspace - clear selected cells
				if (e.key === 'Delete' || e.key === 'Backspace') {
					if (self.selection.selected_cells.size > 0) {
						e.preventDefault();
						self.data.delete_selected_cells();
					}
					return;
				}

				// Arrow keys - navigate cells
				if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
					e.preventDefault();
					self.navigate_cells(e.key, e.shiftKey);
					return;
				}

				// Enter key - no longer opens dropdown (palette-based interaction only)
			});
		}

		/**
		 * Bind events for the palette bar
		 */
		bind_palette_events() {
			const self = this.rollCall;

			// Click palette item with data-type - apply to selection (no paint mode)
			// Exclude split items - they have their own handler
			// Use .off() before .on() to prevent duplicate handlers
			self.wrapper.off('click.palette-type').on('click.palette-type', '.palette-item[data-type]:not(.palette-split-item)', function(e) {
				// Skip disabled items (no permission)
				if ($(this).hasClass('disabled') || $(this).prop('disabled')) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				const type = $(this).data('type');

				// Skip if in split mode - split items have their own handler
				if (self.palette_mode === 'split') {
					return;
				}

				// Only apply if there are selected cells
				if (self.selection.selected_cells.size > 0) {
					self.data.apply_to_selection(type);
				} else {
					// No cells selected - show hint
					frappe.show_alert({ message: __('Select cells first, then click a type to apply'), indicator: 'blue' });
				}
			});

			// Click split action (unbind first to prevent duplicates)
			self.wrapper.off('click.split-action').on('click.split-action', '.palette-item[data-action="split"]', (e) => {
				e.stopPropagation();
				if (self.selection.selected_cells.size === 0) {
					frappe.show_alert({ message: __('Select cells first, then click Split'), indicator: 'blue' });
					return;
				}
				// Don't toggle - just enter if not already in split mode
				if (self.palette_mode === 'split') {
					return;
				}
				self.enter_split_mode();
			});

			// Click split cancel (supports both old and new button styles)
			self.wrapper.off('click.split-cancel').on('click.split-cancel', '[data-action="split-cancel"]', (e) => {
				e.stopPropagation();
				self.exit_split_mode();
			});

			// Click split mode item (AM/PM selection)
			self.wrapper.off('click.split-item').on('click.split-item', '.palette-split-item', (e) => {
				e.stopPropagation();
				e.preventDefault();
				const $item = $(e.currentTarget);
				// Skip disabled items (no permission)
				if ($item.hasClass('disabled') || $item.prop('disabled')) {
					return;
				}
				const type = $item.data('type');
				const half = $item.data('half');

				// Ensure we're in split mode (defensive check)
				if (self.palette_mode !== 'split') {
					self.palette_mode = 'split';
				}

				self.select_split_type(type, half);
			});

			// Click clear action - only works with selection
			// Use .off() before .on() to prevent duplicate handlers
			self.wrapper.off('click.clear-action').on('click.clear-action', '.palette-item[data-action="clear"]', () => {
				if (self.selection.selected_cells.size > 0) {
					self.clear_selection_cells();
				} else {
					frappe.show_alert({ message: __('Select cells first, then click Clear'), indicator: 'blue' });
				}
			});

			// Escape key exits split mode or clears selection
			$(document).off('keydown.palette').on('keydown.palette', (e) => {
				if ($(e.target).is('input, textarea, select')) return;

				if (e.key === 'Escape') {
					if (self.palette_mode === 'split') {
						self.exit_paint_mode();
					} else if (self.selection.selected_cells.size > 0) {
						self.selection.clear_selection();
					}
					e.preventDefault();
				}
			});

			// Status bar clear selection button
			// Use .off() before .on() to prevent duplicate handlers
			self.wrapper.off('click.clear-selection').on('click.clear-selection', '[data-action="clear-selection"]', () => {
				self.selection.clear_selection();
			});

			// Status bar "Create Leave App" button - use same logic as badge
			self.wrapper.off('click.create-leave-from-status').on('click.create-leave-from-status', '.btn-create-leave-from-status', function(e) {
				e.preventDefault();
				e.stopPropagation();
				const $btn = $(this);
				const presence_type = $btn.data('presence-type');
				const from_date = $btn.data('from-date');
				const to_date = $btn.data('to-date');
				self.create_leave_application(presence_type, from_date, to_date);
			});
		}

		/**
		 * Bind suggestion button events
		 */
		bind_suggestion_events() {
			const self = this.rollCall;

			// Bind click events for suggestion buttons and collapse toggle.
			// Use event delegation since suggestions are dynamically rendered.
			self.wrapper.find('.btn-create-leave-app').off('click').on('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				const $btn = $(this);
				const presence_type = $btn.data('presence-type');
				const from_date = $btn.data('from-date');
				const to_date = $btn.data('to-date');
				self.create_leave_application(presence_type, from_date, to_date);
			});

			self.wrapper.find('.btn-view-leave-app').off('click').on('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				const $btn = $(this);
				const leave_app = $btn.data('leave-app');
				frappe.set_route('Form', 'Leave Application', leave_app);
			});

			self.wrapper.find('.suggestions-header').off('click').on('click', function(e) {
				e.preventDefault();
				const $suggestions = self.wrapper.find('.leave-suggestions');
				$suggestions.toggleClass('collapsed');
			});
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.EventManager = EventManager;
})();

