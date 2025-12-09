frappe.pages['roll-call'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Roll Call'),
		single_column: true
	});

	// Initialize Roll Call (toolbar is built inside the RollCallTable class)
	page.roll_call = new RollCallTable(page);
};

frappe.pages['roll-call'].refresh = function(wrapper) {
	const page = wrapper.page;
	if (page.roll_call) {
		page.roll_call.refresh();
	}
};

class RollCallTable {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);

		// Rolling view: start from today, not month start
		this.start_date = frappe.datetime.get_today();
		this.INITIAL_DAYS = 60;
		this.EXPAND_BY = 30;
		this.total_days = this.INITIAL_DAYS;

		this.presence_types = [];
		this.entries = {};
		this.employees = [];
		this.is_hr_manager = frappe.user_roles.includes('HR Manager');
		this.current_employee = null;
		this.hide_weekends = true;  // Default to hiding weekends
		this.show_past = false;  // Default to not showing past days

		// Filter controls (populated in setup_toolbar_filters)
		this.company_filter = null;
		this.department_filter = null;
		this.employee_filter = null;

		// Multi-selection state
		this.selected_cells = new Set();
		this.is_selecting = false;

		// Infinite scroll state
		this.is_expanding = false;
		this.visible_start_date = '';
		this.visible_end_date = '';

		// Constants for scroll detection
		this.EDGE_THRESHOLD = 200; // pixels from edge to trigger load
		this.COLUMN_WIDTH = 44; // min-width of day columns
		this.EMPLOYEE_COLUMN_WIDTH = 180; // min-width of employee column

		this.setup();
	}

	get_filters() {
		return {
			company: this.company_filter?.get_value(),
			department: this.department_filter?.get_value(),
			employee: this.employee_filter?.get_value()
		};
	}

	async setup() {
		this.wrapper.html(`<div class="roll-call-loading text-muted">${__('Loading...')}</div>`);

		// Get current employee
		try {
			const emp_result = await frappe.call({
				method: 'frappe.client.get_value',
				args: {
					doctype: 'Employee',
					filters: { user_id: frappe.session.user },
					fieldname: 'name'
				}
			});
			this.current_employee = emp_result.message?.name;
		} catch (e) {
			console.log('Could not get current employee:', e);
		}

		// Load presence types
		await this.load_presence_types();

		// Render
		await this.refresh();
	}

	async load_presence_types() {
		try {
			const result = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Presence Type',
					fields: ['name', 'label', 'icon', 'category', 'color', 'is_system', 'requires_leave_application', 'leave_type'],
					filters: {},
					order_by: 'sort_order asc',
					limit_page_length: 0
				}
			});
			this.presence_types = result.message || [];
		} catch (e) {
			console.error('Error loading presence types:', e);
			this.presence_types = [];
		}
	}

	get_end_date() {
		// Calculate end date based on start_date + total_days
		const start = frappe.datetime.str_to_obj(this.start_date);
		const end = new Date(start);
		end.setDate(end.getDate() + this.total_days - 1);
		return frappe.datetime.obj_to_str(end);
	}

	// Convert color name to CSS variable (supports both new color names and legacy hex)
	get_color_var(color) {
		if (!color) return 'var(--bg-light-gray)';
		// If it's a Frappe color name, use the variable
		const frappe_colors = ['blue', 'green', 'orange', 'yellow', 'red', 'purple', 'pink', 'cyan', 'gray', 'grey'];
		if (frappe_colors.includes(color)) {
			return `var(--bg-${color})`;
		}
		// Legacy: if it's a hex color, return as-is
		if (color.startsWith('#')) {
			return color;
		}
		return 'var(--bg-light-gray)';
	}

	async load_data() {
		const filters = this.get_filters();

		const emp_filters = { status: 'Active' };
		if (filters.company) emp_filters.company = filters.company;
		if (filters.department) emp_filters.department = filters.department;
		if (filters.employee) emp_filters.name = filters.employee;

		const range_start = this.start_date;
		const range_end = this.get_end_date();

		try {
			// Load employees and entries in parallel
			const [employees_result, events_result] = await Promise.all([
				frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Employee',
						fields: ['name', 'employee_name', 'image'],
						filters: emp_filters,
						order_by: 'employee_name asc',
						limit_page_length: 0
					}
				}),
				frappe.call({
					method: 'flexitime.api.roll_call.get_events',
					args: {
						month_start: range_start,
						month_end: range_end,
						employee_filters: filters
					}
				})
			]);

			this.employees = employees_result.message || [];

			// Get entries from the new API response
			const events_data = events_result.message || {};
			const entries_by_employee = events_data.entries || {};

			// Sort: own employee first
			this.employees.sort((a, b) => {
				if (a.name === this.current_employee) return -1;
				if (b.name === this.current_employee) return 1;
				return a.employee_name.localeCompare(b.employee_name);
			});

			// Index entries by employee+date
			this.entries = {};
			for (const [employee, entries] of Object.entries(entries_by_employee)) {
				for (const entry of entries) {
					const key = `${entry.employee}|${entry.date}`;
					this.entries[key] = entry;
				}
			}

		} catch (e) {
			console.error('Error loading data:', e);
			const error_msg = e.message || e._server_messages || e;
			frappe.msgprint({
				title: __('Error loading roll call data'),
				message: `<pre>${JSON.stringify(error_msg, null, 2)}</pre>`,
				indicator: 'red'
			});
		}
	}

	get_days_in_range() {
		const days = [];
		const start = frappe.datetime.str_to_obj(this.start_date);
		const end = frappe.datetime.str_to_obj(this.get_end_date());

		let d = new Date(start);
		let prev_month = null;

		while (d <= end) {
			const month = d.toLocaleDateString('en-US', { month: 'short' });
			const is_new_month = month !== prev_month;
			prev_month = month;
			const dow = d.getDay();

			days.push({
				date: frappe.datetime.obj_to_str(d),
				day: d.getDate(),
				month: month,
				is_new_month: is_new_month,
				weekday: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dow],
				is_weekend: dow === 0 || dow === 6,
				is_sunday: dow === 0,
				is_monday: dow === 1,
				is_friday: dow === 5
			});
			d.setDate(d.getDate() + 1);
		}
		return days;
	}

	get_month_spans(days) {
		// Calculate colspan for each month (include weekend separator columns)
		const spans = [];
		let current_month = null;
		let count = 0;

		for (let i = 0; i < days.length; i++) {
			const day = days[i];

			// Skip weekends when hidden
			if (this.hide_weekends && day.is_weekend) continue;

			// Add separator column:
			// - When showing weekends: after Sunday (before Monday)
			// - When hiding weekends: after Friday (before Monday) - but we need to detect this
			if (!this.hide_weekends && i > 0 && days[i-1]?.is_sunday) {
				count++; // separator column
			}
			if (this.hide_weekends && day.is_monday && i > 0) {
				// Check if previous visible day was Friday
				let prev_visible_idx = i - 1;
				while (prev_visible_idx >= 0 && days[prev_visible_idx].is_weekend) {
					prev_visible_idx--;
				}
				if (prev_visible_idx >= 0 && days[prev_visible_idx].is_friday) {
					count++; // separator column
				}
			}

			if (day.month !== current_month) {
				if (current_month !== null) {
					spans.push({ month: current_month, colspan: count });
				}
				current_month = day.month;
				count = 1;
			} else {
				count++;
			}
		}
		if (current_month !== null) {
			spans.push({ month: current_month, colspan: count });
		}
		return spans;
	}

	get_visible_column_count(days) {
		// Count visible columns including weekend separators
		let count = 0;
		let prev_visible_day = null;

		for (let i = 0; i < days.length; i++) {
			const d = days[i];
			if (this.hide_weekends && d.is_weekend) continue;

			// Count separator columns
			if (!this.hide_weekends && i > 0 && days[i-1]?.is_sunday) {
				count++;
			} else if (this.hide_weekends && d.is_monday && prev_visible_day?.is_friday) {
				count++;
			}

			count++;
			prev_visible_day = d;
		}
		return count;
	}

	getVisibleDateRange() {
		// Show the visible date range (updated dynamically on scroll)
		const start = this.visible_start_date || this.start_date;
		const end = this.visible_end_date || this.get_end_date();

		const start_obj = frappe.datetime.str_to_obj(start);
		const end_obj = frappe.datetime.str_to_obj(end);

		const format_date = (d) => {
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		};

		// Include year if dates span different years
		const start_year = start_obj.getFullYear();
		const end_year = end_obj.getFullYear();

		if (start_year !== end_year) {
			return `${format_date(start_obj)}, ${start_year} - ${format_date(end_obj)}, ${end_year}`;
		} else {
			return `${format_date(start_obj)} - ${format_date(end_obj)}, ${end_year}`;
		}
	}

	render() {
		const all_days = this.get_days_in_range();
		const month_spans = this.get_month_spans(all_days);
		const dateRange = this.getVisibleDateRange();

		let html = `
			<div class="roll-call-container">
				<!-- Custom Toolbar -->
				<div class="roll-call-toolbar">
					<div class="toolbar-row">
						<!-- Navigation - Today button, arrows, and date range -->
						<div class="toolbar-nav">
							<button class="btn btn-default btn-sm btn-today">${__('Today')}</button>
							<button class="btn btn-default btn-sm btn-nav-arrow btn-nav-left" title="${__('Scroll left')}">
								<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
									<path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							</button>
							<span class="visible-date-range">${dateRange}</span>
							<button class="btn btn-default btn-sm btn-nav-arrow btn-nav-right" title="${__('Scroll right')}">
								<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
									<path d="M4 1l5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							</button>
						</div>

						<!-- Options -->
						<div class="toolbar-options">
							<div class="checkbox" style="margin: 0;">
								<label style="margin: 0; cursor: pointer;">
									<input type="checkbox" class="hide-weekends-check" ${this.hide_weekends ? 'checked' : ''}>
									<span>${__('Hide Weekends')}</span>
								</label>
							</div>
							<div class="checkbox" style="margin: 0;">
								<label style="margin: 0; cursor: pointer;">
									<input type="checkbox" class="show-past-check" ${this.show_past ? 'checked' : ''}>
									<span>${__('Show Past')}</span>
								</label>
							</div>
						</div>
					</div>

					<div class="toolbar-row toolbar-filters-row">
						<div class="toolbar-filters">
							<div class="filter-field" data-fieldname="company"></div>
							<div class="filter-field" data-fieldname="department"></div>
							<div class="filter-field" data-fieldname="employee"></div>
						</div>
					</div>
				</div>

				<!-- Selection Bar (when cells selected) -->
				<div class="selection-toolbar" style="display: none;">
					<span class="selection-count"></span>
					<div class="selection-actions">
						<button class="btn btn-primary btn-sm btn-set-selection">${__('Set Presence')}</button>
						<button class="btn btn-default btn-sm btn-clear-selection">${__('Clear')}</button>
					</div>
				</div>

				<!-- Leave Application Suggestions (for current user) -->
				${this.render_leave_suggestions()}

				<!-- Table -->
				<div class="roll-call-table-wrapper">
					<table class="roll-call-table">
						<thead>
							<tr class="month-row">
								<th class="employee-col" rowspan="2">${__('Employee')}</th>
								${month_spans.map(s => `
									<th colspan="${s.colspan}" class="month-header">${s.month}</th>
								`).join('')}
							</tr>
							<tr class="day-row">
								${this.render_day_headers(all_days)}
							</tr>
						</thead>
						<tbody>
							${this.employees.map(emp => this.render_employee_row(emp, all_days)).join('')}
						</tbody>
						<tfoot>
							<tr class="scroll-footer">
								<td class="employee-col"></td>
								<td colspan="${this.get_visible_column_count(all_days)}"></td>
							</tr>
						</tfoot>
					</table>
				</div>

				<!-- Legend -->
				${this.render_legend()}
			</div>
		`;

		this.wrapper.html(html);
		this.setup_toolbar_filters();
		this.bind_events();
	}

	render_day_headers(days) {
		let html = '';
		let prev_visible_day = null;
		const today = frappe.datetime.get_today();

		for (let i = 0; i < days.length; i++) {
			const d = days[i];

			// Skip weekends when hidden
			if (this.hide_weekends && d.is_weekend) continue;

			// Add separator column
			if (!this.hide_weekends && i > 0 && days[i-1]?.is_sunday) {
				// Showing weekends: separator after Sunday
				html += `<th class="weekend-separator"></th>`;
			} else if (this.hide_weekends && d.is_monday && prev_visible_day?.is_friday) {
				// Hiding weekends: separator between Friday and Monday
				html += `<th class="weekend-separator"></th>`;
			}

			const classes = ['day-col'];
			if (d.is_weekend) classes.push('weekend');
			if (d.date === today) classes.push('today-header');

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

	render_employee_row(emp, days) {
		const is_own = emp.name === this.current_employee;
		const avatar = emp.image
			? `<img src="${emp.image}" class="avatar-img">`
			: `<span class="avatar-letter">${emp.employee_name.charAt(0).toUpperCase()}</span>`;

		let cells = '';
		let prev_visible_day = null;

		for (let i = 0; i < days.length; i++) {
			const d = days[i];

			// Skip weekends when hidden
			if (this.hide_weekends && d.is_weekend) continue;

			// Add separator column
			if (!this.hide_weekends && i > 0 && days[i-1]?.is_sunday) {
				cells += `<td class="weekend-separator"></td>`;
			} else if (this.hide_weekends && d.is_monday && prev_visible_day?.is_friday) {
				cells += `<td class="weekend-separator"></td>`;
			}

			cells += this.render_day_cell(emp, d);
			prev_visible_day = d;
		}

		return `
			<tr class="${is_own ? 'own-row' : ''}" data-employee="${emp.name}">
				<td class="employee-col">
					<div class="employee-info">
						<div class="employee-avatar">${avatar}</div>
						<span class="employee-name">${emp.employee_name}</span>
					</div>
				</td>
				${cells}
			</tr>
		`;
	}

	render_day_cell(emp, day) {
		const key = `${emp.name}|${day.date}`;
		const entry = this.entries[key];

		const is_own = emp.name === this.current_employee;
		const can_edit = this.is_hr_manager || is_own;
		const today = frappe.datetime.get_today();
		const is_today = day.date === today;
		const is_past = day.date < today;

		const classes = ['day-cell'];
		let cell_style = '';

		if (day.is_weekend) classes.push('weekend');
		if (is_today) classes.push('today');
		if (can_edit && !day.is_weekend) classes.push('editable');

		let content = '';

		// Weekend cells are just empty - no content at all
		if (day.is_weekend) {
			return `<td class="${classes.join(' ')}" data-date="${day.date}"></td>`;
		}

		if (entry) {
			const pt = this.presence_types.find(p => p.name === entry.presence_type);

			// Check if it's a split half-day entry
			if (entry.is_half_day && entry.am_presence_type && entry.pm_presence_type) {
				// Split cell - show AM/PM separately
				const am_pt = this.presence_types.find(p => p.name === entry.am_presence_type);
				const pm_pt = this.presence_types.find(p => p.name === entry.pm_presence_type);
				classes.push('has-entry', 'split-day');

				// Determine leave status classes for each half
				const am_leave_status = entry.am_leave_status || 'none';
				const pm_leave_status = entry.pm_leave_status || 'none';
				const am_leave_class = am_leave_status === 'tentative' ? 'leave-tentative' :
				                       am_leave_status === 'draft' ? 'leave-draft' : '';
				const pm_leave_class = pm_leave_status === 'tentative' ? 'leave-tentative' :
				                       pm_leave_status === 'draft' ? 'leave-draft' : '';

				// Build tooltips with status info
				let am_tooltip = entry.am_presence_type;
				if (am_leave_status === 'tentative') am_tooltip += ' - ' + __('No leave application');
				if (am_leave_status === 'draft') am_tooltip += ' - ' + __('Pending approval');

				let pm_tooltip = entry.pm_presence_type;
				if (pm_leave_status === 'tentative') pm_tooltip += ' - ' + __('No leave application');
				if (pm_leave_status === 'draft') pm_tooltip += ' - ' + __('Pending approval');

				content = `
					<div class="split-cell">
						<div class="split-am ${am_leave_class}" style="--presence-color: ${this.get_color_var(am_pt?.color)}"
							 title="${am_tooltip}">
							<span class="presence-icon">${entry.am_presence_icon || am_pt?.icon || '•'}</span>
						</div>
						<div class="split-pm ${pm_leave_class}" style="--presence-color: ${this.get_color_var(pm_pt?.color)}"
							 title="${pm_tooltip}">
							<span class="presence-icon">${entry.pm_presence_icon || pm_pt?.icon || '•'}</span>
						</div>
					</div>
				`;
			} else {
				// Single entry (full day or legacy half day)
				cell_style = `--presence-color: ${this.get_color_var(pt?.color)};`;
				classes.push('has-entry');

				// Add leave status class for striped patterns
				// leave_status: "none" | "tentative" | "draft" | "approved"
				const leave_status = entry.leave_status || 'none';
				if (leave_status === 'tentative') {
					classes.push('leave-tentative');
				} else if (leave_status === 'draft') {
					classes.push('leave-draft');
				}
				// "approved" and "none" use solid color (default has-entry styling)

				// Build tooltip with status info
				let tooltip = entry.presence_type;
				if (entry.is_half_day) tooltip += ' (½)';
				if (leave_status === 'tentative') tooltip += ' - ' + __('No leave application');
				if (leave_status === 'draft') tooltip += ' - ' + __('Pending approval');

				content = `
					<div class="presence-cell" title="${tooltip}">
						<span class="presence-icon">${entry.presence_type_icon || '•'}</span>
						${entry.is_locked ? '<span class="locked-badge">🔒</span>' : ''}
					</div>
				`;
			}
		} else if (is_past) {
			content = '<span class="missing-indicator">!</span>';
		}

		return `
			<td class="${classes.join(' ')}" style="${cell_style}"
				data-employee="${emp.name}"
				data-date="${day.date}"
				data-leave-status="${entry?.leave_status || ''}"
				${entry?.is_locked ? 'data-locked="1"' : ''}>
				${content}
			</td>
		`;
	}

	/**
	 * Detect consecutive tentative days for the current user that require leave applications.
	 * Returns array of suggestions like:
	 * [{ presence_type: "Vacation", from_date: "2025-12-03", to_date: "2025-12-05", days: 3 }]
	 */
	detect_leave_suggestions() {
		if (!this.current_employee) {
			return [];
		}

		const suggestions = [];
		const all_days = this.get_days_in_range();

		// Get presence types that require leave applications
		const approval_types = this.presence_types.filter(pt => pt.requires_leave_application && !pt.is_system);
		const approval_type_names = new Set(approval_types.map(pt => pt.name));

		// Group consecutive tentative days by presence type
		let current_run = null;

		for (const day of all_days) {
			if (day.is_weekend) continue;

			const key = `${this.current_employee}|${day.date}`;
			const entry = this.entries[key];

			// Check if this is a tentative entry that requires leave application for current user
			const is_tentative_approval = entry &&
				approval_type_names.has(entry.presence_type) &&
				entry.leave_status === 'tentative';

			if (is_tentative_approval) {
				if (current_run && current_run.presence_type === entry.presence_type) {
					// Continue current run
					current_run.to_date = day.date;
					current_run.days++;
				} else {
					// Start new run (save previous if exists)
					if (current_run && current_run.days >= 1) {
						suggestions.push(current_run);
					}
					current_run = {
						presence_type: entry.presence_type,
						presence_type_label: entry.presence_type_label || entry.presence_type,
						from_date: day.date,
						to_date: day.date,
						days: 1
					};
				}
			} else {
				// End current run
				if (current_run && current_run.days >= 1) {
					suggestions.push(current_run);
				}
				current_run = null;
			}
		}

		// Don't forget the last run
		if (current_run && current_run.days >= 1) {
			suggestions.push(current_run);
		}

		return suggestions;
	}

	render_leave_suggestions() {
		const suggestions = this.detect_leave_suggestions();
		if (suggestions.length === 0) return '';

		const items = suggestions.map(s => {
			const from_display = frappe.datetime.str_to_user(s.from_date);
			const to_display = frappe.datetime.str_to_user(s.to_date);
			const date_range = s.days === 1
				? from_display
				: `${from_display} - ${to_display}`;

			return `
				<div class="leave-suggestion-item">
					<span class="suggestion-text">
						${__("{0} day(s) {1}", [s.days, s.presence_type_label])}
						<span class="text-muted">(${date_range})</span>
						${__("without leave application")}
					</span>
					<button class="btn btn-xs btn-primary btn-create-leave-app"
						data-presence-type="${s.presence_type}"
						data-from-date="${s.from_date}"
						data-to-date="${s.to_date}">
						${__("Create Leave Application")}
					</button>
				</div>
			`;
		}).join('');

		return `
			<div class="leave-suggestions-banner">
				<div class="suggestions-header">
					${frappe.utils.icon('info-sign', 'sm')}
					<span>${__("Leave Applications Needed")}</span>
				</div>
				<div class="suggestions-list">
					${items}
				</div>
			</div>
		`;
	}

	render_legend() {
		const working = this.presence_types.filter(t => t.category === 'Working' && !t.is_system);
		const leave = this.presence_types.filter(t => t.category === 'Leave' && !t.is_system);

		return `
			<div class="roll-call-legend">
				<div class="legend-section">
					<span class="legend-title">${__('Working')}:</span>
					<div class="legend-items">
						${working.map(pt => `
							<span class="legend-item" style="--item-color: ${this.get_color_var(pt.color)}">
								<span class="legend-icon">${pt.icon || '•'}</span>
								<span class="legend-label">${pt.label}</span>
							</span>
						`).join('')}
					</div>
				</div>
				<div class="legend-section">
					<span class="legend-title">${__('Leave')}:</span>
					<div class="legend-items">
						${leave.map(pt => `
							<span class="legend-item" style="--item-color: ${this.get_color_var(pt.color)}">
								<span class="legend-icon">${pt.icon || '•'}</span>
								<span class="legend-label">${pt.label}</span>
							</span>
						`).join('')}
					</div>
				</div>
			</div>
		`;
	}

	setup_toolbar_filters() {
		const self = this;

		// Company filter
		this.company_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'company',
				placeholder: __('Company'),
				options: 'Company',
				only_input: true
			},
			parent: this.wrapper.find('[data-fieldname="company"]'),
			render_input: true
		});
		this.company_filter.refresh();
		this.company_filter.set_value(frappe.defaults.get_user_default('Company') || '');
		this.company_filter.$input.on('change', () => {
			this.department_filter?.set_value('');
			this.employee_filter?.set_value('');
			this.refresh();
		});

		// Department filter
		this.department_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'department',
				placeholder: __('Department'),
				options: 'Department',
				only_input: true,
				get_query: () => {
					const company = self.company_filter?.get_value();
					return company ? { filters: { company } } : {};
				}
			},
			parent: this.wrapper.find('[data-fieldname="department"]'),
			render_input: true
		});
		this.department_filter.refresh();
		this.department_filter.$input.on('change', () => {
			this.employee_filter?.set_value('');
			this.refresh();
		});

		// Employee filter
		this.employee_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'employee',
				placeholder: __('Employee'),
				options: 'Employee',
				only_input: true,
				get_query: () => {
					const filters = { status: 'Active' };
					const company = self.company_filter?.get_value();
					const dept = self.department_filter?.get_value();
					if (company) filters.company = company;
					if (dept) filters.department = dept;
					return { filters };
				}
			},
			parent: this.wrapper.find('[data-fieldname="employee"]'),
			render_input: true
		});
		this.employee_filter.refresh();
		this.employee_filter.$input.on('change', () => this.refresh());
	}

	bind_events() {
		const self = this;
		const $table = this.wrapper.find('.roll-call-table');
		const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');

		// Today button
		this.wrapper.find('.btn-today').on('click', () => this.goto_today());

		// Navigation arrows
		this.wrapper.find('.btn-nav-left').on('click', () => this.scroll_by_week(-1));
		this.wrapper.find('.btn-nav-right').on('click', () => this.scroll_by_week(1));

		// Hide weekends checkbox
		this.wrapper.find('.hide-weekends-check').on('change', function() {
			self.hide_weekends = $(this).is(':checked');
			self.render();
		});

		// Show past checkbox
		this.wrapper.find('.show-past-check').on('change', function() {
			self.show_past = $(this).is(':checked');
			if (self.show_past) {
				// Load 30 days into the past immediately
				self.load_past_days();
			}
		});

		// Infinite scroll - detect scroll edges
		this.scroll_handler = this.throttle(() => {
			if (!$tableWrapper.length || this.is_expanding) return;

			const scrollLeft = $tableWrapper[0].scrollLeft;
			const scrollWidth = $tableWrapper[0].scrollWidth;
			const clientWidth = $tableWrapper[0].clientWidth;

			// Check if near right edge - load more future days
			if (scrollWidth - scrollLeft - clientWidth < this.EDGE_THRESHOLD) {
				this.expand_right();
			}

			// Check if near left edge - load more past days (only if show_past is enabled)
			if (this.show_past && scrollLeft < this.EDGE_THRESHOLD) {
				this.expand_left();
			}

			// Update visible date range in header
			this.update_visible_date_range(scrollLeft, clientWidth);
		}, 100);

		$tableWrapper.on('scroll', this.scroll_handler);

		// Click on editable cells
		$table.find('.day-cell.editable').on('click', function(e) {
			const $cell = $(this);

			if ($cell.data('locked')) {
				frappe.show_alert({ message: __('This entry is locked'), indicator: 'orange' });
				return;
			}

			// Ctrl/Cmd+Click or Shift+Click for multi-select
			if (e.ctrlKey || e.metaKey || e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				self.toggle_cell_selection($cell);
				return;
			}

			// Simple click - if we have a selection, clear it first
			if (self.selected_cells.size > 0) {
				self.clear_selection();
				return; // Just clear selection, don't open dialog
			}

			// Open dialog for single cell
			const employee = $cell.data('employee');
			const date = $cell.data('date');
			const emp = self.employees.find(e => e.name === employee);
			self.show_presence_dialog(employee, date, emp?.employee_name || employee);
		});

		// Selection toolbar buttons
		this.wrapper.find('.btn-set-selection').on('click', () => {
			this.show_bulk_presence_dialog();
		});

		this.wrapper.find('.btn-clear-selection').on('click', () => {
			this.clear_selection();
		});

		// Keyboard shortcuts
		$(document).off('keydown.rollcall').on('keydown.rollcall', (e) => {
			if (e.key === 'Escape' && this.selected_cells.size > 0) {
				this.clear_selection();
			}
		});

		// Leave application suggestion buttons
		this.wrapper.find('.btn-create-leave-app').on('click', (e) => {
			const $btn = $(e.currentTarget);
			const presence_type = $btn.data('presence-type');
			const from_date = $btn.data('from-date');
			const to_date = $btn.data('to-date');
			this.create_leave_application(presence_type, from_date, to_date);
		});
	}

	/**
	 * Open Leave Application form with pre-filled data
	 */
	create_leave_application(presence_type, from_date, to_date) {
		// Get the presence type info from our loaded data
		const pt = this.presence_types.find(p => p.name === presence_type);

		if (!pt) {
			frappe.msgprint({
				title: __('Configuration Error'),
				message: __('Presence Type "{0}" not found. Please contact your administrator.', [presence_type]),
				indicator: 'red'
			});
			return;
		}

		if (!pt.leave_type) {
			frappe.msgprint({
				title: __('Configuration Required'),
				message: __('Presence Type "{0}" is not linked to a Leave Type. Please ask HR to configure it in Presence Type settings.', [pt.label || presence_type]),
				indicator: 'orange'
			});
			return;
		}

		if (!this.current_employee) {
			frappe.msgprint({
				title: __('Employee Required'),
				message: __('Your user account is not linked to an Employee record. Please contact HR to set this up.'),
				indicator: 'orange'
			});
			return;
		}

		// Open new Leave Application with pre-filled values
		frappe.new_doc('Leave Application', {
			employee: this.current_employee,
			leave_type: pt.leave_type,
			from_date: from_date,
			to_date: to_date,
			description: __('Created from Roll Call - {0}', [pt.label || presence_type])
		});
	}

	toggle_cell_selection($cell) {
		const key = `${$cell.data('employee')}|${$cell.data('date')}`;

		if ($cell.data('locked')) return;

		if (this.selected_cells.has(key)) {
			this.selected_cells.delete(key);
			$cell.removeClass('selected');
		} else {
			this.selected_cells.add(key);
			$cell.addClass('selected');
		}

		this.update_selection_toolbar();
	}

	clear_selection() {
		this.selected_cells.clear();
		this.wrapper.find('.day-cell.selected').removeClass('selected');
		this.update_selection_toolbar();
	}

	update_selection_toolbar() {
		const $toolbar = this.wrapper.find('.selection-toolbar');
		const count = this.selected_cells.size;

		if (count > 0) {
			$toolbar.show();
			$toolbar.find('.selection-count').text(__(`${count} cell(s) selected`));
		} else {
			$toolbar.hide();
		}
	}

	async show_bulk_presence_dialog() {
		if (this.selected_cells.size === 0) return;

		// For bulk operations, fetch available types for the current user
		// Use today's date as reference for pattern matching
		let available_types = [];
		try {
			const result = await frappe.call({
				method: 'flexitime.flexitime.doctype.presence_type.presence_type.get_available_presence_types',
				args: {
					employee: this.current_employee,
					date: frappe.datetime.get_today()
				}
			});
			available_types = result.message || [];
		} catch (e) {
			console.error('Error loading available presence types:', e);
			// Fallback to all non-system types
			available_types = this.presence_types.filter(t => !t.is_system);
		}

		// Split into quick (show_in_quick_dialog=1) and extended types
		const working_quick = available_types.filter(t => t.category === 'Working' && t.show_in_quick_dialog);
		const working_extended = available_types.filter(t => t.category === 'Working' && !t.show_in_quick_dialog);
		const not_working_quick = available_types.filter(t => t.category === 'Leave' && t.show_in_quick_dialog);
		const not_working_extended = available_types.filter(t => t.category === 'Leave' && !t.show_in_quick_dialog);

		const make_options = (types, prefix = '', extra_class = '') => types.map(pt => `
			<div class="presence-option ${extra_class}" data-type="${pt.name}" data-category="${pt.category}" data-prefix="${prefix}" style="--option-color: ${this.get_color_var(pt.color)}">
				<span class="option-icon">${pt.icon || '•'}</span>
				<span class="option-label">${pt.label}</span>
			</div>
		`).join('');

		const make_show_more_toggle = (category, count) => count > 0 ? `
			<div class="show-more-toggle" data-category="${category}">
				<span class="toggle-icon">+</span>
				<span class="toggle-text">${__('Show more')} (${count})</span>
			</div>
		` : '';

		let is_split_day = false;
		let full_day_type = null;
		let am_type = null;
		let pm_type = null;

		const d = new frappe.ui.Dialog({
			title: __('Set Presence'),
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'content',
					options: `
						<div class="presence-dialog-redesign">
							<!-- Header: Cell count | Split Day checkbox -->
							<div class="presence-dialog-header">
								<div class="header-info">
									<strong>${__("{0} cells selected", [this.selected_cells.size])}</strong>
								</div>
								<div class="header-toggle">
									<label class="split-day-label">
										<input type="checkbox" class="split-day-check">
										<span>${__('Split Day')}</span>
									</label>
								</div>
							</div>

							<!-- Full Day Mode -->
							<div class="full-day-selector">
								<div class="presence-category">
									<div class="category-title">${__('WORKING')}</div>
									<div class="category-options working-options quick-options">
										${make_options(working_quick)}
									</div>
									${make_show_more_toggle('working', working_extended.length)}
									<div class="category-options working-options extended-options" style="display:none">
										${make_options(working_extended, '', 'extended-option')}
									</div>
								</div>
								<div class="category-divider"></div>
								<div class="presence-category">
									<div class="category-title">${__('NOT WORKING')}</div>
									<div class="category-options not-working-options quick-options">
										${make_options(not_working_quick)}
									</div>
									${make_show_more_toggle('not-working', not_working_extended.length)}
									<div class="category-options not-working-options extended-options" style="display:none">
										${make_options(not_working_extended, '', 'extended-option')}
									</div>
								</div>
							</div>

							<!-- Split Day Mode -->
							<div class="split-day-selector" style="display:none">
								<div class="split-warning">
									<span class="warning-icon">⚠️</span>
									<span>${__('Only one half can be Not Working')}</span>
								</div>
								<div class="split-columns">
									<div class="split-column am-column">
										<div class="column-header">${__('AM')}</div>
										<div class="presence-category">
											<div class="category-title-small">${__('WORKING')}</div>
											<div class="category-options am-working-options quick-options">
												${make_options(working_quick, 'am')}
											</div>
											${make_show_more_toggle('am-working', working_extended.length)}
											<div class="category-options am-working-options extended-options" style="display:none">
												${make_options(working_extended, 'am', 'extended-option')}
											</div>
										</div>
										<div class="presence-category">
											<div class="category-title-small">${__('NOT WORKING')}</div>
											<div class="category-options am-not-working-options quick-options">
												${make_options(not_working_quick, 'am')}
											</div>
											${make_show_more_toggle('am-not-working', not_working_extended.length)}
											<div class="category-options am-not-working-options extended-options" style="display:none">
												${make_options(not_working_extended, 'am', 'extended-option')}
											</div>
										</div>
									</div>
									<div class="split-column pm-column">
										<div class="column-header">${__('PM')}</div>
										<div class="presence-category">
											<div class="category-title-small">${__('WORKING')}</div>
											<div class="category-options pm-working-options quick-options">
												${make_options(working_quick, 'pm')}
											</div>
											${make_show_more_toggle('pm-working', working_extended.length)}
											<div class="category-options pm-working-options extended-options" style="display:none">
												${make_options(working_extended, 'pm', 'extended-option')}
											</div>
										</div>
										<div class="presence-category">
											<div class="category-title-small">${__('NOT WORKING')}</div>
											<div class="category-options pm-not-working-options quick-options">
												${make_options(not_working_quick, 'pm')}
											</div>
											${make_show_more_toggle('pm-not-working', not_working_extended.length)}
											<div class="category-options pm-not-working-options extended-options" style="display:none">
												${make_options(not_working_extended, 'pm', 'extended-option')}
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					`
				}
			],
			primary_action_label: __('Apply'),
			primary_action: async () => {
				if (!is_split_day) {
					if (!full_day_type) {
						frappe.show_alert({ message: __('Please select a presence type'), indicator: 'orange' });
						return;
					}
					d.hide();
					await this.save_bulk_entries(full_day_type, 'full');
				} else {
					if (!am_type || !pm_type) {
						frappe.show_alert({ message: __('Please select both AM and PM types'), indicator: 'orange' });
						return;
					}
					d.hide();
					await this.save_bulk_split_entries(am_type, pm_type);
				}
			}
		});

		// Show more toggle handlers
		d.$wrapper.find('.show-more-toggle').on('click', function() {
			const $toggle = $(this);
			const $extended = $toggle.next('.extended-options');
			const is_expanded = $extended.is(':visible');

			if (is_expanded) {
				$extended.slideUp(150);
				$toggle.find('.toggle-icon').text('+');
				$toggle.find('.toggle-text').text(__('Show more') + ` (${$extended.find('.presence-option').length})`);
			} else {
				$extended.slideDown(150);
				$toggle.find('.toggle-icon').text('−');
				$toggle.find('.toggle-text').text(__('Show less'));
			}
		});

		// Split Day checkbox toggle
		d.$wrapper.find('.split-day-check').on('change', function() {
			is_split_day = $(this).is(':checked');
			if (is_split_day) {
				d.$wrapper.find('.full-day-selector').hide();
				d.$wrapper.find('.split-day-selector').show();
			} else {
				d.$wrapper.find('.full-day-selector').show();
				d.$wrapper.find('.split-day-selector').hide();
			}
		});

		// Full day selection
		d.$wrapper.find('.full-day-selector .presence-option').on('click', function() {
			d.$wrapper.find('.full-day-selector .presence-option').removeClass('selected');
			$(this).addClass('selected');
			full_day_type = $(this).data('type');
		});

		// Combine quick and extended not_working for validation
		const all_not_working = [...not_working_quick, ...not_working_extended];

		// Update not-working disabled state for split day
		const updateNotWorkingState = () => {
			const am_is_not_working = am_type && all_not_working.some(t => t.name === am_type);
			const pm_is_not_working = pm_type && all_not_working.some(t => t.name === pm_type);

			// If AM has not-working selected, disable PM not-working options
			d.$wrapper.find('.pm-not-working-options .presence-option').toggleClass('disabled', am_is_not_working);
			// If PM has not-working selected, disable AM not-working options
			d.$wrapper.find('.am-not-working-options .presence-option').toggleClass('disabled', pm_is_not_working);
		};

		// AM selection
		d.$wrapper.find('.am-column .presence-option').on('click', function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.am-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			am_type = $(this).data('type');
			updateNotWorkingState();
		});

		// PM selection
		d.$wrapper.find('.pm-column .presence-option').on('click', function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.pm-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			pm_type = $(this).data('type');
			updateNotWorkingState();
		});

		d.show();
	}

	async show_presence_dialog(employee, date, employee_name) {
		const key = `${employee}|${date}`;
		const existing = this.entries[key];

		// Fetch available presence types for this specific employee and date
		let available_types = [];
		try {
			const result = await frappe.call({
				method: 'flexitime.flexitime.doctype.presence_type.presence_type.get_available_presence_types',
				args: { employee, date }
			});
			available_types = result.message || [];
		} catch (e) {
			console.error('Error loading available presence types:', e);
			// Fallback to all non-system types
			available_types = this.presence_types.filter(t => !t.is_system);
		}

		// Split into quick (show_in_quick_dialog=1) and extended types
		const working_quick = available_types.filter(t => t.category === 'Working' && t.show_in_quick_dialog);
		const working_extended = available_types.filter(t => t.category === 'Working' && !t.show_in_quick_dialog);
		const not_working_quick = available_types.filter(t => t.category === 'Leave' && t.show_in_quick_dialog);
		const not_working_extended = available_types.filter(t => t.category === 'Leave' && !t.show_in_quick_dialog);
		const all_working = [...working_quick, ...working_extended];
		const all_not_working = [...not_working_quick, ...not_working_extended];

		// Format date nicely: "Tue, 9 Dec"
		const date_obj = frappe.datetime.str_to_obj(date);
		const formatted_date = date_obj.toLocaleDateString('en-US', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});

		const make_options = (types, selected_type) => types.map(pt => `
			<div class="presence-option ${selected_type === pt.name ? 'selected' : ''}"
				 data-type="${pt.name}"
				 data-category="${pt.category}"
				 style="--option-color: ${this.get_color_var(pt.color)}">
				<span class="option-icon">${pt.icon || '•'}</span>
				<span class="option-label">${pt.label}</span>
			</div>
		`).join('');

		// Check if existing has split AM/PM
		const has_split = existing?.is_half_day && existing?.am_presence_type && existing?.pm_presence_type;

		let is_split_day = has_split;
		let show_all = false;
		let full_day_type = existing?.presence_type || null;
		let am_type = existing?.am_presence_type || null;
		let pm_type = existing?.pm_presence_type || null;

		// Determine if we need extended types visible initially (if selected type is extended)
		const selected_is_extended = full_day_type && (
			working_extended.some(t => t.name === full_day_type) ||
			not_working_extended.some(t => t.name === full_day_type)
		);
		if (selected_is_extended) show_all = true;

		const d = new frappe.ui.Dialog({
			title: __('Set Presence'),
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'content',
					options: `
						<div class="presence-dialog-compact">
							<!-- Header: Employee + Date | Tabs | Toggle -->
							<div class="dialog-header-row">
								<div class="header-info">
									<strong>${employee_name}</strong>
									<span class="text-muted"> - ${formatted_date}</span>
								</div>
								<div class="header-controls">
									<div class="mode-tabs">
										<button type="button" class="mode-tab ${!is_split_day ? 'active' : ''}" data-mode="full">${__('Full Day')}</button>
										<button type="button" class="mode-tab ${is_split_day ? 'active' : ''}" data-mode="split">${__('Split')}</button>
									</div>
									<label class="show-all-toggle">
										<input type="checkbox" class="show-all-check" ${show_all ? 'checked' : ''}>
										<span class="toggle-switch"></span>
										<span class="toggle-label">${__('All')}</span>
									</label>
								</div>
							</div>

							<!-- Full Day Mode -->
							<div class="full-day-content" ${is_split_day ? 'style="display:none"' : ''}>
								<div class="options-section working-section">
									<div class="options-row quick-options">
										${make_options(working_quick, existing?.presence_type)}
									</div>
									<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
										${make_options(working_extended, existing?.presence_type)}
									</div>
								</div>
								<div class="options-divider"></div>
								<div class="options-section not-working-section">
									<div class="options-row quick-options">
										${make_options(not_working_quick, existing?.presence_type)}
									</div>
									<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
										${make_options(not_working_extended, existing?.presence_type)}
									</div>
								</div>
							</div>

							<!-- Split Day Mode -->
							<div class="split-day-content" ${!is_split_day ? 'style="display:none"' : ''}>
								<div class="split-notice">
									<span>⚠️ ${__('Only one half can be leave')}</span>
								</div>
								<div class="split-columns">
									<div class="split-column am-column">
										<div class="column-label">${__('AM')}</div>
										<div class="options-section working-section">
											<div class="options-row quick-options">
												${make_options(working_quick, existing?.am_presence_type)}
											</div>
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(working_extended, existing?.am_presence_type)}
											</div>
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick, existing?.am_presence_type)}
											</div>
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(not_working_extended, existing?.am_presence_type)}
											</div>
										</div>
									</div>
									<div class="split-column pm-column">
										<div class="column-label">${__('PM')}</div>
										<div class="options-section working-section">
											<div class="options-row quick-options">
												${make_options(working_quick, existing?.pm_presence_type)}
											</div>
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(working_extended, existing?.pm_presence_type)}
											</div>
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick, existing?.pm_presence_type)}
											</div>
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(not_working_extended, existing?.pm_presence_type)}
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					`
				}
			],
			primary_action_label: __('Save'),
			primary_action: async () => {
				if (!is_split_day) {
					if (!full_day_type) {
						frappe.show_alert({ message: __('Please select a presence type'), indicator: 'orange' });
						return;
					}
					d.hide();
					await this.save_entry(employee, date, full_day_type, false);
				} else {
					if (!am_type || !pm_type) {
						frappe.show_alert({ message: __('Please select both AM and PM types'), indicator: 'orange' });
						return;
					}
					d.hide();
					await this.save_split_entry(employee, date, am_type, pm_type);
				}
			},
			secondary_action_label: existing ? __('Clear') : null,
			secondary_action: existing ? async () => {
				d.hide();
				await this.delete_entry(employee, date);
			} : null
		});

		// Tab switching
		d.$wrapper.find('.mode-tab').on('click', function() {
			const mode = $(this).data('mode');
			d.$wrapper.find('.mode-tab').removeClass('active');
			$(this).addClass('active');

			is_split_day = mode === 'split';
			if (is_split_day) {
				d.$wrapper.find('.full-day-content').hide();
				d.$wrapper.find('.split-day-content').show();
			} else {
				d.$wrapper.find('.full-day-content').show();
				d.$wrapper.find('.split-day-content').hide();
			}
		});

		// Show All toggle
		d.$wrapper.find('.show-all-check').on('change', function() {
			show_all = $(this).is(':checked');
			if (show_all) {
				d.$wrapper.find('.extended-options').slideDown(150);
			} else {
				d.$wrapper.find('.extended-options').slideUp(150);
			}
		});

		// Full day selection
		d.$wrapper.find('.full-day-content .presence-option').on('click', function() {
			d.$wrapper.find('.full-day-content .presence-option').removeClass('selected');
			$(this).addClass('selected');
			full_day_type = $(this).data('type');
		});

		// Update not-working disabled state for split day
		const updateNotWorkingState = () => {
			const am_is_not_working = am_type && all_not_working.some(t => t.name === am_type);
			const pm_is_not_working = pm_type && all_not_working.some(t => t.name === pm_type);

			// If AM has not-working selected, disable PM not-working options
			d.$wrapper.find('.pm-column .not-working-section .presence-option').toggleClass('disabled', am_is_not_working);
			// If PM has not-working selected, disable AM not-working options
			d.$wrapper.find('.am-column .not-working-section .presence-option').toggleClass('disabled', pm_is_not_working);
		};

		// AM selection
		d.$wrapper.find('.am-column .presence-option').on('click', function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.am-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			am_type = $(this).data('type');
			updateNotWorkingState();
		});

		// PM selection
		d.$wrapper.find('.pm-column .presence-option').on('click', function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.pm-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			pm_type = $(this).data('type');
			updateNotWorkingState();
		});

		// Initial state update
		updateNotWorkingState();

		d.show();
	}

	async save_entry(employee, date, presence_type, is_half_day = false) {
		try {
			await frappe.call({
				method: 'flexitime.api.roll_call.save_entry',
				args: { employee, date, presence_type, is_half_day }
			});
			frappe.show_alert({ message: __('Saved'), indicator: 'green' });
			await this.refresh();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	async save_split_entry(employee, date, am_type, pm_type) {
		try {
			await frappe.call({
				method: 'flexitime.api.roll_call.save_split_entry',
				args: { employee, date, am_presence_type: am_type, pm_presence_type: pm_type }
			});
			frappe.show_alert({ message: __('Saved'), indicator: 'green' });
			await this.refresh();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	async save_bulk_entries(presence_type, day_part) {
		try {
			const entries = Array.from(this.selected_cells).map(key => {
				const [employee, date] = key.split('|');
				return { employee, date };
			});

			await frappe.call({
				method: 'flexitime.api.roll_call.save_bulk_entries',
				args: { entries, presence_type, day_part }
			});

			frappe.show_alert({ message: __('Saved {0} entries', [entries.length]), indicator: 'green' });
			this.clear_selection();
			await this.refresh();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	async save_bulk_split_entries(am_type, pm_type) {
		try {
			const entries = Array.from(this.selected_cells).map(key => {
				const [employee, date] = key.split('|');
				return { employee, date };
			});

			await frappe.call({
				method: 'flexitime.api.roll_call.save_bulk_split_entries',
				args: { entries, am_presence_type: am_type, pm_presence_type: pm_type }
			});

			frappe.show_alert({ message: __('Saved {0} entries', [entries.length]), indicator: 'green' });
			this.clear_selection();
			await this.refresh();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	async delete_entry(employee, date) {
		try {
			const key = `${employee}|${date}`;
			const entry = this.entries[key];
			if (entry) {
				await frappe.call({
					method: 'frappe.client.delete',
					args: { doctype: 'Roll Call Entry', name: entry.name }
				});
				frappe.show_alert({ message: __('Cleared'), indicator: 'green' });
				await this.refresh();
			}
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	// Throttle utility
	throttle(func, wait) {
		let timeout = null;
		let lastArgs = null;

		return function(...args) {
			lastArgs = args;
			if (!timeout) {
				timeout = setTimeout(() => {
					func.apply(this, lastArgs);
					timeout = null;
				}, wait);
			}
		}.bind(this);
	}

	update_visible_date_range(scrollLeft, clientWidth) {
		const all_days = this.get_days_in_range();
		const visible_days = all_days.filter(d => !this.hide_weekends || !d.is_weekend);

		if (visible_days.length === 0) return;

		// Calculate first and last visible column indices
		const adjusted_scroll = Math.max(0, scrollLeft);
		const first_idx = Math.floor(adjusted_scroll / this.COLUMN_WIDTH);
		const visible_cols = Math.ceil(clientWidth / this.COLUMN_WIDTH);
		const last_idx = Math.min(first_idx + visible_cols, visible_days.length - 1);

		const first_visible = visible_days[Math.min(first_idx, visible_days.length - 1)];
		const last_visible = visible_days[last_idx];

		if (first_visible && last_visible) {
			this.visible_start_date = first_visible.date;
			this.visible_end_date = last_visible.date;

			// Update header display
			this.wrapper.find('.visible-date-range').text(this.getVisibleDateRange());
		}
	}

	async expand_right() {
		if (this.is_expanding) return;
		this.is_expanding = true;

		// Expand by adding more days to the end
		this.total_days += this.EXPAND_BY;

		// Reload data for the new range
		await this.load_data();
		this.render();

		this.is_expanding = false;
	}

	async expand_left() {
		if (this.is_expanding) return;
		this.is_expanding = true;

		const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
		const old_scroll = $tableWrapper.length ? $tableWrapper[0].scrollLeft : 0;

		// Move start date back
		const start = frappe.datetime.str_to_obj(this.start_date);
		start.setDate(start.getDate() - this.EXPAND_BY);
		this.start_date = frappe.datetime.obj_to_str(start);
		this.total_days += this.EXPAND_BY;

		// Reload data for the new range
		await this.load_data();
		this.render();

		// Restore scroll position - scroll right by the number of columns we added
		// to maintain the same visual position
		const new_wrapper = this.wrapper.find('.roll-call-table-wrapper');
		if (new_wrapper.length) {
			const added_cols = this.EXPAND_BY * (this.hide_weekends ? 5/7 : 1); // approximate
			new_wrapper[0].scrollLeft = old_scroll + (added_cols * this.COLUMN_WIDTH);
		}

		this.is_expanding = false;
	}

	async load_past_days() {
		// Initial load of past days when "Show Past" is enabled
		if (this.is_expanding) return;
		this.is_expanding = true;

		// Move start date back by 30 days
		const start = frappe.datetime.str_to_obj(this.start_date);
		start.setDate(start.getDate() - this.EXPAND_BY);
		this.start_date = frappe.datetime.obj_to_str(start);
		this.total_days += this.EXPAND_BY;

		// Reload data
		await this.load_data();
		this.render();

		// Scroll to show "today" - find its column index
		this.scroll_to_today();

		this.is_expanding = false;
	}

	scroll_to_today() {
		setTimeout(() => {
			const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
			if (!$tableWrapper.length) return;

			const today = frappe.datetime.get_today();
			const all_days = this.get_days_in_range();

			// Find today's index in visible days
			let col_index = 0;
			let prev_visible = null;

			for (let i = 0; i < all_days.length; i++) {
				const d = all_days[i];
				if (this.hide_weekends && d.is_weekend) continue;

				// Count separator columns
				if (!this.hide_weekends && i > 0 && all_days[i-1]?.is_sunday) {
					col_index++;
				} else if (this.hide_weekends && d.is_monday && prev_visible?.is_friday) {
					col_index++;
				}

				if (d.date === today) {
					// Scroll to put today a few columns from the left edge
					const scroll_pos = Math.max(0, (col_index - 2) * this.COLUMN_WIDTH);
					$tableWrapper[0].scrollLeft = scroll_pos;
					return;
				}

				col_index++;
				prev_visible = d;
			}
		}, 100);
	}

	scroll_by_week(direction) {
		// Scroll the table by approximately 1 week (7 days worth of columns)
		const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
		if (!$tableWrapper.length) return;

		// Calculate scroll amount: 7 days worth of columns (or 5 if hiding weekends)
		const days_to_scroll = this.hide_weekends ? 5 : 7;
		const scroll_amount = days_to_scroll * this.COLUMN_WIDTH;

		const current_scroll = $tableWrapper[0].scrollLeft;
		const new_scroll = current_scroll + (scroll_amount * direction);

		// Smooth scroll
		$tableWrapper[0].scrollTo({
			left: Math.max(0, new_scroll),
			behavior: 'smooth'
		});
	}

	goto_today() {
		// Reset to initial state - today + 60 days
		this.start_date = frappe.datetime.get_today();
		this.total_days = this.INITIAL_DAYS;
		this.visible_start_date = '';
		this.visible_end_date = '';
		this.show_past = false;  // Also reset show_past
		this.refresh();

		// Scroll to start
		setTimeout(() => {
			const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
			if ($tableWrapper.length) {
				$tableWrapper[0].scrollLeft = 0;
			}
		}, 100);
	}

	async refresh() {
		// Show loading indicator only in table area (not full page)
		const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
		if ($tableWrapper.length) {
			// Quick refresh - just reload data and re-render
			$tableWrapper.css('opacity', '0.5');
			await this.load_data();
			this.render();
		} else {
			// Initial load
			this.wrapper.html(`<div class="roll-call-loading text-muted">${__('Loading...')}</div>`);
			await this.load_data();
			this.render();
		}
	}
}
