/**
 * Grid Renderer Module
 * Handles all grid rendering logic for the Roll Call table
 */
(function() {
	'use strict';

	class GridRenderer {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		/**
		 * Debounced render - batches rapid render calls
		 */
		render_debounced() {
			if (this.rollCall._render_debounce_timer) {
				clearTimeout(this.rollCall._render_debounce_timer);
			}
			this.rollCall._pending_render = true;
			this.rollCall._render_debounce_timer = setTimeout(() => {
				if (this.rollCall._pending_render) {
					this.rollCall._pending_render = false;
					this.render();
				}
			}, 50); // 50ms debounce for rapid updates
		}

		/**
		 * Main render method - builds the entire table HTML
		 */
		render() {
			// Clear any pending debounced renders
			if (this.rollCall._render_debounce_timer) {
				clearTimeout(this.rollCall._render_debounce_timer);
				this.rollCall._render_debounce_timer = null;
			}
			this.rollCall._pending_render = false;

			const all_days = this.rollCall.get_days_in_range();
			const month_spans = this.rollCall.get_month_spans(all_days);
			const dateRange = this.rollCall.getVisibleDateRange();

			// Get leave notice counts for badges
			const suggestions = this.rollCall.detect_leave_suggestions();
			const open_apps = this.rollCall.detect_open_leave_applications();
			const needed_count = suggestions.length;
			const open_count = open_apps.length;

			// Build HTML string (modern browsers optimize this well)
			// Use array join for better performance than string concatenation
			const htmlParts = [];
			htmlParts.push(`<div class="roll-call-container">`);
			htmlParts.push(`<div class="roll-call-toolbar compact">`);
			htmlParts.push(`<div class="toolbar-row">`);
			htmlParts.push(`<div class="toolbar-nav">`);
			htmlParts.push(`<button class="btn btn-default btn-sm btn-today">${__('Today')}</button>`);
			htmlParts.push(`<button class="btn btn-default btn-sm btn-nav-arrow btn-nav-left" title="${__('Scroll left')}">`);
			htmlParts.push(`<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">`);
			htmlParts.push(`<path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
			htmlParts.push(`</svg></button>`);
			htmlParts.push(`<span class="visible-date-range">${dateRange}</span>`);
			htmlParts.push(`<button class="btn btn-default btn-sm btn-nav-arrow btn-nav-right" title="${__('Scroll right')}">`);
			htmlParts.push(`<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">`);
			htmlParts.push(`<path d="M4 1l5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
			htmlParts.push(`</svg></button></div>`);
			htmlParts.push(`<div class="toolbar-right">`);
			// Always render badges (hidden initially if count is 0) so update_suggestions_banner() can update them
			htmlParts.push(`<span class="leave-badge leave-badge-needed" role="button" tabindex="0" title="${__('Leave Applications Needed')}" ${needed_count === 0 ? 'style="display: none;"' : ''}>`);
			htmlParts.push(`${frappe.utils.icon('triangle-alert', 'xs')}`);
			htmlParts.push(`<span class="badge-count">${needed_count}</span></span>`);
			htmlParts.push(`<span class="leave-badge leave-badge-open" role="button" tabindex="0" title="${__('Open Leave Applications')}" ${open_count === 0 ? 'style="display: none;"' : ''}>`);
			htmlParts.push(`${frappe.utils.icon('clock', 'xs')}`);
			htmlParts.push(`<span class="badge-count">${open_count}</span></span>`);
			// "For Review" badge for leave approvers - only shown when count > 0
			const review_count = this.rollCall.pending_review_count || 0;
			if (review_count > 0) {
				htmlParts.push(`<a href="/app/leave-application?status=Open" class="leave-badge leave-badge-review" title="${__('Leave Applications For Review')}">`);
				htmlParts.push(`${frappe.utils.icon('clipboard-check', 'xs')}`);
				htmlParts.push(`<span class="badge-text">${__('For Review')}</span>`);
				htmlParts.push(`<span class="badge-count">${review_count}</span></a>`);
			}
			htmlParts.push(`<label class="weekend-toggle" title="${__('Show Weekends')}">`);
			htmlParts.push(`<input type="checkbox" class="show-weekends-check" ${this.rollCall.show_weekends ? 'checked' : ''}>`);
			htmlParts.push(`<span class="toggle-text">${__('Show Weekends')}</span></label>`);
			htmlParts.push(`</div></div></div>`);
			htmlParts.push(this.rollCall.palette.render());
			htmlParts.push(`<div class="roll-call-table-wrapper">`);
			htmlParts.push(`<table class="roll-call-table">`);
			htmlParts.push(`<thead>`);
			htmlParts.push(`<tr class="month-row">`);
			htmlParts.push(`<th class="employee-col" rowspan="2">${__('Employee')}</th>`);
			month_spans.forEach(s => {
				htmlParts.push(`<th colspan="${s.colspan}" class="month-header">${s.month}</th>`);
			});
			htmlParts.push(`</tr>`);
			htmlParts.push(`<tr class="day-row">`);
			htmlParts.push(this.render_day_headers(all_days));
			htmlParts.push(`</tr></thead>`);
			htmlParts.push(`<tbody>`);
			// Build rows efficiently
			for (const emp of this.rollCall.employees) {
				htmlParts.push(this.render_employee_row(emp, all_days));
			}
			htmlParts.push(`</tbody>`);
			htmlParts.push(`<tfoot>`);
			htmlParts.push(`<tr class="scroll-footer">`);
			htmlParts.push(`<td class="employee-col"></td>`);
			htmlParts.push(`<td colspan="${this.rollCall.get_visible_column_count(all_days)}"></td>`);
			htmlParts.push(`</tr></tfoot></table></div></div>`);

			// Single DOM operation - replace entire content
			this.rollCall.wrapper.html(htmlParts.join(''));
			this.rollCall.events.bind_events();
			this.rollCall.events.bind_palette_events();
			// Update leave suggestion badges after render
			this.rollCall._suggestions_dirty = true;
			this.rollCall.update_suggestions_banner();
			// Build element map for O(1) cell lookups
			requestAnimationFrame(() => this.rollCall.build_element_map());
		}

		/**
		 * Re-render just the toolbar (for badge updates without full re-render)
		 */
		render_toolbar() {
			const $toolbar = this.rollCall.wrapper.find('.roll-call-toolbar .toolbar-right');
			if (!$toolbar.length) return;

			// Get current counts
			const suggestions = this.rollCall.detect_leave_suggestions();
			const open_apps = this.rollCall.detect_open_leave_applications();
			const needed_count = suggestions.length;
			const open_count = open_apps.length;
			const review_count = this.rollCall.pending_review_count || 0;

			// Build badges HTML
			let html = '';

			// Needed badge
			html += `<span class="leave-badge leave-badge-needed" role="button" tabindex="0" title="${__('Leave Applications Needed')}" ${needed_count === 0 ? 'style="display: none;"' : ''}>`;
			html += `${frappe.utils.icon('triangle-alert', 'xs')}`;
			html += `<span class="badge-count">${needed_count}</span></span>`;

			// Open badge
			html += `<span class="leave-badge leave-badge-open" role="button" tabindex="0" title="${__('Open Leave Applications')}" ${open_count === 0 ? 'style="display: none;"' : ''}>`;
			html += `${frappe.utils.icon('clock', 'xs')}`;
			html += `<span class="badge-count">${open_count}</span></span>`;

			// For Review badge (only if count > 0)
			if (review_count > 0) {
				html += `<a href="/app/leave-application?status=Open" class="leave-badge leave-badge-review" title="${__('Leave Applications For Review')}">`;
				html += `${frappe.utils.icon('clipboard-check', 'xs')}`;
				html += `<span class="badge-text">${__('For Review')}</span>`;
				html += `<span class="badge-count">${review_count}</span></a>`;
			}

			// Weekend toggle
			html += `<label class="weekend-toggle" title="${__('Show Weekends')}">`;
			html += `<input type="checkbox" class="show-weekends-check" ${this.rollCall.show_weekends ? 'checked' : ''}>`;
			html += `<span class="toggle-text">${__('Show Weekends')}</span></label>`;

			$toolbar.html(html);
		}

		/**
		 * Render day headers row
		 */
		render_day_headers(days) {
			let html = '';
			let prev_visible_day = null;
			const today = frappe.datetime.get_today();

			for (let i = 0; i < days.length; i++) {
				const d = days[i];

				// Skip weekends when hidden
				if (!this.rollCall.show_weekends && d.is_weekend) continue;

				const classes = ['day-col'];
				if (d.is_weekend) classes.push('weekend');
				if (d.date === today) classes.push('today-header');
				
				// Add thick border class for Monday cells (always comes after weekend)
				if (d.is_monday) {
					classes.push('weekend-separator');
				}

				html += `
					<th class="${classes.join(' ')}">
						<div class="day-header">
							<span class="weekday">${d.weekday}</span>
							<span class="day-num">${d.day}</span>
						</div>
					</th>
				`;

				prev_visible_day = d;
			}
			return html;
		}

		/**
		 * Render a single employee row
		 */
		render_employee_row(emp, days) {
			const is_own = emp.name === this.rollCall.current_employee;
			const display_name = this.rollCall.format_display_name(emp);
			const avatar = emp.image
				? `<img src="${emp.image}" class="avatar-img">`
				: `<span class="avatar-letter">${(emp.nickname || emp.employee_name).charAt(0).toUpperCase()}</span>`;

			let cells = '';
			let prev_visible_day = null;

			for (let i = 0; i < days.length; i++) {
				const d = days[i];

				// Skip weekends when hidden
				if (!this.rollCall.show_weekends && d.is_weekend) continue;

				// Render the cell
				let cellHtml = this.render_day_cell(emp, d);
				
				// Add weekend separator class to Monday cells
				if (d.is_monday) {
					cellHtml = cellHtml.replace(/class="/, 'class="weekend-separator ');
				}
				
				cells += cellHtml;
				prev_visible_day = d;
			}

			return `
				<tr class="${is_own ? 'own-row' : ''}" data-employee="${emp.name}">
					<td class="employee-col">
						<div class="employee-info">
							<div class="employee-avatar">${avatar}</div>
							<span class="employee-name">${display_name}</span>
						</div>
					</td>
					${cells}
				</tr>
			`;
		}

		/**
		 * Render a single day cell for an employee
		 */
		render_day_cell(emp, day) {
			const key = `${emp.name}|${day.date}`;
			const entry = this.rollCall.entries[key];
			// Check for pending (open) leave applications
			const pending_leave = this.rollCall.get_pending_leave(emp.name, day.date);

			const is_own = emp.name === this.rollCall.current_employee;
			const can_edit = this.rollCall.can_edit_employee(emp.name);
			const today = frappe.datetime.get_today();
			const is_today = day.date === today;
			const is_past = day.date < today;

			const classes = ['day-cell'];
			let cell_style = '';

			if (day.is_weekend) classes.push('weekend');
			if (is_today) classes.push('today');
			if (can_edit && !day.is_weekend) classes.push('editable');
			
			// Add weekend separator for Monday cells
			if (day.is_monday) {
				classes.push('weekend-separator');
			}

			let content = '';

			// Weekend cells are just empty - no content at all
			if (day.is_weekend) {
				return `<td class="${classes.join(' ')}" data-date="${day.date}"></td>`;
			}

			if (entry) {
				const pt = this.rollCall.presence_types_map.get(entry.presence_type);

				// Check if it's a split half-day entry
				if (entry.is_half_day && entry.am_presence_type && entry.pm_presence_type) {
					// Split cell - show AM/PM separately
					const am_pt = this.rollCall.presence_types_map.get(entry.am_presence_type);
					const pm_pt = this.rollCall.presence_types_map.get(entry.pm_presence_type);
					classes.push('has-entry', 'split-day');

					// Determine leave status classes for each half
					const am_leave_status = entry.am_leave_status || 'none';
					const pm_leave_status = entry.pm_leave_status || 'none';
					const am_leave_class = am_leave_status === 'tentative' ? 'leave-tentative' :
					                       am_leave_status === 'draft' ? 'leave-draft' : '';
					const pm_leave_class = pm_leave_status === 'tentative' ? 'leave-tentative' :
					                       pm_leave_status === 'draft' ? 'leave-draft' : '';

					content = `
						<div class="split-cell">
							<div class="split-am ${am_leave_class}" style="--presence-color: ${this.rollCall.get_color_var(am_pt?.color)}">
								<span class="presence-icon">${am_pt?.icon || '•'}</span>
							</div>
							<div class="split-pm ${pm_leave_class}" style="--presence-color: ${this.rollCall.get_color_var(pm_pt?.color)}">
								<span class="presence-icon">${pm_pt?.icon || '•'}</span>
							</div>
						</div>
					`;
				} else {
					// Single entry (full day or legacy half day)
					const presence_color = this.rollCall.get_color_var(pt?.color);
					cell_style = `--presence-color: ${presence_color};`;
					classes.push('has-entry');

					// Add leave status class for striped patterns
					// leave_status: "none" | "tentative" | "draft" | "approved"
					// Override: if pending_leave exists, treat as draft
					let leave_status = entry.leave_status || 'none';
					if (pending_leave) {
						leave_status = 'draft';
					}
					if (leave_status === 'tentative') {
						classes.push('leave-tentative');
						// CSS handles the pattern via --presence-color variable
					} else if (leave_status === 'draft') {
						classes.push('leave-draft');
						// CSS handles the pattern via --presence-color variable
					}
					// "approved" and "none" use solid color (default has-entry styling)

					content = `
						<div class="presence-cell">
							<span class="presence-icon">${pt?.icon || '•'}</span>
							${entry.is_locked ? '<span class="locked-badge">🔒</span>' : ''}
						</div>
					`;
				}
			} else if (pending_leave) {
				// No Roll Call Entry but there's a pending leave application
				// Show with striped pattern (draft status)
				cell_style = `--presence-color: ${this.rollCall.get_color_var(pending_leave.color)};`;
				classes.push('has-entry', 'leave-draft');

				content = `
					<div class="presence-cell">
						<span class="presence-icon">${pending_leave.icon || '📋'}</span>
					</div>
				`;
			} else if (is_past) {
				content = '<span class="missing-indicator">!</span>';
			}

			return `
				<td class="${classes.join(' ')}" style="${cell_style}"
					data-employee="${emp.name}"
					data-date="${day.date}"
					data-leave-status="${entry?.leave_status || (pending_leave ? 'draft' : '')}"
					data-pending-leave="${pending_leave?.name || ''}"
					${entry?.is_locked ? 'data-locked="1"' : ''}>
					${content}
				</td>
			`;
		}

		/**
		 * Update a single cell with new entry data (used for optimistic updates)
		 */
		update_cell(employee, date, entry_data) {
			const $cell = this.rollCall.get_cell_element(employee, date);
			if (!$cell || !$cell.length) return;

			const key = `${employee}|${date}`;
			const pending_leave = this.rollCall.get_pending_leave(employee, date);

			// Update entries cache
			if (entry_data) {
				this.rollCall.entries[key] = entry_data;
			} else {
				delete this.rollCall.entries[key];
			}

			const classes = ['day-cell'];
			const day = this.rollCall.get_days_in_range().find(d => d.date === date);
			if (day) {
				if (day.is_weekend) classes.push('weekend');
				if (day.is_today) classes.push('today');
				if (day.is_past) classes.push('past');
			}

			const is_own = employee === this.rollCall.current_employee;
			const can_edit = this.rollCall.can_edit_employee(employee);
			if (can_edit && !day?.is_weekend) classes.push('editable');
			
			// Add weekend separator for Monday cells
			if (day && day.is_monday) {
				classes.push('weekend-separator');
			}

			let cell_style = '';
			let content = '';

			if (entry_data) {
				const pt = this.rollCall.presence_types_map.get(entry_data.presence_type);

				if (entry_data.is_half_day && entry_data.am_presence_type && entry_data.pm_presence_type) {
					// Split cell - show AM/PM separately (match render_day_cell logic)
					const am_pt = this.rollCall.presence_types_map.get(entry_data.am_presence_type);
					const pm_pt = this.rollCall.presence_types_map.get(entry_data.pm_presence_type);
					classes.push('has-entry', 'split-day');

					// Determine leave status classes for each half
					const am_leave_status = entry_data.am_leave_status || 'none';
					const pm_leave_status = entry_data.pm_leave_status || 'none';
					const am_leave_class = am_leave_status === 'tentative' ? 'leave-tentative' :
					                       am_leave_status === 'draft' ? 'leave-draft' : '';
					const pm_leave_class = pm_leave_status === 'tentative' ? 'leave-tentative' :
					                       pm_leave_status === 'draft' ? 'leave-draft' : '';

					content = `
						<div class="split-cell">
							<div class="split-am ${am_leave_class}" style="--presence-color: ${this.rollCall.get_color_var(am_pt?.color)}">
								<span class="presence-icon">${am_pt?.icon || '•'}</span>
							</div>
							<div class="split-pm ${pm_leave_class}" style="--presence-color: ${this.rollCall.get_color_var(pm_pt?.color)}">
								<span class="presence-icon">${pm_pt?.icon || '•'}</span>
							</div>
						</div>
					`;
				} else {
					// Single entry (full day or legacy half day) - match render_day_cell logic
					const presence_color = this.rollCall.get_color_var(pt?.color);
					cell_style = `--presence-color: ${presence_color};`;
					classes.push('has-entry');

					// Add leave status class for striped patterns
					let leave_status = entry_data.leave_status || 'none';
					if (pending_leave) {
						leave_status = 'draft';
					}
					if (leave_status === 'tentative') {
						classes.push('leave-tentative');
					} else if (leave_status === 'draft') {
						classes.push('leave-draft');
					}

					content = `
						<div class="presence-cell">
							<span class="presence-icon">${pt?.icon || '•'}</span>
							${entry_data.is_locked ? '<span class="locked-badge">🔒</span>' : ''}
						</div>
					`;
				}
			} else if (pending_leave) {
				// No Roll Call Entry but there's a pending leave application
				// Show with striped pattern (draft status) - match render_day_cell logic
				cell_style = `--presence-color: ${this.rollCall.get_color_var(pending_leave.color)};`;
				classes.push('has-entry', 'leave-draft');

				content = `
					<div class="presence-cell">
						<span class="presence-icon">${pending_leave.icon || '📋'}</span>
					</div>
				`;
			} else if (day && day.date < frappe.datetime.get_today()) {
				content = '<span class="missing-indicator">!</span>';
			}

			// Update the cell
			$cell.attr('class', classes.join(' '));
			$cell.attr('style', cell_style);
			$cell.attr('data-leave-status', entry_data?.leave_status || (pending_leave ? 'draft' : ''));
			$cell.attr('data-pending-leave', pending_leave?.name || '');
			if (entry_data?.is_locked) {
				$cell.attr('data-locked', '1');
			} else {
				$cell.removeAttr('data-locked');
			}
			$cell.html(content);

			// Mark suggestions as dirty and schedule update if this is current user's cell
			if (employee === this.rollCall.current_employee) {
				this.rollCall._suggestions_dirty = true;
				this.rollCall.schedule_suggestion_update();
			}
		}

		/**
		 * Optimistically update a cell for full-day presence type
		 */
		update_cell_optimistic(employee, date, presence_type) {
			const pt = this.rollCall.presence_types_map.get(presence_type);
			const $cell = this.rollCall.get_cell_element(employee, date);

			if ($cell.length && pt) {
				$cell.addClass('has-entry saving')
					.removeClass('leave-tentative leave-draft split-day')
					.css('--presence-color', this.rollCall.get_color_var(pt.color));

				$cell.find('.presence-cell, .split-cell, .missing-indicator').remove();
				$cell.append(`
					<div class="presence-cell">
						<span class="presence-icon">${pt.icon || '•'}</span>
					</div>
				`);
			}
		}

		/**
		 * Optimistically clear a cell
		 */
		update_cell_clear_optimistic(employee, date) {
			const $cell = this.rollCall.get_cell_element(employee, date);

			if ($cell.length) {
				$cell.removeClass('has-entry saving split-day leave-tentative leave-draft')
					.css('--presence-color', '')
					.html('');
			}
		}

		/**
		 * Optimistically update a cell for split display
		 */
		update_cell_split_optimistic(employee, date, am_type, pm_type) {
			const am_pt = this.rollCall.presence_types_map.get(am_type);
			const pm_pt = this.rollCall.presence_types_map.get(pm_type);
			const $cell = this.rollCall.get_cell_element(employee, date);

			if ($cell.length && am_pt && pm_pt) {
				$cell.addClass('has-entry split-day saving')
					.removeClass('leave-tentative leave-draft')
					.css('--presence-color', '');

				$cell.find('.presence-cell, .split-cell, .missing-indicator').remove();
				$cell.append(`
					<div class="split-cell">
						<div class="split-am" style="--presence-color: ${this.rollCall.get_color_var(am_pt.color)}">
							<span class="presence-icon">${am_pt.icon || '•'}</span>
						</div>
						<div class="split-pm" style="--presence-color: ${this.rollCall.get_color_var(pm_pt.color)}">
							<span class="presence-icon">${pm_pt.icon || '•'}</span>
						</div>
					</div>
				`);
			}
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.GridRenderer = GridRenderer;
})();

