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
		this.MAX_TOTAL_DAYS = 180;  // ~6 months max to prevent unbounded growth
		this.total_days = this.INITIAL_DAYS;

		this.presence_types = [];
		this.presence_types_map = new Map();  // O(1) lookup cache
		this.entries = {};
		this.pending_leaves = {};  // Open leave applications not yet approved
		this.employees = [];
		this.employees_map = new Map();  // O(1) lookup cache
		this.is_hr_manager = frappe.user_roles.includes('HR Manager');
		this.current_employee = null;
		this.show_weekends = false;  // Default to hiding weekends

		// Filter controls (populated in setup_toolbar_filters)
		this.company_filter = null;
		this.department_filter = null;
		this.employee_filter = null;

		// Multi-selection state
		this.selected_cells = new Set();
		this.is_selecting = false;

		// Drag-to-select state
		this.is_dragging = false;
		this.drag_start_cell = null;  // {employee, date, row_idx, col_idx}
		this.drag_current_cell = null;

		// Clipboard for copy/paste (multi-cell pattern support)
		// Format: { pattern: [{row_offset, col_offset, data: {type, presence_type?, am_type?, pm_type?}}], rows: n, cols: n }
		this.clipboard = null;

		// Keyboard focus
		this.focused_cell = null;  // {employee, date}

		// Inline dropdown state (legacy - kept for dialogs)
		this.active_dropdown = null;

		// ========================================
		// PALETTE BAR STATE
		// ========================================
		this.palette_mode = 'none';          // 'none' | 'split' (no paint/clear modes - selection first)
		this.split_am_type = null;           // Selected AM type in split mode
		this.split_pm_type = null;           // Selected PM type in split mode
		this.pending_saves = new Map();      // Batched saves: key -> entry data
		this.save_timeout = null;            // Debounce timer for batch save
		this.is_flushing = false;            // Mutex to prevent concurrent flushes

		// Infinite scroll state
		this.is_expanding = false;
		this.visible_start_date = '';
		this.visible_end_date = '';

		// Constants for scroll detection
		this.EDGE_THRESHOLD = 400; // pixels from edge to trigger load (increased for reliability)
		this.COLUMN_WIDTH = 44; // min-width of day columns
		this.EMPLOYEE_COLUMN_WIDTH = 180; // min-width of employee column

		// Filter debounce timer
		this._filter_debounce_timer = null;

		// Leave suggestions optimization
		this._suggestions_dirty = true;
		this._suggestions_cache = null;
		this._suggestion_update_timer = null;

		// Cell element cache for O(1) DOM lookups
		this.cell_element_map = new Map();  // "employee|date" -> DOM element

		// Undo stack for reverting operations
		// Format: [{ action: 'apply'|'paste'|'delete'|'split', entries: [{employee, date, previous_state}] }]
		this.undo_stack = [];
		this.MAX_UNDO_STACK = 20;  // Limit memory usage

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
			// Silently handle - non-employee users won't have an employee record
		}

		// Load Flexitime Settings for roll_call_start_day
		await this.load_settings();

		// Load presence types
		await this.load_presence_types();

		// Render
		await this.refresh();
	}

	async load_settings() {
		try {
			const result = await frappe.call({
				method: 'frappe.client.get_value',
				args: {
					doctype: 'Flexitime Settings',
					fieldname: ['roll_call_start_day', 'roll_call_display_name']
				}
			});
			const start_day_setting = result.message?.roll_call_start_day || 'Today';
			this.display_name_format = result.message?.roll_call_display_name || 'Full Name';

			if (start_day_setting === 'Start of Week') {
				// Get Monday of current week
				this.start_date = this.get_start_of_week(frappe.datetime.get_today());
			} else {
				// Default: Today
				this.start_date = frappe.datetime.get_today();
			}
		} catch (e) {
			// Use defaults if settings not found
			this.start_date = frappe.datetime.get_today();
			this.display_name_format = 'Full Name';
		}
	}

	/**
	 * Format employee display name based on settings
	 * @param {Object} employee - Employee object with employee_name and nickname
	 * @returns {string} Formatted display name
	 */
	format_display_name(employee) {
		const full_name = employee.employee_name || employee.name;
		const nickname = employee.nickname || '';

		switch (this.display_name_format) {
			case 'Nickname':
				return nickname || full_name;
			case 'Nickname (Full Name)':
				return nickname ? `${nickname} (${full_name})` : full_name;
			case 'Full Name (Nickname)':
				return nickname ? `${full_name} (${nickname})` : full_name;
			default: // 'Full Name'
				return full_name;
		}
	}

	get_start_of_week(date_str) {
		// Returns Monday of the week containing the given date
		const date = frappe.datetime.str_to_obj(date_str);
		const day_of_week = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
		const days_since_monday = day_of_week === 0 ? 6 : day_of_week - 1;
		const monday = new Date(date);
		monday.setDate(date.getDate() - days_since_monday);
		return frappe.datetime.obj_to_str(monday);
	}

	async load_presence_types() {
		try {
			const result = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Presence Type',
					fields: ['name', 'label', 'icon', 'category', 'color', 'is_system', 'requires_leave_application', 'leave_type', 'show_in_quick_dialog', 'available_to_all'],
					filters: {},
					order_by: 'sort_order asc',
					limit_page_length: 0
				}
			});
			this.presence_types = result.message || [];
			// Build O(1) lookup map
			this.presence_types_map.clear();
			this.presence_types.forEach(pt => this.presence_types_map.set(pt.name, pt));
		} catch (e) {
			// Use empty defaults on error
			this.presence_types = [];
			this.presence_types_map.clear();
		}
	}

	/**
	 * Get available presence types for dialog - uses cached data for speed
	 * For bulk operations (no specific employee)
	 */
	get_dialog_presence_types(employee = null) {
		// If employee specified, get their specific types; otherwise return available_to_all
		if (employee) {
			// Return all non-system types - will be filtered by employee permissions
			return this.presence_types.filter(t => !t.is_system);
		}
		// For cross-employee bulk operations, only show available_to_all types
		return this.presence_types.filter(t => !t.is_system && t.available_to_all);
	}

	/**
	 * Get available presence types for a specific employee
	 * Calls API to check employee-specific permissions from Employee Presence Settings
	 */
	async get_employee_presence_types(employee, date) {
		try {
			const result = await frappe.call({
				method: 'flexitime.flexitime.doctype.presence_type.presence_type.get_available_presence_types',
				args: { employee, date }
			});
			return result.message || [];
		} catch (e) {
			// Fallback to cached available_to_all types
			return this.get_dialog_presence_types();
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

	/**
	 * Get pending leave application for an employee on a specific date
	 * @param {string} employee - Employee ID
	 * @param {string} date - Date string (YYYY-MM-DD)
	 * @returns {object|null} First pending leave info or null
	 */
	get_pending_leave(employee, date) {
		const emp_pending = this.pending_leaves[employee];
		if (!emp_pending) return null;
		const date_pending = emp_pending[date];
		if (!date_pending || !date_pending.length) return null;
		// Return the first pending leave (most cases will have just one)
		return date_pending[0];
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
						fields: ['name', 'employee_name', 'nickname', 'image'],
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
			// Build O(1) lookup map for employees
			this.employees_map.clear();
			this.employees.forEach(emp => this.employees_map.set(emp.name, emp));

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

			// Store pending leave applications (not yet approved)
			// Structure: { employee: { date: [leave_info, ...] } }
			this.pending_leaves = events_data.pending_leaves || {};

		} catch (e) {
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
			if (!this.show_weekends && day.is_weekend) continue;

			// Add separator column:
			// - When showing weekends: after Sunday (before Monday)
			// - When hiding weekends: after Friday (before Monday) - but we need to detect this
			if (this.show_weekends && i > 0 && days[i-1]?.is_sunday) {
				count++; // separator column
			}
			if (!this.show_weekends && day.is_monday && i > 0) {
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
			if (!this.show_weekends && d.is_weekend) continue;

			// Count separator columns
			if (this.show_weekends && i > 0 && days[i-1]?.is_sunday) {
				count++;
			} else if (!this.show_weekends && d.is_monday && prev_visible_day?.is_friday) {
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

		// Get leave notice counts for badges
		const suggestions = this.detect_leave_suggestions();
		const open_apps = this.detect_open_leave_applications();
		const needed_count = suggestions.length;
		const open_count = open_apps.length;

		let html = `
			<div class="roll-call-container">
				<!-- Compact Toolbar (Single Row) -->
				<div class="roll-call-toolbar compact">
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

						<!-- Right side: Filters dropdown, Leave badges, Hide Weekends -->
						<div class="toolbar-right">
							<!-- Filters Dropdown -->
							<div class="dropdown filters-dropdown">
								<button class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown" data-boundary="viewport" data-display="static">
									${frappe.utils.icon('filter', 'sm')}
									<span class="filter-label">${__('Filters')}</span>
								</button>
								<div class="dropdown-menu dropdown-menu-right filters-dropdown-menu">
									<div class="filter-field" data-fieldname="company"></div>
									<div class="filter-field" data-fieldname="department"></div>
									<div class="filter-field" data-fieldname="employee"></div>
								</div>
							</div>

							<!-- Leave Notice Badges -->
							${needed_count > 0 ? `
							<span class="leave-badge leave-badge-needed" role="button" tabindex="0" title="${__('Leave Applications Needed')}">
								${frappe.utils.icon('triangle-alert', 'xs')}
								<span class="badge-count">${needed_count}</span>
							</span>
							` : ''}
							${open_count > 0 ? `
							<span class="leave-badge leave-badge-open" role="button" tabindex="0" title="${__('Open Leave Applications')}">
								${frappe.utils.icon('clock', 'xs')}
								<span class="badge-count">${open_count}</span>
							</span>
							` : ''}

							<!-- Show Weekends Toggle -->
							<label class="weekend-toggle" title="${__('Show Weekends')}">
								<input type="checkbox" class="show-weekends-check" ${this.show_weekends ? 'checked' : ''}>
								<span class="toggle-text">${__('Show Weekends')}</span>
							</label>
						</div>
					</div>
				</div>

				<!-- Palette Bar (click to select type, then click/drag cells to paint) -->
				${this.render_palette()}

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
			</div>
		`;

		this.wrapper.html(html);
		this.setup_toolbar_filters();
		this.bind_events();
		this.bind_palette_events();
		// Build element map for O(1) cell lookups
		requestAnimationFrame(() => this.build_element_map());
	}

	render_day_headers(days) {
		let html = '';
		let prev_visible_day = null;
		const today = frappe.datetime.get_today();

		for (let i = 0; i < days.length; i++) {
			const d = days[i];

			// Skip weekends when hidden
			if (!this.show_weekends && d.is_weekend) continue;

			// Add separator column
			if (this.show_weekends && i > 0 && days[i-1]?.is_sunday) {
				// Showing weekends: separator after Sunday
				html += `<th class="weekend-separator"></th>`;
			} else if (!this.show_weekends && d.is_monday && prev_visible_day?.is_friday) {
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
		const display_name = this.format_display_name(emp);
		const avatar = emp.image
			? `<img src="${emp.image}" class="avatar-img">`
			: `<span class="avatar-letter">${(emp.nickname || emp.employee_name).charAt(0).toUpperCase()}</span>`;

		let cells = '';
		let prev_visible_day = null;

		for (let i = 0; i < days.length; i++) {
			const d = days[i];

			// Skip weekends when hidden
			if (!this.show_weekends && d.is_weekend) continue;

			// Add separator column
			if (this.show_weekends && i > 0 && days[i-1]?.is_sunday) {
				cells += `<td class="weekend-separator"></td>`;
			} else if (!this.show_weekends && d.is_monday && prev_visible_day?.is_friday) {
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
						<span class="employee-name">${display_name}</span>
					</div>
				</td>
				${cells}
			</tr>
		`;
	}

	render_day_cell(emp, day) {
		const key = `${emp.name}|${day.date}`;
		const entry = this.entries[key];
		// Check for pending (open) leave applications
		const pending_leave = this.get_pending_leave(emp.name, day.date);

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
			const pt = this.presence_types_map.get(entry.presence_type);

			// Check if it's a split half-day entry
			if (entry.is_half_day && entry.am_presence_type && entry.pm_presence_type) {
				// Split cell - show AM/PM separately
				const am_pt = this.presence_types_map.get(entry.am_presence_type);
				const pm_pt = this.presence_types_map.get(entry.pm_presence_type);
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
							<span class="presence-icon">${am_pt?.icon || '•'}</span>
						</div>
						<div class="split-pm ${pm_leave_class}" style="--presence-color: ${this.get_color_var(pm_pt?.color)}"
							 title="${pm_tooltip}">
							<span class="presence-icon">${pm_pt?.icon || '•'}</span>
						</div>
					</div>
				`;
			} else {
				// Single entry (full day or legacy half day)
				const presence_color = this.get_color_var(pt?.color);
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

				// Build tooltip with status info
				let tooltip = entry.presence_type;
				if (entry.is_half_day) tooltip += ' (½)';
				if (leave_status === 'tentative') tooltip += ' - ' + __('No leave application');
				if (leave_status === 'draft') tooltip += ' - ' + __('Pending approval');

				content = `
					<div class="presence-cell" title="${tooltip}">
						<span class="presence-icon">${pt?.icon || '•'}</span>
						${entry.is_locked ? '<span class="locked-badge">🔒</span>' : ''}
					</div>
				`;
			}
		} else if (pending_leave) {
			// No Roll Call Entry but there's a pending leave application
			// Show with striped pattern (draft status)
			cell_style = `--presence-color: ${this.get_color_var(pending_leave.color)};`;
			classes.push('has-entry', 'leave-draft');

			const tooltip = `${pending_leave.label || pending_leave.leave_type} - ${__('Pending approval')}`;

			content = `
				<div class="presence-cell" title="${tooltip}">
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
	 * Update a single cell without re-rendering the entire table
	 * @param {string} employee - Employee ID
	 * @param {string} date - Date string
	 * @param {object} entry_data - The entry data returned from save API
	 */
	update_cell(employee, date, entry_data) {
		const $cell = this.get_cell_element(employee, date);
		if (!$cell || !$cell.length) return;

		// Update our entries cache
		const key = `${employee}|${date}`;
		this.entries[key] = entry_data;

		// Get presence type info
		const pt = this.presence_types_map.get(entry_data.presence_type);
		const emp = this.employees_map.get(employee);
		const is_own = employee === this.current_employee;
		const can_edit = this.is_hr_manager || is_own;
		const today = frappe.datetime.get_today();

		// Build new classes
		const classes = ['day-cell'];
		if (date === today) classes.push('today');
		if (can_edit) classes.push('editable');

		let cell_style = '';
		let content = '';

		if (entry_data.is_half_day && entry_data.am_presence_type && entry_data.pm_presence_type) {
			// Split cell
			const am_pt = this.presence_types_map.get(entry_data.am_presence_type);
			const pm_pt = this.presence_types_map.get(entry_data.pm_presence_type);
			classes.push('has-entry', 'split-day');

			const am_leave_status = entry_data.am_leave_status || 'none';
			const pm_leave_status = entry_data.pm_leave_status || 'none';
			const am_leave_class = am_leave_status === 'tentative' ? 'leave-tentative' :
			                       am_leave_status === 'draft' ? 'leave-draft' : '';
			const pm_leave_class = pm_leave_status === 'tentative' ? 'leave-tentative' :
			                       pm_leave_status === 'draft' ? 'leave-draft' : '';

			content = `
				<div class="split-cell">
					<div class="split-am ${am_leave_class}" style="--presence-color: ${this.get_color_var(am_pt?.color)}"
						 title="${entry_data.am_presence_type}">
						<span class="presence-icon">${am_pt?.icon || '•'}</span>
					</div>
					<div class="split-pm ${pm_leave_class}" style="--presence-color: ${this.get_color_var(pm_pt?.color)}"
						 title="${entry_data.pm_presence_type}">
						<span class="presence-icon">${pm_pt?.icon || '•'}</span>
					</div>
				</div>
			`;
		} else {
			// Full day entry
			cell_style = `--presence-color: ${this.get_color_var(pt?.color)};`;
			classes.push('has-entry');

			const leave_status = entry_data.leave_status || 'none';
			if (leave_status === 'tentative') {
				classes.push('leave-tentative');
			} else if (leave_status === 'draft') {
				classes.push('leave-draft');
			}

			let tooltip = entry_data.presence_type;
			if (entry_data.is_half_day) tooltip += ' (½)';

			content = `
				<div class="presence-cell" title="${tooltip}">
					<span class="presence-icon">${pt?.icon || '•'}</span>
					${entry_data.is_locked ? '<span class="locked-badge">🔒</span>' : ''}
				</div>
			`;
		}

		// Update the cell
		$cell.attr('class', classes.join(' '));
		$cell.attr('style', cell_style);
		$cell.attr('data-leave-status', entry_data.leave_status || '');
		if (entry_data.is_locked) {
			$cell.attr('data-locked', '1');
		} else {
			$cell.removeAttr('data-locked');
		}
		$cell.html(content);

		// Mark suggestions as dirty and schedule update if this is current user's cell
		if (employee === this.current_employee) {
			this._suggestions_dirty = true;
			this.schedule_suggestion_update();
		}
	}

	/**
	 * Schedule a debounced update to the suggestions banner.
	 * This prevents excessive recalculations when making rapid changes.
	 */
	schedule_suggestion_update() {
		if (this._suggestion_update_timer) {
			clearTimeout(this._suggestion_update_timer);
		}
		this._suggestion_update_timer = setTimeout(() => {
			this.update_suggestions_banner();
		}, 100); // 100ms debounce
	}

	/**
	 * Update only the suggestions banner without full page re-render.
	 * Now also updates the compact toolbar badges and panel.
	 */
	update_suggestions_banner() {
		if (!this._suggestions_dirty) return;

		const suggestions = this.detect_leave_suggestions();
		const open_apps = this.detect_open_leave_applications();

		// Update compact toolbar badges
		const $neededBadge = this.wrapper.find('.leave-badge-needed');
		const $openBadge = this.wrapper.find('.leave-badge-open');

		if (suggestions.length > 0) {
			if ($neededBadge.length) {
				$neededBadge.find('.badge-count').text(suggestions.length);
				$neededBadge.show();
			}
		} else {
			$neededBadge.hide();
		}

		if (open_apps.length > 0) {
			if ($openBadge.length) {
				$openBadge.find('.badge-count').text(open_apps.length);
				$openBadge.show();
			}
		} else {
			$openBadge.hide();
		}

		// Update the expandable panel content
		const $panel = this.wrapper.find('.leave-suggestions-panel');
		if ($panel.length) {
			$panel.html(this.render_leave_suggestions_content());
		}

		// Also update legacy banner if it exists
		const $existingBanner = this.wrapper.find('.leave-suggestions-banner');
		if ($existingBanner.length) {
			if (suggestions.length > 0) {
				const html = this.render_suggestions_html(suggestions);
				$existingBanner.replaceWith(html);
			} else {
				$existingBanner.remove();
			}
		}

		this.bind_suggestion_events();
		this._suggestions_dirty = false;
	}

	/**
	 * Bind click events for suggestion buttons and collapse toggle.
	 * Called after suggestions banner is updated.
	 */
	bind_suggestion_events() {
		const self = this;

		// Create leave application buttons
		// Use attr() instead of data() to get the raw attribute values
		this.wrapper.find('.btn-create-leave-app').off('click').on('click', function(e) {
			e.stopPropagation(); // Prevent triggering header collapse
			const $btn = $(this);
			const presence_type = $btn.attr('data-presence-type');
			const from_date = $btn.attr('data-from-date');
			const to_date = $btn.attr('data-to-date');

			self.create_leave_application(presence_type, from_date, to_date);
		});

		// View leave application buttons (for open/pending apps)
		this.wrapper.find('.btn-view-leave-app').off('click').on('click', function(e) {
			e.stopPropagation();
			const leave_app = $(this).attr('data-leave-app');
			frappe.set_route('Form', 'Leave Application', leave_app);
		});

		// Collapse/expand toggle
		this.wrapper.find('.suggestions-header').off('click').on('click', function(e) {
			e.preventDefault();
			e.stopPropagation();

			const $banner = $(this).closest('.leave-suggestions-banner');
			const isCollapsed = $banner.hasClass('collapsed');

			// Toggle state
			$banner.toggleClass('collapsed');
			self.set_suggestions_collapsed_state(!isCollapsed);

			// Update icon
			$banner.find('.collapse-icon').text(isCollapsed ? '▲' : '▼');
		});
	}

	/**
	 * Get collapsed state for suggestions banner from localStorage.
	 * Default: collapsed when more than 3 items.
	 */
	get_suggestions_collapsed_state(count) {
		const stored = localStorage.getItem('roll_call_suggestions_collapsed');
		if (stored !== null) {
			return stored === 'true';
		}
		// Default: collapsed when more than 3 items
		return count > 3;
	}

	/**
	 * Set collapsed state for suggestions banner in localStorage.
	 */
	set_suggestions_collapsed_state(collapsed) {
		localStorage.setItem('roll_call_suggestions_collapsed', collapsed ? 'true' : 'false');
	}

	/**
	 * Render suggestions HTML with collapsible banner and button-first layout.
	 */
	render_suggestions_html(suggestions) {
		const count = suggestions.length;
		const isCollapsed = this.get_suggestions_collapsed_state(count);

		const items = suggestions.map(s => {
			// Format dates with weekdays
			const from_date = frappe.datetime.str_to_obj(s.from_date);
			const to_date = frappe.datetime.str_to_obj(s.to_date);
			const from_fmt = from_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			const to_fmt = to_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			const date_range = s.days === 1 ? from_fmt : `${from_fmt} - ${to_fmt}`;

			return `
				<div class="leave-suggestion-item">
					<button class="btn btn-xs btn-default btn-create-leave-app"
						data-presence-type="${s.presence_type}"
						data-from-date="${s.from_date}"
						data-to-date="${s.to_date}">
						${__("Create")}
					</button>
					<span class="suggestion-text">
						${s.days} ${__("day(s)")} ${s.presence_type_label}
						<span class="text-muted">(${date_range})</span>
					</span>
				</div>
			`;
		}).join('');

		return `
			<div class="leave-suggestions-banner ${isCollapsed ? 'collapsed' : ''}">
				<div class="suggestions-header" role="button">
					${frappe.utils.icon('triangle-alert', 'sm')}
					<span>${count} ${__("Leave Application(s) Needed")}</span>
					<span class="collapse-icon">${isCollapsed ? '▼' : '▲'}</span>
				</div>
				<div class="suggestions-list">
					${items}
				</div>
			</div>
		`;
	}

	/**
	 * Detect consecutive tentative days for the current user that require leave applications.
	 * Returns array of suggestions like:
	 * [{ presence_type: "Vacation", from_date: "2025-12-03", to_date: "2025-12-05", days: 3 }]
	 *
	 * Optimized to iterate only relevant entries instead of all days.
	 */
	detect_leave_suggestions() {
		if (!this.current_employee) {
			return [];
		}

		// Build set of presence types that require leave applications (using cached map)
		const approval_type_names = new Set();
		for (const [name, pt] of this.presence_types_map) {
			if (pt.requires_leave_application && !pt.is_system) {
				approval_type_names.add(name);
			}
		}

		if (approval_type_names.size === 0) {
			return [];
		}

		// Extract only relevant entries for current employee with tentative status
		const tentative_entries = [];
		const prefix = `${this.current_employee}|`;

		for (const [key, entry] of Object.entries(this.entries)) {
			if (!key.startsWith(prefix)) continue;
			if (entry.leave_status !== 'tentative') continue;
			if (!approval_type_names.has(entry.presence_type)) continue;

			const date = key.slice(prefix.length);
			tentative_entries.push({ date, entry });
		}

		// If no tentative entries, return empty
		if (tentative_entries.length === 0) {
			return [];
		}

		// Sort by date
		tentative_entries.sort((a, b) => a.date.localeCompare(b.date));

		// Group consecutive dates by presence type
		const suggestions = [];
		let current_run = null;

		for (const { date, entry } of tentative_entries) {
			// Check if this is consecutive to previous day (accounting for weekends)
			const is_consecutive = current_run &&
				current_run.presence_type === entry.presence_type &&
				this.is_consecutive_workday(current_run.to_date, date);

			if (is_consecutive) {
				// Continue current run
				current_run.to_date = date;
				current_run.days++;
			} else {
				// Start new run (save previous if exists)
				if (current_run) {
					suggestions.push(current_run);
				}
				current_run = {
					presence_type: entry.presence_type,
					presence_type_label: entry.presence_type_label || entry.presence_type,
					from_date: date,
					to_date: date,
					days: 1
				};
			}
		}

		// Don't forget the last run
		if (current_run) {
			suggestions.push(current_run);
		}

		return suggestions;
	}

	/**
	 * Check if date2 is the next workday after date1 (skipping weekends).
	 */
	is_consecutive_workday(date1, date2) {
		const d1 = new Date(date1);
		const d2 = new Date(date2);

		// Move d1 forward by 1 day
		d1.setDate(d1.getDate() + 1);

		// Skip weekends
		while (d1.getDay() === 0 || d1.getDay() === 6) {
			d1.setDate(d1.getDate() + 1);
		}

		// Compare dates
		return d1.toISOString().slice(0, 10) === date2;
	}

	render_leave_suggestions() {
		const suggestions = this.detect_leave_suggestions();
		const open_apps = this.detect_open_leave_applications();

		let html = '';

		// Render "Leave Applications Needed" (tentative entries needing leave apps)
		if (suggestions.length > 0) {
			html += this.render_suggestions_html(suggestions);
		}

		// Render "Open Leave Applications" (pending approval)
		if (open_apps.length > 0) {
			html += this.render_open_applications_html(open_apps);
		}

		return html;
	}

	/**
	 * Render leave suggestions content for the compact panel
	 * This version doesn't include the collapsible banner wrappers
	 */
	render_leave_suggestions_content() {
		const suggestions = this.detect_leave_suggestions();
		const open_apps = this.detect_open_leave_applications();

		let html = '';

		// Leave Applications Needed section
		if (suggestions.length > 0) {
			const items = suggestions.map(s => {
				const from_date = frappe.datetime.str_to_obj(s.from_date);
				const to_date = frappe.datetime.str_to_obj(s.to_date);
				const from_fmt = from_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
				const to_fmt = to_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
				const date_range = s.days === 1 ? from_fmt : `${from_fmt} - ${to_fmt}`;

				return `
					<div class="leave-item">
						<button class="btn btn-xs btn-default btn-create-leave-app"
							data-presence-type="${s.presence_type}"
							data-from-date="${s.from_date}"
							data-to-date="${s.to_date}">
							${__("Create")}
						</button>
						<span class="leave-item-text">
							${s.days} ${__("day(s)")} ${s.presence_type_label}
							<span class="text-muted">(${date_range})</span>
						</span>
					</div>
				`;
			}).join('');

			html += `
				<div class="leave-section leave-needed-section">
					<div class="leave-section-header">
						${frappe.utils.icon('triangle-alert', 'sm')}
						<span>${__("Leave Applications Needed")}</span>
					</div>
					<div class="leave-section-items">${items}</div>
				</div>
			`;
		}

		// Open Leave Applications section
		if (open_apps.length > 0) {
			const items = open_apps.map(app => {
				const from_date = frappe.datetime.str_to_obj(app.from_date);
				const to_date = frappe.datetime.str_to_obj(app.to_date);
				const from_fmt = from_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
				const to_fmt = to_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
				const date_range = app.days === 1 ? from_fmt : `${from_fmt} - ${to_fmt}`;

				return `
					<div class="leave-item">
						<button class="btn btn-xs btn-default btn-view-leave-app"
							data-leave-app="${app.name}">
							${__("View")}
						</button>
						<span class="leave-item-text">
							${app.icon || ''} ${app.days} ${__("day(s)")} ${app.label}
							<span class="text-muted">(${date_range})</span>
						</span>
					</div>
				`;
			}).join('');

			html += `
				<div class="leave-section leave-open-section">
					<div class="leave-section-header">
						${frappe.utils.icon('clock', 'sm')}
						<span>${__("Open Leave Applications")}</span>
					</div>
					<div class="leave-section-items">${items}</div>
				</div>
			`;
		}

		if (!html) {
			html = `<div class="leave-section-empty text-muted">${__("No pending leave notices")}</div>`;
		}

		return html;
	}

	/**
	 * Detect open/pending leave applications for the current user.
	 * Returns array of leave applications awaiting approval.
	 */
	detect_open_leave_applications() {
		if (!this.current_employee) return [];

		const emp_pending = this.pending_leaves[this.current_employee];
		if (!emp_pending) return [];

		// Group by leave application name to avoid duplicates across dates
		const apps_map = new Map();
		for (const [date, leaves] of Object.entries(emp_pending)) {
			for (const leave of leaves) {
				if (!apps_map.has(leave.name)) {
					apps_map.set(leave.name, {
						name: leave.name,
						leave_type: leave.leave_type,
						label: leave.label || leave.leave_type,
						status: leave.status,
						icon: leave.icon,
						color: leave.color,
						from_date: date,
						to_date: date,
						days: 1
					});
				} else {
					// Update date range
					const app = apps_map.get(leave.name);
					if (date < app.from_date) app.from_date = date;
					if (date > app.to_date) app.to_date = date;
					app.days++;
				}
			}
		}

		return Array.from(apps_map.values()).sort((a, b) => a.from_date.localeCompare(b.from_date));
	}

	/**
	 * Render open leave applications HTML
	 */
	render_open_applications_html(apps) {
		const items = apps.map(app => {
			// Format dates with weekdays
			const from_date = frappe.datetime.str_to_obj(app.from_date);
			const to_date = frappe.datetime.str_to_obj(app.to_date);
			const from_fmt = from_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			const to_fmt = to_date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			const date_range = app.days === 1 ? from_fmt : `${from_fmt} - ${to_fmt}`;

			return `
				<div class="leave-suggestion-item open-app-item">
					<button class="btn btn-xs btn-default btn-view-leave-app"
						data-leave-app="${app.name}">
						${__("View")}
					</button>
					<span class="suggestion-text">
						${app.icon || ''} ${app.days} ${__("day(s)")} ${app.label}
						<span class="text-muted">(${date_range})</span>
					</span>
				</div>
			`;
		}).join('');

		const count = apps.length;
		return `
			<div class="leave-suggestions-banner open-apps-banner">
				<div class="suggestions-header" role="button">
					${frappe.utils.icon('clock', 'sm')}
					<span>${count} ${__("Open Leave Application(s)")}</span>
					<span class="collapse-icon">▼</span>
				</div>
				<div class="suggestions-list">
					${items}
				</div>
			</div>
		`;
	}

	render_palette() {
		// Filter presence types by availability:
		// General = available_to_all, Specific = not available to all
		const general_types = this.presence_types.filter(t =>
			!t.is_system && t.available_to_all
		);
		const specific_types = this.presence_types.filter(t =>
			!t.is_system && !t.available_to_all
		);

		const make_item = (pt) => `
			<button class="palette-item${pt.selectable === false ? ' disabled' : ''}"
					data-type="${pt.name}"
					${pt.selectable === false ? 'disabled' : ''}
					style="--item-color: ${this.get_color_var(pt.color)}"
					title="${pt.label}${pt.selectable === false ? ' (' + __('no permission') + ')' : ''}">
				<span class="palette-icon">${pt.icon || '•'}</span>
				<span class="palette-label">${pt.label}</span>
			</button>
		`;

		// Normal palette - 3 column layout: General, Specific, Actions
		const normal_palette = `
			<div class="palette-normal">
				<div class="palette-column general-column">
					<span class="palette-column-label">${__('General')}</span>
					<div class="palette-column-items">
						${general_types.map(make_item).join('')}
					</div>
				</div>
				${specific_types.length > 0 ? `
				<div class="palette-column specific-column">
					<span class="palette-column-label">${__('Specific')}</span>
					<div class="palette-column-items">
						${specific_types.map(make_item).join('')}
					</div>
				</div>
				` : ''}
				<div class="palette-column action-column">
					<span class="palette-column-label">${__('Actions')}</span>
					<div class="palette-column-items">
						<button class="palette-item palette-action ${this.palette_mode === 'split' ? 'active' : ''}"
								data-action="split" title="${__('Split AM/PM')}">
							<span class="palette-icon">✂️</span>
							<span class="palette-label">${__('Split')}</span>
						</button>
						<button class="palette-item palette-action palette-clear ${this.palette_mode === 'clear' ? 'active' : ''}"
								data-action="clear" title="${__('Clear')}">
							<span class="palette-icon">🗑️</span>
							<span class="palette-label">${__('Clear')}</span>
						</button>
					</div>
				</div>
			</div>
		`;

		// Split mode palette - exact same layout as normal, just with AM/PM labels and data-half attribute
		const make_split_palette_item = (pt, half) => `
			<button class="palette-item palette-split-item${pt.selectable === false ? ' disabled' : ''}"
					data-type="${pt.name}" data-half="${half}"
					${pt.selectable === false ? 'disabled' : ''}
					style="--item-color: ${this.get_color_var(pt.color)}"
					title="${pt.label}${pt.selectable === false ? ' (' + __('no permission') + ')' : ''}">
				<span class="palette-icon">${pt.icon || '•'}</span>
				<span class="palette-label">${pt.label}</span>
			</button>
		`;

		const split_palette = `
			<div class="palette-split-mode" style="display: none;">
				<div class="split-palette-row am-row">
					<div class="split-palette-label">AM</div>
					<div class="palette-column general-column">
						<span class="palette-column-label">${__('General')}</span>
						<div class="palette-column-items">
							${general_types.map(pt => make_split_palette_item(pt, 'am')).join('')}
						</div>
					</div>
					${specific_types.length > 0 ? `
					<div class="palette-column specific-column">
						<span class="palette-column-label">${__('Specific')}</span>
						<div class="palette-column-items">
							${specific_types.map(pt => make_split_palette_item(pt, 'am')).join('')}
						</div>
					</div>
					` : ''}
				</div>
				<div class="split-palette-row pm-row">
					<div class="split-palette-label">PM</div>
					<div class="palette-column general-column">
						<span class="palette-column-label">${__('General')}</span>
						<div class="palette-column-items">
							${general_types.map(pt => make_split_palette_item(pt, 'pm')).join('')}
						</div>
					</div>
					${specific_types.length > 0 ? `
					<div class="palette-column specific-column">
						<span class="palette-column-label">${__('Specific')}</span>
						<div class="palette-column-items">
							${specific_types.map(pt => make_split_palette_item(pt, 'pm')).join('')}
						</div>
					</div>
					` : ''}
				</div>
				<button class="btn btn-sm btn-default split-cancel-btn" data-action="split-cancel">
					${__('Cancel')}
				</button>
			</div>
		`;

		return `
			<div class="roll-call-palette">
				${normal_palette}
				${split_palette}
				<div class="palette-status-bar"></div>
			</div>
		`;
	}

	render_legend() {
		// Keep for backwards compatibility - now just calls render_palette
		return this.render_palette();
	}

	setup_toolbar_filters() {
		const self = this;

		// Company filter
		this.company_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'company',
				label: __('Company'),
				placeholder: __('All Companies'),
				options: 'Company'
			},
			parent: this.wrapper.find('[data-fieldname="company"]'),
			render_input: true
		});
		this.company_filter.refresh();
		this.company_filter.set_value(frappe.defaults.get_user_default('Company') || '');
		this.company_filter.$input.on('change', () => {
			this.department_filter?.set_value('');
			this.employee_filter?.set_value('');
			this.debounced_refresh();
		});

		// Department filter
		this.department_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'department',
				label: __('Department'),
				placeholder: __('All Departments'),
				options: 'Department',
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
			this.debounced_refresh();
		});

		// Employee filter
		this.employee_filter = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				fieldname: 'employee',
				label: __('Employee'),
				placeholder: __('All Employees'),
				options: 'Employee',
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
		this.employee_filter.$input.on('change', () => this.debounced_refresh());
	}

	// Debounced refresh for filter changes (300ms)
	debounced_refresh() {
		if (this._filter_debounce_timer) {
			clearTimeout(this._filter_debounce_timer);
		}
		this._filter_debounce_timer = setTimeout(() => {
			this.refresh();
		}, 300);
	}

	/**
	 * Build element map for O(1) DOM lookups.
	 * Call this after render() to populate the cache.
	 */
	build_element_map() {
		this.cell_element_map.clear();
		this.wrapper.find('.day-cell').each((_, el) => {
			const $el = $(el);
			const employee = $el.data('employee');
			const date = $el.data('date');
			if (employee && date) {
				const key = `${employee}|${date}`;
				this.cell_element_map.set(key, $el);
			}
		});
	}

	/**
	 * Get cached cell element by employee and date.
	 * Falls back to DOM query if not in cache.
	 * @returns {jQuery} The cell element
	 */
	get_cell_element(employee, date) {
		const key = `${employee}|${date}`;
		let $cell = this.cell_element_map.get(key);
		if (!$cell || !$cell.length) {
			// Fallback to DOM query and cache it
			$cell = this.wrapper.find(`.day-cell[data-employee="${employee}"][data-date="${date}"]`);
			if ($cell.length) {
				this.cell_element_map.set(key, $cell);
			}
		}
		return $cell;
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

		// Date range click - open date picker
		this.wrapper.find('.visible-date-range').on('click', () => this.show_date_picker());

		// Show weekends checkbox
		this.wrapper.find('.show-weekends-check').on('change', function() {
			self.show_weekends = $(this).is(':checked');
			self.render();
		});

		// Leave badge clicks - open dialogs
		// Yellow badge (needed) - opens "Create Leave Applications" dialog
		this.wrapper.off('click.leave-badge-needed').on('click.leave-badge-needed', '.leave-badge-needed', function(e) {
			e.preventDefault();
			e.stopPropagation();
			self.show_create_leave_dialog();
		});

		// Blue badge (open) - opens "View Open Applications" dialog
		this.wrapper.off('click.leave-badge-open').on('click.leave-badge-open', '.leave-badge-open', function(e) {
			e.preventDefault();
			e.stopPropagation();
			self.show_view_leave_dialog();
		});

		// Prevent dropdown from closing when clicking inside filter dropdown
		this.wrapper.find('.filters-dropdown-menu').off('click').on('click', function(e) {
			e.stopPropagation();
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

			// Check if near left edge - load more past days (bi-directional scrolling)
			if (scrollLeft < this.EDGE_THRESHOLD) {
				this.expand_left();
			}

			// Update visible date range in header
			this.update_visible_date_range(scrollLeft, clientWidth);
		}, 100, { leading: true, trailing: true });

		$tableWrapper.on('scroll', this.scroll_handler);

		// ========================================
		// DRAG-TO-SELECT
		// ========================================

		// Mousedown on editable cell starts drag
		$table.on('mousedown', '.day-cell.editable', (e) => {
			// Only left click, and not with modifier keys (let those do their thing)
			if (e.button !== 0) return;
			if (e.ctrlKey || e.metaKey || e.shiftKey) return;

			const $cell = $(e.currentTarget);
			if ($cell.data('locked')) return;

			// Close any open dropdown
			this.close_inline_dropdown();

			// Start drag
			this.is_dragging = true;
			this.drag_start_cell = this.get_cell_coords($cell);
			this.drag_current_cell = this.drag_start_cell;

			// Clear previous selection and select start cell
			this.clear_selection();
			this.select_cell($cell);

			// Prevent text selection during drag
			e.preventDefault();
		});

		// Mousemove updates selection during drag
		$table.on('mousemove', '.day-cell.editable', (e) => {
			if (!this.is_dragging) return;

			const $cell = $(e.currentTarget);
			const coords = this.get_cell_coords($cell);

			// Only update if we moved to a different cell
			if (coords && (!this.drag_current_cell ||
				coords.employee !== this.drag_current_cell.employee ||
				coords.date !== this.drag_current_cell.date)) {

				this.drag_current_cell = coords;
				this.update_drag_selection();
			}
		});

		// Mouseup ends drag (on document to catch mouseup outside table)
		$(document).off('mouseup.rollcall-drag').on('mouseup.rollcall-drag', (e) => {
			if (this.is_dragging) {
				this.is_dragging = false;

				// SPLIT MODE: Apply split to selected cells if both AM and PM selected
				if (this.palette_mode === 'split' && this.split_am_type && this.split_pm_type) {
					this.apply_split_to_selection();
				}
				// Otherwise: Just keep selection, user clicks palette to apply
				// (No auto-apply on drag - user must click palette item)

				this.drag_start_cell = null;
				this.drag_current_cell = null;
			}
		});

		// ========================================
		// CLICK HANDLERS (modified for inline dropdown)
		// ========================================

		// Click on editable cells - using event delegation for better performance
		$table.on('click', '.day-cell.editable', function(e) {
			// If we just finished dragging, don't also trigger click
			if (self.is_dragging) return;

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

			// Note: Single click to open dropdown is handled in mouseup after drag detection
		});

		// Click outside table/palette to deselect cells
		$(document).off('click.rollcall-deselect').on('click.rollcall-deselect', (e) => {
			const $target = $(e.target);

			// Don't deselect if clicking inside the table, palette, or status bar
			if ($target.closest('.roll-call-table').length) return;
			if ($target.closest('.roll-call-palette').length) return;
			if ($target.closest('.palette-status-bar').length) return;
			if ($target.closest('.inline-dropdown-backdrop').length) return;
			if ($target.closest('.split-picker').length) return;

			// Don't deselect if clicking on inputs/filters
			if ($target.closest('.roll-call-filters').length) return;
			if ($target.closest('.frappe-control').length) return;

			// Deselect cells if we have a selection
			if (this.selected_cells.size > 0) {
				this.clear_selection();
				// Also exit split mode if active
				if (this.palette_mode === 'split') {
					this.exit_split_mode();
				}
			}
		});

		// ========================================
		// KEYBOARD SHORTCUTS
		// ========================================
		$(document).off('keydown.rollcall').on('keydown.rollcall', (e) => {
			// Don't handle if typing in an input
			if ($(e.target).is('input, textarea, select')) return;

			// Escape - close dropdown or clear selection
			if (e.key === 'Escape') {
				if (this.active_dropdown) {
					this.close_inline_dropdown();
					e.preventDefault();
				} else if (this.selected_cells.size > 0) {
					this.clear_selection();
					e.preventDefault();
				}
				return;
			}

			// Copy: Ctrl/Cmd + C
			if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
				if (this.selected_cells.size > 0) {
					e.preventDefault();
					this.copy_selection();
				}
				return;
			}

			// Paste: Ctrl/Cmd + V
			if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
				if (this.clipboard && this.selected_cells.size > 0) {
					e.preventDefault();
					this.paste_selection();
				}
				return;
			}

			// Undo: Ctrl/Cmd + Z
			if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
				e.preventDefault();
				this.undo_last_action();
				return;
			}

			// Delete/Backspace - clear selected cells
			if (e.key === 'Delete' || e.key === 'Backspace') {
				if (this.selected_cells.size > 0 && !this.active_dropdown) {
					e.preventDefault();
					this.delete_selected_cells();
				}
				return;
			}

			// Arrow keys - navigate cells
			if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
				if (this.active_dropdown) return; // Let dropdown handle arrows

				e.preventDefault();
				this.navigate_cells(e.key, e.shiftKey);
				return;
			}

			// Enter key - no longer opens dropdown (palette-based interaction only)
		});

	}

	// ========================================
	// PALETTE BAR METHODS
	// ========================================

	/**
	 * Bind events for the palette bar
	 */
	bind_palette_events() {
		const self = this;

		// Click palette item with data-type - apply to selection (no paint mode)
		this.wrapper.on('click', '.palette-item[data-type]', function(e) {
			const type = $(this).data('type');

			// Only apply if there are selected cells
			if (self.selected_cells.size > 0) {
				self.apply_to_selection(type);
			} else {
				// No cells selected - show hint
				frappe.show_alert({ message: __('Select cells first, then click a type to apply'), indicator: 'blue' });
			}
		});

		// Click split action (unbind first to prevent duplicates)
		this.wrapper.off('click.split-action').on('click.split-action', '.palette-item[data-action="split"]', (e) => {
			e.stopPropagation();
			console.log('[Split] Button clicked, selected_cells:', this.selected_cells.size, 'current mode:', this.palette_mode);
			if (this.selected_cells.size === 0) {
				frappe.show_alert({ message: __('Select cells first, then click Split'), indicator: 'blue' });
				return;
			}
			// Don't toggle - just enter if not already in split mode
			if (this.palette_mode === 'split') {
				console.log('[Split] Already in split mode, ignoring');
				return;
			}
			console.log('[Split] Entering split mode...');
			this.enter_split_mode();
		});

		// Click split cancel (supports both old and new button styles)
		this.wrapper.off('click.split-cancel').on('click.split-cancel', '[data-action="split-cancel"]', (e) => {
			e.stopPropagation();
			this.exit_split_mode();
		});

		// Click split mode item (AM/PM selection)
		this.wrapper.off('click.split-item').on('click.split-item', '.palette-split-item', (e) => {
			e.stopPropagation();
			const $item = $(e.currentTarget);
			const type = $item.data('type');
			const half = $item.data('half');
			console.log('[Split] Item clicked:', { type, half, palette_mode: this.palette_mode });
			this.select_split_type(type, half);
		});

		// Click clear action - only works with selection
		this.wrapper.on('click', '.palette-item[data-action="clear"]', () => {
			if (this.selected_cells.size > 0) {
				this.clear_selection_cells();
			} else {
				frappe.show_alert({ message: __('Select cells first, then click Clear'), indicator: 'blue' });
			}
		});

		// Escape key exits split mode or clears selection
		$(document).off('keydown.palette').on('keydown.palette', (e) => {
			if ($(e.target).is('input, textarea, select')) return;

			if (e.key === 'Escape') {
				if (this.palette_mode === 'split') {
					this.exit_paint_mode();
				} else if (this.selected_cells.size > 0) {
					this.clear_selection();
				}
				e.preventDefault();
			}
		});

		// Status bar clear selection button
		this.wrapper.on('click', '[data-action="clear-selection"]', () => {
			this.clear_selection();
		});
	}

	/**
	 * Apply presence type to selected cells (no paint mode - selection first)
	 */
	select_palette_type(type) {
		// Only apply if there are selected cells
		if (this.selected_cells.size > 0) {
			this.apply_to_selection(type);
		} else {
			// No cells selected - show hint
			frappe.show_alert({ message: __('Select cells first, then click a type to apply'), indicator: 'blue' });
		}
	}

	/**
	 * Enter split mode (for AM/PM entries)
	 */
	enter_split_mode() {
		console.log('[Split] enter_split_mode called');

		this.palette_mode = 'split';
		this.split_am_type = null;
		this.split_pm_type = null;

		// Show split palette, hide normal palette
		const $normalPalette = this.wrapper.find('.palette-normal');
		const $splitPalette = this.wrapper.find('.palette-split-mode');

		console.log('[Split] Elements found - normal:', $normalPalette.length, 'split:', $splitPalette.length);

		$normalPalette.hide();
		$splitPalette.css('display', 'flex');
		this.wrapper.find('.palette-split-item').removeClass('active');

		console.log('[Split] Split palette visible:', $splitPalette.is(':visible'));

		// Update table mode
		this.wrapper.find('.roll-call-table').addClass('split-mode');
		this.update_status_bar();
	}

	/**
	 * Select a type in split mode (AM or PM)
	 */
	select_split_type(type, half) {
		console.log('[Split] select_split_type called:', { type, half, current_am: this.split_am_type, current_pm: this.split_pm_type });

		if (half === 'am') {
			this.split_am_type = type;
			// Support both old (.am-row) and new (.am-box) selectors
			this.wrapper.find('.am-row .palette-split-item, .am-box .palette-split-item').removeClass('active');
			this.wrapper.find(`.am-row .palette-split-item[data-type="${type}"], .am-box .palette-split-item[data-type="${type}"]`).addClass('active');
		} else {
			this.split_pm_type = type;
			// Support both old (.pm-row) and new (.pm-box) selectors
			this.wrapper.find('.pm-row .palette-split-item, .pm-box .palette-split-item').removeClass('active');
			this.wrapper.find(`.pm-row .palette-split-item[data-type="${type}"], .pm-box .palette-split-item[data-type="${type}"]`).addClass('active');
		}

		console.log('[Split] After selection:', { am: this.split_am_type, pm: this.split_pm_type, selected_cells: this.selected_cells.size });

		// AUTO-APPLY: When both selected AND cells are selected, apply immediately
		if (this.split_am_type && this.split_pm_type) {
			console.log('[Split] Both types selected, checking cells...');
			if (this.selected_cells.size > 0) {
				console.log('[Split] Applying split to selection...');
				// Apply to selection immediately
				this.apply_split_to_selection();
			} else {
				console.log('[Split] No cells selected, not applying');
			}
		}

		// Always update status bar to reflect current state
		this.update_status_bar();
	}

	/**
	 * Exit split mode
	 */
	exit_split_mode() {
		this.palette_mode = 'none';
		this.split_am_type = null;
		this.split_pm_type = null;

		// Update UI - show normal palette, hide split palette
		this.wrapper.find('.palette-normal').show();
		this.wrapper.find('.palette-split-mode').hide();
		this.wrapper.find('.palette-item').removeClass('active');
		this.wrapper.find('.palette-split-item').removeClass('active');
		this.wrapper.find('.roll-call-table').removeClass('split-mode');
		this.update_status_bar();
	}

	// Alias for backwards compatibility
	exit_paint_mode() {
		this.exit_split_mode();
	}

	/**
	 * Update the palette status message (simple text message)
	 */
	update_palette_status(message) {
		// Support both old and new status element
		const $status = this.wrapper.find('.palette-status-bar, .palette-status');
		$status.html(`<span class="status-text">${message}</span>`);
	}

	/**
	 * Apply presence type to a cell (optimistic update)
	 */
	apply_to_cell(employee, date, presence_type) {
		const key = `${employee}|${date}`;

		// 1. Check for locked/pending leave
		const $cell = this.get_cell_element(employee, date);
		if ($cell && $cell.data('locked')) {
			return { skipped: true, reason: 'locked' };
		}

		const pending_leave = this.get_pending_leave(employee, date);
		if (pending_leave) {
			return { skipped: true, reason: 'pending_leave' };
		}

		// 2. Optimistic UI update
		this.update_cell_optimistic(employee, date, presence_type);

		// 3. Queue the save
		this.pending_saves.set(key, { employee, date, presence_type, day_part: 'full' });

		// 4. Debounce - flush after 300ms of inactivity
		clearTimeout(this.save_timeout);
		this.save_timeout = setTimeout(() => this.flush_saves(), 300);

		return { skipped: false };
	}

	/**
	 * Clear a cell (optimistic update)
	 */
	clear_cell(employee, date) {
		const key = `${employee}|${date}`;

		// Check for locked/pending leave
		const $cell = this.get_cell_element(employee, date);
		if ($cell && $cell.data('locked')) {
			return { skipped: true, reason: 'locked' };
		}

		const pending_leave = this.get_pending_leave(employee, date);
		if (pending_leave) {
			return { skipped: true, reason: 'pending_leave' };
		}

		// Optimistic UI update - clear the cell
		this.update_cell_clear_optimistic(employee, date);

		// Queue the delete
		this.pending_saves.set(key, { employee, date, action: 'delete' });

		// Debounce
		clearTimeout(this.save_timeout);
		this.save_timeout = setTimeout(() => this.flush_saves(), 300);

		return { skipped: false };
	}

	/**
	 * Optimistically update a cell's UI without waiting for API
	 */
	update_cell_optimistic(employee, date, presence_type) {
		const pt = this.presence_types_map.get(presence_type);
		const $cell = this.get_cell_element(employee, date);

		if ($cell.length && pt) {
			$cell.addClass('has-entry saving')
				.removeClass('leave-tentative leave-draft split-day')
				.css('--presence-color', this.get_color_var(pt.color));

			$cell.find('.presence-cell, .split-cell, .missing-indicator').remove();
			$cell.append(`
				<div class="presence-cell" title="${pt.label}">
					<span class="presence-icon">${pt.icon || '•'}</span>
				</div>
			`);
		}
	}

	/**
	 * Optimistically clear a cell's UI
	 */
	update_cell_clear_optimistic(employee, date) {
		const $cell = this.get_cell_element(employee, date);

		if ($cell.length) {
			$cell.removeClass('has-entry leave-tentative leave-draft split-day saving')
				.css('--presence-color', '');

			$cell.find('.presence-cell, .split-cell').remove();

			// Add missing indicator if past date
			const today = frappe.datetime.get_today();
			if (date < today) {
				$cell.html('<span class="missing-indicator">!</span>');
			} else {
				$cell.html('');
			}
		}
	}

	/**
	 * Flush pending saves to the server (batched)
	 */
	async flush_saves() {
		if (this.pending_saves.size === 0) return;

		// Prevent concurrent flushes (deadlock prevention)
		if (this.is_flushing) {
			// Re-schedule flush for later
			clearTimeout(this.save_timeout);
			this.save_timeout = setTimeout(() => this.flush_saves(), 500);
			return;
		}

		this.is_flushing = true;

		const saves = Array.from(this.pending_saves.entries());
		this.pending_saves.clear();

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
						this.update_cell(entry.employee, entry.date, entry);
						// Remove saving class that update_cell doesn't handle
						const $cell = this.get_cell_element(entry.employee, entry.date);
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
						delete this.entries[key];
						const $cell = this.get_cell_element(entry.employee, entry.date);
						if ($cell) $cell.removeClass('saving');
					}
				}
			}

			// Silent save - no toast notification

		} catch (e) {
			frappe.msgprint(__('Error saving. Please try again.'));
			// Revert optimistic updates on error
			this.refresh();
		} finally {
			this.is_flushing = false;
		}
	}

	/**
	 * Apply selected palette type to all cells in current selection
	 */
	apply_to_selection(presence_type) {
		if (this.selected_cells.size === 0) return;

		// Prepare undo state before applying
		const cells_to_modify = [];
		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');
			cells_to_modify.push({ employee, date });
		}
		const undo_record = this.prepare_undo_state(cells_to_modify, 'apply');

		let applied = 0;
		let skipped = 0;

		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');
			const result = this.apply_to_cell(employee, date, presence_type);
			if (result.skipped) {
				skipped++;
			} else {
				applied++;
			}
		}

		// Only save undo if something was actually applied
		if (applied > 0) {
			// Filter undo entries to only include cells that were actually modified
			undo_record.entries = undo_record.entries.filter(e => {
				const key = `${e.employee}|${e.date}`;
				return this.selected_cells.has(key);
			});
			this.push_undo(undo_record);
		}

		// Show feedback
		if (applied > 0) {
			let msg = __('Applied to {0} cells', [applied]);
			if (skipped > 0) {
				msg += __(', {0} skipped (locked)', [skipped]);
			}
			frappe.show_alert({ message: msg, indicator: 'green' });
		} else if (skipped > 0) {
			frappe.show_alert({
				message: __('All {0} cells skipped (locked)', [skipped]),
				indicator: 'red'
			});
		}

		// Clear selection and exit paint mode after applying
		this.clear_selection();
		this.exit_paint_mode();
	}

	/**
	 * Apply split (AM/PM) to all cells in current selection
	 */
	apply_split_to_selection() {
		console.log('[Split] apply_split_to_selection called:', {
			selected_cells: this.selected_cells.size,
			am_type: this.split_am_type,
			pm_type: this.split_pm_type
		});

		if (this.selected_cells.size === 0) {
			console.log('[Split] No cells selected, returning early');
			return;
		}
		if (!this.split_am_type || !this.split_pm_type) {
			console.log('[Split] Missing AM or PM type, returning early');
			return;
		}

		// Save the types before they get cleared by exit_paint_mode
		const am_type = this.split_am_type;
		const pm_type = this.split_pm_type;

		// Collect entries to save
		const entries = [];
		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');

			// Check if cell is editable
			const $cell = this.get_cell_element(employee, date);
			if ($cell && $cell.data('locked')) continue;
			if (this.get_pending_leave(employee, date)) continue;

			entries.push({ employee, date });

			// Optimistic UI update for split cell
			this.update_cell_split_optimistic(employee, date, am_type, pm_type);
		}

		// Prepare undo state before applying
		const undo_record = entries.length > 0 ? this.prepare_undo_state(entries, 'split') : null;

		// Clear selection and exit split mode after applying
		this.clear_selection();
		this.exit_paint_mode();

		// Bulk save (using saved type values)
		if (entries.length > 0) {
			// Push undo record
			if (undo_record) this.push_undo(undo_record);

			this.save_bulk_split_entries_silent(entries, am_type, pm_type);

			frappe.show_alert({
				message: __('Applied split to {0} cells', [entries.length]),
				indicator: 'green'
			});
		}
	}

	/**
	 * Optimistically update a cell for split display
	 */
	update_cell_split_optimistic(employee, date, am_type, pm_type) {
		const am_pt = this.presence_types_map.get(am_type);
		const pm_pt = this.presence_types_map.get(pm_type);
		const $cell = this.get_cell_element(employee, date);

		if ($cell.length && am_pt && pm_pt) {
			$cell.addClass('has-entry split-day saving')
				.removeClass('leave-tentative leave-draft')
				.css('--presence-color', '');

			$cell.find('.presence-cell, .split-cell, .missing-indicator').remove();
			$cell.append(`
				<div class="split-cell">
					<div class="split-am" style="--presence-color: ${this.get_color_var(am_pt.color)}" title="${am_pt.label}">
						<span class="presence-icon">${am_pt.icon || '•'}</span>
					</div>
					<div class="split-pm" style="--presence-color: ${this.get_color_var(pm_pt.color)}" title="${pm_pt.label}">
						<span class="presence-icon">${pm_pt.icon || '•'}</span>
					</div>
				</div>
			`);
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
					this.update_cell(entry.employee, entry.date, entry);
					// Remove saving class that update_cell doesn't handle
					const $cell = this.get_cell_element(entry.employee, entry.date);
					if ($cell) $cell.removeClass('saving');
				}
			}
		} catch (e) {
			frappe.msgprint(__('Error saving. Please try again.'));
			this.refresh();
		}
	}

	/**
	 * Clear all cells in current selection
	 */
	clear_selection_cells() {
		if (this.selected_cells.size === 0) return;

		let cleared = 0;
		let skipped = 0;

		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');
			const result = this.clear_cell(employee, date);
			if (result.skipped) {
				skipped++;
			} else {
				cleared++;
			}
		}

		// Clear selection and exit clear mode after clearing
		this.clear_selection();
		this.exit_paint_mode();
	}

	/**
	 * Show split picker inline at cell (for AM/PM entries)
	 */
	async show_split_picker(employee, date, $cell) {
		// Close any existing dropdown
		this.close_inline_dropdown();

		const key = `${employee}|${date}`;
		const existing = this.entries[key];

		// Check for pending leave or locked - just select and show in status bar
		const pending_leave = this.get_pending_leave(employee, date);
		if (pending_leave) {
			// Select the cell so user can see info in status bar
			this.clear_selection();
			this.selected_cells.add(key);
			$cell.addClass('selected');
			this.update_status_bar();
			return;
		}

		if (existing?.is_locked) {
			// Select the cell so user can see info in status bar
			this.clear_selection();
			this.selected_cells.add(key);
			$cell.addClass('selected');
			this.update_status_bar();
			return;
		}

		// Get available presence types for this employee
		const available_types = await this.get_employee_presence_types(employee, date);
		const working_types = available_types.filter(t => t.category === 'Working');
		const leave_types = available_types.filter(t => t.category === 'Leave');

		// Check if it's already split
		const is_split = existing?.is_half_day && existing?.am_presence_type && existing?.pm_presence_type;
		let am_type = is_split ? existing.am_presence_type : null;
		let pm_type = is_split ? existing.pm_presence_type : null;

		// Build split picker HTML
		const make_option = (pt, half) => `
			<button class="split-picker-option ${(half === 'am' && pt.name === am_type) || (half === 'pm' && pt.name === pm_type) ? 'selected' : ''}"
					data-type="${pt.name}" data-half="${half}"
					style="--item-color: ${this.get_color_var(pt.color)}"
					title="${pt.label}">
				<span class="option-icon">${pt.icon || '•'}</span>
			</button>
		`;

		const picker_html = `
			<div class="split-picker" data-employee="${employee}" data-date="${date}">
				<div class="split-picker-header">
					<span>${__('Split AM/PM')}</span>
					<button class="split-picker-close">×</button>
				</div>
				<div class="split-picker-columns">
					<div class="split-picker-column am-column">
						<div class="column-label">${__('AM')}</div>
						<div class="column-options">
							${working_types.map(pt => make_option(pt, 'am')).join('')}
							${leave_types.length ? '<div class="options-divider"></div>' : ''}
							${leave_types.map(pt => make_option(pt, 'am')).join('')}
						</div>
					</div>
					<div class="split-picker-column pm-column">
						<div class="column-label">${__('PM')}</div>
						<div class="column-options">
							${working_types.map(pt => make_option(pt, 'pm')).join('')}
							${leave_types.length ? '<div class="options-divider"></div>' : ''}
							${leave_types.map(pt => make_option(pt, 'pm')).join('')}
						</div>
					</div>
				</div>
			</div>
		`;

		// Create backdrop and picker
		const $backdrop = $('<div class="inline-dropdown-backdrop"></div>');
		const $picker = $(picker_html);

		// Position picker below cell
		const cell_rect = $cell[0].getBoundingClientRect();
		const viewport_height = window.innerHeight;
		const picker_height = 200;

		let top = cell_rect.bottom + 4;
		if (top + picker_height > viewport_height - 20) {
			top = cell_rect.top - picker_height - 4;
		}

		$picker.css({
			position: 'fixed',
			left: cell_rect.left + 'px',
			top: top + 'px'
		});

		// Add to DOM
		$('body').append($backdrop).append($picker);

		// Store reference
		this.active_dropdown = { $backdrop, $dropdown: $picker, employee, date };

		const self = this;
		const leave_type_names = new Set(leave_types.map(t => t.name));

		// Update leave restrictions (only one half can be leave)
		const update_restrictions = () => {
			const am_is_leave = am_type && leave_type_names.has(am_type);
			const pm_is_leave = pm_type && leave_type_names.has(pm_type);

			$picker.find('.pm-column .split-picker-option').each(function() {
				const is_leave = leave_type_names.has($(this).data('type'));
				$(this).toggleClass('disabled', am_is_leave && is_leave);
			});
			$picker.find('.am-column .split-picker-option').each(function() {
				const is_leave = leave_type_names.has($(this).data('type'));
				$(this).toggleClass('disabled', pm_is_leave && is_leave);
			});
		};

		update_restrictions();

		// Event handlers
		$backdrop.on('click', () => this.close_inline_dropdown());
		$picker.find('.split-picker-close').on('click', () => this.close_inline_dropdown());

		// Option click
		$picker.find('.split-picker-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;

			const type = $(this).data('type');
			const half = $(this).data('half');

			// Update selection
			if (half === 'am') {
				am_type = type;
				$picker.find('.am-column .split-picker-option').removeClass('selected');
			} else {
				pm_type = type;
				$picker.find('.pm-column .split-picker-option').removeClass('selected');
			}
			$(this).addClass('selected');

			update_restrictions();

			// Auto-save when both selected
			if (am_type && pm_type) {
				self.close_inline_dropdown();
				await self.save_split_entry(employee, date, am_type, pm_type);
			}
		});
	}

	/**
	 * Open Leave Application form with pre-filled data
	 */
	create_leave_application(presence_type, from_date, to_date) {
		// Get the presence type info from our cached map
		const pt = this.presence_types_map.get(presence_type);

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

	/**
	 * Format date range for display in dialog cards
	 * @param {string} from_date - Start date (YYYY-MM-DD)
	 * @param {string} to_date - End date (YYYY-MM-DD)
	 * @param {number} days - Number of days
	 * @returns {string} Formatted date string
	 */
	format_date_range(from_date, to_date, days) {
		const from_obj = frappe.datetime.str_to_obj(from_date);
		const to_obj = frappe.datetime.str_to_obj(to_date);

		if (days === 1) {
			// Single day: "Tue, Dec 23"
			return from_obj.toLocaleDateString('en-US', {
				weekday: 'short',
				month: 'short',
				day: 'numeric'
			});
		} else {
			// Range: "Dec 29 - Dec 31"
			const from_fmt = from_obj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			const to_fmt = to_obj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			return `${from_fmt} - ${to_fmt}`;
		}
	}

	/**
	 * Show "Create Leave Applications" dialog (for tentative entries needing leave apps)
	 * Triggered by clicking the yellow badge
	 */
	show_create_leave_dialog() {
		const suggestions = this.detect_leave_suggestions();
		if (!suggestions.length) {
			frappe.show_alert({ message: __('No leave applications needed'), indicator: 'green' });
			return;
		}

		const self = this;

		const items_html = suggestions.map(s => {
			const pt = this.presence_types_map.get(s.presence_type);
			const icon = pt?.icon || '';
			const label = pt?.label || s.presence_type;
			const date_str = this.format_date_range(s.from_date, s.to_date, s.days);

			return `
				<div class="leave-action-card"
					 data-presence-type="${s.presence_type}"
					 data-from-date="${s.from_date}"
					 data-to-date="${s.to_date}">
					<span class="card-icon">${icon}</span>
					<span class="card-label">${label}</span>
					<span class="card-separator">·</span>
					<span class="card-days">${s.days} day${s.days > 1 ? 's' : ''}</span>
					<span class="card-separator">·</span>
					<span class="card-date">${date_str}</span>
					<span class="card-arrow">→</span>
				</div>
			`;
		}).join('');

		const d = new frappe.ui.Dialog({
			title: __('Create Leave Applications'),
			fields: [{
				fieldtype: 'HTML',
				fieldname: 'content',
				options: `<div class="leave-action-list create-list">${items_html}</div>`
			}]
		});

		// Hide primary action button - cards are the actions
		d.$wrapper.find('.btn-primary').hide();

		// Card click handler
		d.$wrapper.find('.leave-action-card').on('click', function() {
			const presence_type = $(this).data('presence-type');
			const from_date = $(this).data('from-date');
			const to_date = $(this).data('to-date');
			d.hide();
			self.create_leave_application(presence_type, from_date, to_date);
		});

		d.show();
	}

	/**
	 * Show "View Open Applications" dialog (for pending leave applications)
	 * Triggered by clicking the blue badge
	 */
	show_view_leave_dialog() {
		const apps = this.detect_open_leave_applications();
		if (!apps.length) {
			frappe.show_alert({ message: __('No open leave applications'), indicator: 'green' });
			return;
		}

		const items_html = apps.map(app => {
			const date_str = this.format_date_range(app.from_date, app.to_date, app.days);

			return `
				<div class="leave-action-card" data-leave-app="${app.name}">
					<span class="card-icon">${app.icon || ''}</span>
					<span class="card-label">${app.label || app.leave_type}</span>
					<span class="card-separator">·</span>
					<span class="card-days">${app.days} day${app.days > 1 ? 's' : ''}</span>
					<span class="card-separator">·</span>
					<span class="card-date">${date_str}</span>
					<span class="card-arrow">→</span>
				</div>
			`;
		}).join('');

		const d = new frappe.ui.Dialog({
			title: __('View Open Applications'),
			fields: [{
				fieldtype: 'HTML',
				fieldname: 'content',
				options: `<div class="leave-action-list view-list">${items_html}</div>`
			}]
		});

		// Hide primary action button - cards are the actions
		d.$wrapper.find('.btn-primary').hide();

		// Card click handler
		d.$wrapper.find('.leave-action-card').on('click', function() {
			const leave_app = $(this).data('leave-app');
			d.hide();
			frappe.set_route('Form', 'Leave Application', leave_app);
		});

		d.show();
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
		// Update the status bar based on current selection
		this.update_status_bar();
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
			this.wrapper.find('.palette-item[data-type]').removeClass('unavailable');
			return;
		}

		// Get intersection of available types for all selected employees
		const available_types = this.get_available_types_for_employees(selected_employees);

		// Mark unavailable types
		this.wrapper.find('.palette-item[data-type]').each(function() {
			const $el = $(this);
			const type = $el.data('type');
			if (available_types.has(type)) {
				$el.removeClass('unavailable');
			} else {
				$el.addClass('unavailable');
			}
		});
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
			return new Set(this.presence_types.map(pt => pt.name));
		}

		// For multiple employees, only allow types that are available_to_all
		// since we can't easily check per-employee permissions synchronously
		const available = new Set();
		for (const pt of this.presence_types) {
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

			const entry = this.entries[key];
			const pendingLeave = this.get_pending_leave(employee, date);
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
	 * Find consecutive date range with same presence type for an employee.
	 * Used to suggest creating leave apps for the full period.
	 */
	find_consecutive_leave_range(employee, date, presence_type) {
		const dates = [date];
		const dateObj = new Date(date);

		// Look backwards
		let checkDate = new Date(dateObj);
		while (true) {
			checkDate.setDate(checkDate.getDate() - 1);
			const checkDateStr = checkDate.toISOString().split('T')[0];
			const key = `${employee}|${checkDateStr}`;
			const entry = this.entries[key];

			if (entry && entry.presence_type === presence_type &&
				entry.leave_status === 'tentative' && !entry.leave_application) {
				dates.unshift(checkDateStr);
			} else {
				break;
			}
		}

		// Look forwards
		checkDate = new Date(dateObj);
		while (true) {
			checkDate.setDate(checkDate.getDate() + 1);
			const checkDateStr = checkDate.toISOString().split('T')[0];
			const key = `${employee}|${checkDateStr}`;
			const entry = this.entries[key];

			if (entry && entry.presence_type === presence_type &&
				entry.leave_status === 'tentative' && !entry.leave_application) {
				dates.push(checkDateStr);
			} else {
				break;
			}
		}

		return {
			from_date: dates[0],
			to_date: dates[dates.length - 1],
			count: dates.length
		};
	}

	/**
	 * Update the status bar based on current state
	 */
	update_status_bar() {
		const $statusBar = this.wrapper.find('.palette-status-bar');
		if (!$statusBar.length) return;

		const info = this.get_selection_info();

		// If in split mode, show split-specific status
		if (this.palette_mode === 'split') {
			this.render_split_status_bar($statusBar, info);
			return;
		}

		// No selection - show default message
		if (info.count === 0) {
			$statusBar.html(`
				<span class="status-text">${__('Click a cell or drag to select')}</span>
			`);
			return;
		}

		// Build status bar content based on selection
		let html = '';

		// Single cell selected
		if (info.count === 1) {
			const cell = info.cells[0];
			const emp = this.employees.find(e => e.name === cell.employee);
			const empName = emp ? emp.employee_name : cell.employee;
			const dateStr = frappe.datetime.str_to_user(cell.date);

			if (cell.pendingLeave) {
				// Pending leave application (open, not yet approved)
				const pendingLeave = cell.pendingLeave;
				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${pendingLeave.icon || '📋'} ${pendingLeave.label || pendingLeave.leave_type} (${__('pending approval')})</span>
					<span class="status-separator">│</span>
					<a href="/app/leave-application/${pendingLeave.name}" target="_blank" class="status-action">
						${__('View Open Leave')}
					</a>
					<span class="status-separator">│</span>
					<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>
				`;
			} else if (info.hasApproved) {
				// Locked - approved leave
				const entry = cell.entry;
				const pt = this.presence_types_map.get(entry.presence_type);
				const icon = pt ? pt.icon : '';
				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${icon} ${pt?.label || entry.presence_type} (${__('approved')})</span>
					<span class="status-separator">│</span>
					<a href="/app/leave-application/${entry.leave_application}" target="_blank" class="status-action">
						${__('View')} ${entry.leave_application}
					</a>
					<span class="status-separator">│</span>
					<span class="status-locked">🔒</span>
				`;
			} else if (info.hasDraft) {
				// Draft leave - pending approval
				const entry = cell.entry;
				const pt = this.presence_types_map.get(entry.presence_type);
				const icon = pt ? pt.icon : '';
				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${icon} ${pt?.label || entry.presence_type} (${__('pending approval')})</span>
					<span class="status-separator">│</span>
					<a href="/app/leave-application/${entry.leave_application}" target="_blank" class="status-action">
						${__('View')} ${entry.leave_application}
					</a>
					<span class="status-separator">│</span>
					<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>
				`;
			} else if (info.hasTentative) {
				// Tentative leave - needs leave app
				// Find consecutive dates with same type to suggest full period
				const entry = cell.entry;
				const pt = this.presence_types_map.get(entry.presence_type);
				const icon = pt ? pt.icon : '';
				const leaveType = pt?.leave_type || '';

				// Find the full consecutive range
				const range = this.find_consecutive_leave_range(cell.employee, cell.date, entry.presence_type);
				const fromDateStr = frappe.datetime.str_to_user(range.from_date);
				const toDateStr = frappe.datetime.str_to_user(range.to_date);
				const dateRangeLabel = range.count > 1 ? `${fromDateStr} - ${toDateStr}` : fromDateStr;

				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${icon} ${pt?.label || entry.presence_type} (${__('needs leave app')})</span>
					<span class="status-separator">│</span>
					<a href="/app/leave-application/new?employee=${cell.employee}&from_date=${range.from_date}&to_date=${range.to_date}&leave_type=${encodeURIComponent(leaveType)}" target="_blank" class="status-action">
						📝 ${__('Create Leave App')}: ${dateRangeLabel}
					</a>
					<span class="status-separator">│</span>
					<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>
				`;
			} else if (info.hasEntry) {
				// Has entry - can change
				const entry = cell.entry;
				const pt = this.presence_types_map.get(entry.presence_type);
				const icon = pt ? pt.icon : '';
				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${icon} ${pt?.label || entry.presence_type}</span>
					<span class="status-separator">│</span>
					<span>${__('Click a type to change')}</span>
					<span class="status-separator">│</span>
					<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>
				`;
			} else {
				// Empty cell
				html = `
					<span class="status-text">${empName}, ${dateStr}</span>
					<span class="status-separator">│</span>
					<span>${__('Click a type to apply')}</span>
					<span class="status-separator">│</span>
					<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>
				`;
			}
		} else {
			// Multiple cells selected
			let statusParts = [`<span class="status-text">${info.count} ${__('cells selected')}</span>`];

			if (info.editableCount !== info.count) {
				statusParts.push(`<span class="status-separator">│</span>`);
				statusParts.push(`<span>${info.editableCount} ${__('editable')}, ${info.lockedCount} ${__('locked')}</span>`);
			}

			if (info.hasTentative && info.leaveApps.size === 0) {
				// All tentative - can create leave app
				const firstDate = info.dates[0];
				const lastDate = info.dates[info.dates.length - 1];
				const emp = info.employees[0];
				const pt = [...info.presenceTypes][0];
				const ptObj = this.presence_types_map.get(pt);
				const leaveType = ptObj?.leave_type || '';
				statusParts.push(`<span class="status-separator">│</span>`);
				statusParts.push(`
					<a href="/app/leave-application/new?employee=${emp}&from_date=${firstDate}&to_date=${lastDate}&leave_type=${encodeURIComponent(leaveType)}" target="_blank" class="status-action">
						📝 ${__('Create Leave App')}: ${frappe.datetime.str_to_user(firstDate)} - ${frappe.datetime.str_to_user(lastDate)}
					</a>
				`);
			} else if (info.editableCount > 0) {
				statusParts.push(`<span class="status-separator">│</span>`);
				statusParts.push(`<span>${__('Click a type to apply')}</span>`);
			}

			statusParts.push(`<span class="status-separator">│</span>`);
			statusParts.push(`<button class="btn btn-xs btn-default status-clear-btn" data-action="clear-selection">✕</button>`);

			html = statusParts.join('');
		}

		$statusBar.html(html);
	}

	/**
	 * Render status bar for split mode
	 */
	render_split_status_bar($statusBar, info) {
		const amPt = this.presence_types_map.get(this.split_am_type);
		const pmPt = this.presence_types_map.get(this.split_pm_type);

		const amText = amPt ? `${amPt.icon} ${amPt.label}` : `<span class="text-muted">[${__('select')}]</span>`;
		const pmText = pmPt ? `${pmPt.icon} ${pmPt.label}` : `<span class="text-muted">[${__('select')}]</span>`;

		// Determine instruction text
		let instruction = '';
		if (!this.split_am_type && !this.split_pm_type) {
			instruction = __('Select AM type above');
		} else if (this.split_am_type && !this.split_pm_type) {
			instruction = __('Now select PM type');
		} else if (this.split_am_type && this.split_pm_type) {
			if (info.count > 0) {
				instruction = __('Ready! Click cells to apply or drag to select more');
			} else {
				instruction = __('Click or drag cells to apply split');
			}
		}

		let cellsText = '';
		if (info.count > 0) {
			cellsText = `<span class="status-separator">│</span><span>${info.count} ${__('cells selected')}</span>`;
		}

		$statusBar.html(`
			<span class="status-text">${__('Split Mode')}</span>
			<span class="status-separator">│</span>
			<span><strong>AM:</strong> ${amText}</span>
			<span class="status-separator">│</span>
			<span><strong>PM:</strong> ${pmText}</span>
			${cellsText}
			<span class="status-separator">│</span>
			<span class="text-muted">${instruction}</span>
			<span class="status-separator">│</span>
			<button class="btn btn-xs btn-default status-clear-btn" data-action="split-cancel">✕ ${__('Cancel')}</button>
		`);
	}

	/**
	 * Select a single cell (add to selection)
	 */
	select_cell($cell) {
		const key = `${$cell.data('employee')}|${$cell.data('date')}`;
		if (!$cell.data('locked') && !$cell.hasClass('weekend')) {
			this.selected_cells.add(key);
			$cell.addClass('selected');
			this.update_selection_toolbar();
		}
	}

	/**
	 * Get cell coordinates for drag selection
	 */
	get_cell_coords($cell) {
		const employee = $cell.data('employee');
		const date = $cell.data('date');
		if (!employee || !date) return null;

		// Find row and column indices
		const row_idx = this.employees.findIndex(e => e.name === employee);
		const all_days = this.get_days_in_range();
		const visible_days = all_days.filter(d => this.show_weekends || !d.is_weekend);
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
		const all_days = this.get_days_in_range();
		const visible_days = all_days.filter(d => this.show_weekends || !d.is_weekend);

		// Clear current selection (batch DOM operation)
		this.selected_cells.clear();
		this.wrapper.find('.day-cell.selected').removeClass('selected');

		// Collect cells to select for batch DOM update
		const cells_to_select = [];

		// Select all cells in the rectangle using cached element map
		for (let r = min_row; r <= max_row; r++) {
			const emp = this.employees[r];
			if (!emp) continue;

			for (let c = min_col; c <= max_col; c++) {
				const day = visible_days[c];
				if (!day || day.is_weekend) continue;

				// Use O(1) cached lookup instead of DOM query
				const $cell = this.get_cell_element(emp.name, day.date);
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
	 * Navigate cells with arrow keys
	 */
	navigate_cells(direction, extend_selection = false) {
		// Get current focus point (last selected cell or first visible editable cell)
		let current_key = null;
		if (this.selected_cells.size > 0) {
			current_key = Array.from(this.selected_cells).pop();
		}

		if (!current_key) {
			// Select first editable cell
			const $first = this.wrapper.find('.day-cell.editable:not(.weekend):first');
			if ($first.length) {
				this.select_cell($first);
			}
			return;
		}

		const [employee, date] = current_key.split('|');
		const $current_cell = this.get_cell_element(employee, date);
		const coords = this.get_cell_coords($current_cell);
		if (!coords) return;

		// Calculate new position
		let new_row = coords.row_idx;
		let new_col = coords.col_idx;

		const all_days = this.get_days_in_range();
		const visible_days = all_days.filter(d => this.show_weekends || !d.is_weekend);

		switch (direction) {
			case 'ArrowUp':    new_row = Math.max(0, new_row - 1); break;
			case 'ArrowDown':  new_row = Math.min(this.employees.length - 1, new_row + 1); break;
			case 'ArrowLeft':  new_col = Math.max(0, new_col - 1); break;
			case 'ArrowRight': new_col = Math.min(visible_days.length - 1, new_col + 1); break;
		}

		const new_emp = this.employees[new_row];
		const new_day = visible_days[new_col];
		if (!new_emp || !new_day) return;

		const $new_cell = this.get_cell_element(new_emp.name, new_day.date);
		if (!$new_cell || !$new_cell.length || !$new_cell.hasClass('editable')) return;

		if (extend_selection) {
			// Shift+Arrow: extend selection
			this.select_cell($new_cell);
		} else {
			// Arrow: move selection
			this.clear_selection();
			this.select_cell($new_cell);
		}

		// Scroll cell into view
		this.scroll_cell_into_view($new_cell);
	}

	/**
	 * Scroll a cell into view within the table wrapper
	 */
	scroll_cell_into_view($cell) {
		const $wrapper = this.wrapper.find('.roll-call-table-wrapper');
		if (!$wrapper.length || !$cell.length) return;

		const wrapper_rect = $wrapper[0].getBoundingClientRect();
		const cell_rect = $cell[0].getBoundingClientRect();

		// Horizontal scroll
		if (cell_rect.left < wrapper_rect.left + this.EMPLOYEE_COLUMN_WIDTH) {
			$wrapper[0].scrollLeft -= (wrapper_rect.left + this.EMPLOYEE_COLUMN_WIDTH - cell_rect.left + 10);
		} else if (cell_rect.right > wrapper_rect.right) {
			$wrapper[0].scrollLeft += (cell_rect.right - wrapper_rect.right + 10);
		}
	}

	// ========================================
	// COPY / PASTE
	// ========================================

	/**
	 * Copy selected cells to clipboard (multi-cell pattern)
	 */
	copy_selection() {
		if (this.selected_cells.size === 0) return;

		// Build a list of selected cells with their row/col indices (using visible columns)
		const cells = [];
		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');
			const row_idx = this.employees.findIndex(e => e.name === employee);
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
			const entry = this.entries[cell.key];
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
		const all_days = this.get_days_in_range();
		let visible_idx = 0;
		for (const day of all_days) {
			if (!this.show_weekends && day.is_weekend) continue;
			if (day.date === date) return visible_idx;
			visible_idx++;
		}
		return -1; // Not found
	}

	/**
	 * Get date from visible column index (accounts for hidden weekends)
	 */
	get_date_from_visible_column(visible_col_idx) {
		const all_days = this.get_days_in_range();
		let visible_idx = 0;
		for (const day of all_days) {
			if (!this.show_weekends && day.is_weekend) continue;
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
		if (!this.clipboard || !this.clipboard.pattern || this.selected_cells.size === 0) return;

		// Get selected cells with their indices (using visible columns to skip weekends)
		const selected = [];
		for (const key of this.selected_cells) {
			const [employee, date] = key.split('|');
			const row_idx = this.employees.findIndex(e => e.name === employee);
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

		// Apply pattern with tiling
		for (let tr = 0; tr < tile_rows; tr++) {
			for (let tc = 0; tc < tile_cols; tc++) {
				for (const p of this.clipboard.pattern) {
					const target_row = anchor_row + (tr * pattern_rows) + p.row_offset;
					const target_col = anchor_col + (tc * pattern_cols) + p.col_offset;

					// Check if within selection bounds (for multi-cell selection)
					if (selected.length > 1) {
						if (target_row > sel_max_row || target_col > sel_max_col) continue;
					}

					// Check if valid employee/date
					if (target_row < 0 || target_row >= this.employees.length) continue;
					if (target_col < 0) continue;

					const employee = this.employees[target_row].name;
					// Use visible column index to get the date (skips weekends when hidden)
					const date = this.get_date_from_visible_column(target_col);
					if (!date) continue; // Out of range

					const key = `${employee}|${date}`;

					// Skip if not in a multi-cell selection (when tiling)
					if (selected.length > 1 && !this.selected_cells.has(key)) continue;

					target_cells.set(key, { employee, date, data: p.data });
				}
			}
		}

		// Filter out locked cells and cells with leave
		const full_entries = [];
		const split_entries = [];
		let skipped = 0;

		for (const [key, target] of target_cells) {
			const $cell = this.get_cell_element(target.employee, target.date);

			// Skip locked cells
			if ($cell && $cell.data('locked')) {
				skipped++;
				continue;
			}

			// Skip cells with leave applications
			const existing = this.entries[key];
			if (existing?.leave_application) {
				skipped++;
				continue;
			}

			// Skip empty pattern entries (don't clear cells)
			if (target.data.type === 'empty') continue;

			if (target.data.type === 'split') {
				split_entries.push({
					employee: target.employee,
					date: target.date,
					am_type: target.data.am_type,
					pm_type: target.data.pm_type
				});
			} else {
				full_entries.push({
					employee: target.employee,
					date: target.date,
					presence_type: target.data.presence_type
				});
			}
		}

		if (full_entries.length === 0 && split_entries.length === 0) {
			frappe.show_alert({ message: __('No cells to paste to (all locked or have leave)'), indicator: 'orange' });
			return;
		}

		// Prepare undo state before pasting
		const cells_to_modify = [
			...full_entries.map(e => ({ employee: e.employee, date: e.date })),
			...split_entries.map(e => ({ employee: e.employee, date: e.date }))
		];
		const undo_record = this.prepare_undo_state(cells_to_modify, 'paste');

		try {
			// Group full entries by presence_type for bulk save
			const by_type = {};
			for (const e of full_entries) {
				by_type[e.presence_type] = by_type[e.presence_type] || [];
				by_type[e.presence_type].push({ employee: e.employee, date: e.date });
			}

			// Group split entries by am/pm type combo
			const by_split = {};
			for (const e of split_entries) {
				const key = `${e.am_type}|${e.pm_type}`;
				by_split[key] = by_split[key] || { am_type: e.am_type, pm_type: e.pm_type, entries: [] };
				by_split[key].entries.push({ employee: e.employee, date: e.date });
			}

			// Build all API calls
			const api_calls = [];

			// Full entry calls
			for (const [presence_type, entries] of Object.entries(by_type)) {
				api_calls.push(
					frappe.call({
						method: 'flexitime.api.roll_call.save_bulk_entries',
						args: { entries, presence_type, day_part: 'full' }
					})
				);
			}

			// Split entry calls
			for (const group of Object.values(by_split)) {
				api_calls.push(
					frappe.call({
						method: 'flexitime.api.roll_call.save_bulk_split_entries',
						args: {
							entries: group.entries,
							am_presence_type: group.am_type,
							pm_presence_type: group.pm_type
						}
					})
				);
			}

			// Execute all API calls in parallel
			const results = await Promise.all(api_calls);

			// Collect all responses
			const responses = [];
			for (const response of results) {
				if (response.message?.entries) {
					responses.push(...response.message.entries);
				}
			}

			const total_pasted = full_entries.length + split_entries.length;
			let msg = __('Pasted to {0} cells', [total_pasted]);
			if (skipped > 0) {
				msg += __(', skipped {0} (locked/leave)', [skipped]);
			}
			frappe.show_alert({ message: msg, indicator: 'green' });

			// Save undo state now that paste succeeded
			this.push_undo(undo_record);

			// Update cells
			for (const entry of responses) {
				this.update_cell(entry.employee, entry.date, entry);
			}

			this.clear_selection();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	/**
	 * Delete selected cells
	 */
	async delete_selected_cells() {
		if (this.selected_cells.size === 0) return;

		const to_delete = [];
		const cells_to_delete = [];  // For undo tracking
		let skipped = 0;

		for (const key of this.selected_cells) {
			const entry = this.entries[key];
			if (!entry) continue;

			// Skip locked or with leave
			if (entry.is_locked || entry.leave_application) {
				skipped++;
				continue;
			}

			to_delete.push(entry.name);
			cells_to_delete.push({ employee: entry.employee, date: entry.date });
		}

		if (to_delete.length === 0) {
			frappe.show_alert({ message: __('No cells to clear'), indicator: 'orange' });
			return;
		}

		// Prepare undo state before deleting
		const undo_record = this.prepare_undo_state(cells_to_delete, 'delete');

		try {
			// Delete entries one by one (could be optimized with bulk delete API)
			for (const name of to_delete) {
				await frappe.call({
					method: 'frappe.client.delete',
					args: { doctype: 'Roll Call Entry', name }
				});
			}

			// Save undo state now that delete succeeded
			this.push_undo(undo_record);

			let msg = __('Cleared {0} cells', [to_delete.length]);
			if (skipped > 0) {
				msg += __(', skipped {0} (locked/leave)', [skipped]);
			}
			frappe.show_alert({ message: msg, indicator: 'green' });

			this.clear_selection();
			await this.refresh();
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	// ========================================
	// UNDO FUNCTIONALITY
	// ========================================

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
			const existing = this.entries[key];

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
			await this.refresh();

		} catch (e) {
			frappe.msgprint(__('Error undoing: {0}', [e.message || e]));
			// Put the record back since undo failed
			this.undo_stack.push(undo_record);
		}
	}

	// ========================================
	// INLINE DROPDOWN
	// ========================================

	/**
	 * Close any active inline dropdown
	 */
	close_inline_dropdown() {
		if (this.active_dropdown) {
			this.active_dropdown.$backdrop.remove();
			this.active_dropdown.$dropdown.remove();
			this.active_dropdown = null;
		}
	}

	/**
	 * Show inline dropdown for a cell
	 */
	async show_inline_dropdown(employee, date, $cell) {
		// Close any existing dropdown
		this.close_inline_dropdown();

		const key = `${employee}|${date}`;
		const existing = this.entries[key];
		const pending_leave = this.get_pending_leave(employee, date);

		// If there's a pending leave or locked leave, show info dialog instead
		if (pending_leave) {
			const emp = this.employees_map?.get(employee);
			const display_name = emp ? this.format_display_name(emp) : employee;
			this.show_pending_leave_dialog(employee, date, display_name, pending_leave);
			return;
		}

		// Check for leave-locked entries
		const has_leave = existing?.leave_application &&
			(existing?.leave_status === 'draft' || existing?.leave_status === 'approved');
		if (has_leave) {
			const emp = this.employees_map?.get(employee);
			const display_name = emp ? this.format_display_name(emp) : employee;
			this.show_leave_info_dialog(employee, date, display_name, existing, 'full');
			return;
		}

		// Get available presence types for this employee
		const available_types = await this.get_employee_presence_types(employee, date);
		const working_types = available_types.filter(t => t.category === 'Working');
		const leave_types = available_types.filter(t => t.category === 'Leave');

		// Build dropdown HTML
		const make_item = (pt, selected = false) => `
			<div class="dropdown-item ${selected ? 'selected' : ''}" data-type="${pt.name}" style="--item-color: ${this.get_color_var(pt.color)}">
				<span class="item-icon">${pt.icon || '•'}</span>
				<span class="item-label">${pt.label}</span>
			</div>
		`;

		const current_type = existing?.presence_type;
		const is_split = existing?.is_half_day && existing?.am_presence_type && existing?.pm_presence_type;

		let dropdown_html = `
			<div class="inline-dropdown" data-employee="${employee}" data-date="${date}">
				<div class="dropdown-content full-day-mode">
					${working_types.map(pt => make_item(pt, pt.name === current_type)).join('')}
					${working_types.length && leave_types.length ? '<div class="dropdown-divider"></div>' : ''}
					${leave_types.map(pt => make_item(pt, pt.name === current_type)).join('')}
					<div class="dropdown-divider"></div>
					<div class="dropdown-item split-trigger">
						<span class="item-icon">✂️</span>
						<span class="item-label">${__('Split AM/PM...')}</span>
					</div>
					${existing ? `
					<div class="dropdown-item clear-trigger text-muted">
						<span class="item-icon">🗑️</span>
						<span class="item-label">${__('Clear')}</span>
					</div>
					` : ''}
				</div>
				<div class="dropdown-content split-day-mode" style="display: none;">
					<div class="split-back">
						<span>←</span> ${__('Back to Full Day')}
					</div>
					<div class="split-container">
						<div class="split-column am-column">
							<div class="split-column-header">${__('AM')}</div>
							<div class="split-selection" data-half="am">
								<span class="selection-icon">--</span>
							</div>
							<div class="split-options">
								${working_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="am" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
								<div class="split-divider"></div>
								${leave_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="am" data-is-leave="1" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
							</div>
						</div>
						<div class="split-column pm-column">
							<div class="split-column-header">${__('PM')}</div>
							<div class="split-selection" data-half="pm">
								<span class="selection-icon">--</span>
							</div>
							<div class="split-options">
								${working_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="pm" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
								<div class="split-divider"></div>
								${leave_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="pm" data-is-leave="1" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		// Create backdrop and dropdown
		const $backdrop = $('<div class="inline-dropdown-backdrop"></div>');
		const $dropdown = $(dropdown_html);

		// Position dropdown below cell (or above if near bottom)
		const cell_rect = $cell[0].getBoundingClientRect();
		const viewport_height = window.innerHeight;
		const dropdown_height = 300; // Approximate

		let top = cell_rect.bottom + 4;
		if (top + dropdown_height > viewport_height - 20) {
			top = cell_rect.top - dropdown_height - 4;
		}

		$dropdown.css({
			position: 'fixed',
			left: cell_rect.left + 'px',
			top: top + 'px',
			minWidth: Math.max(200, cell_rect.width) + 'px'
		});

		// Add to DOM
		$('body').append($backdrop).append($dropdown);

		// Store reference
		this.active_dropdown = { $backdrop, $dropdown, employee, date };

		// Split mode state
		let am_type = is_split ? existing.am_presence_type : null;
		let pm_type = is_split ? existing.pm_presence_type : null;

		// If existing is split, start in split mode
		if (is_split) {
			$dropdown.find('.full-day-mode').hide();
			$dropdown.find('.split-day-mode').show();
			// Update selection displays
			const am_pt = this.presence_types_map.get(am_type);
			const pm_pt = this.presence_types_map.get(pm_type);
			if (am_pt) {
				$dropdown.find('.am-column .split-selection').html(`<span class="selection-icon" style="--item-color: ${this.get_color_var(am_pt.color)}">${am_pt.icon || '•'}</span>`);
				$dropdown.find(`.am-column .split-option[data-type="${am_type}"]`).addClass('selected');
			}
			if (pm_pt) {
				$dropdown.find('.pm-column .split-selection').html(`<span class="selection-icon" style="--item-color: ${this.get_color_var(pm_pt.color)}">${pm_pt.icon || '•'}</span>`);
				$dropdown.find(`.pm-column .split-option[data-type="${pm_type}"]`).addClass('selected');
			}
			this.update_split_leave_restrictions($dropdown, am_type, pm_type, leave_types);
		}

		const self = this;

		// Event handlers

		// Backdrop click closes dropdown
		$backdrop.on('click', () => this.close_inline_dropdown());

		// Full day item click (presence type selection)
		$dropdown.find('.full-day-mode .dropdown-item[data-type]').on('click', async function() {
			const type = $(this).data('type');
			self.close_inline_dropdown();
			await self.save_entry(employee, date, type, false);
		});

		// Split trigger
		$dropdown.find('.split-trigger').on('click', (e) => {
			e.stopPropagation();
			$dropdown.find('.full-day-mode').hide();
			$dropdown.find('.split-day-mode').show();
		});

		// Clear trigger - delete the entry
		const $clear = $dropdown.find('.clear-trigger');
		if ($clear.length) {
			$clear.on('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				self.close_inline_dropdown();
				self.delete_entry(employee, date);
			});
		}

		// Back to full day
		$dropdown.find('.split-back').on('click', () => {
			$dropdown.find('.split-day-mode').hide();
			$dropdown.find('.full-day-mode').show();
			// Reset split selections
			am_type = null;
			pm_type = null;
			$dropdown.find('.split-option').removeClass('selected disabled');
			$dropdown.find('.split-selection').html('<span class="selection-icon">--</span>');
		});

		// Split option click
		$dropdown.find('.split-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;

			const type = $(this).data('type');
			const half = $(this).data('half');
			const pt = self.presence_types_map.get(type);

			// Update selection
			if (half === 'am') {
				am_type = type;
				$dropdown.find('.am-column .split-option').removeClass('selected');
				$(this).addClass('selected');
				$dropdown.find('.am-column .split-selection').html(
					`<span class="selection-icon" style="--item-color: ${self.get_color_var(pt?.color)}">${pt?.icon || '•'}</span>`
				);
			} else {
				pm_type = type;
				$dropdown.find('.pm-column .split-option').removeClass('selected');
				$(this).addClass('selected');
				$dropdown.find('.pm-column .split-selection').html(
					`<span class="selection-icon" style="--item-color: ${self.get_color_var(pt?.color)}">${pt?.icon || '•'}</span>`
				);
			}

			// Update leave restrictions (only one half can be leave)
			self.update_split_leave_restrictions($dropdown, am_type, pm_type, leave_types);

			// Auto-save when both selected
			if (am_type && pm_type) {
				self.close_inline_dropdown();
				await self.save_split_entry(employee, date, am_type, pm_type);
			}
		});
	}

	/**
	 * Update leave type restrictions in split mode (only one half can be leave)
	 */
	update_split_leave_restrictions($dropdown, am_type, pm_type, leave_types) {
		const leave_type_names = new Set(leave_types.map(t => t.name));
		const am_is_leave = am_type && leave_type_names.has(am_type);
		const pm_is_leave = pm_type && leave_type_names.has(pm_type);

		// If AM has leave, disable PM leave options
		$dropdown.find('.pm-column .split-option[data-is-leave="1"]').toggleClass('disabled', am_is_leave);
		// If PM has leave, disable AM leave options
		$dropdown.find('.am-column .split-option[data-is-leave="1"]').toggleClass('disabled', pm_is_leave);
	}

	/**
	 * Show inline dropdown for bulk selection (multiple cells)
	 */
	show_bulk_inline_dropdown() {
		if (this.selected_cells.size === 0) return;

		// Close any existing dropdown
		this.close_inline_dropdown();

		// Check if all selected cells are for the same employee
		const employees = new Set();
		const dates = new Set();
		this.selected_cells.forEach(key => {
			const [employee, date] = key.split('|');
			employees.add(employee);
			dates.add(date);
		});
		const single_employee = employees.size === 1 ? [...employees][0] : null;

		// Get available types - if single employee, get their types; otherwise available_to_all only
		let available_types;
		if (single_employee) {
			// Use cached types for speed (async would be better but complicates UI)
			available_types = this.presence_types.filter(t => !t.is_system && (t.available_to_all || true));
		} else {
			// Multiple employees - only show available_to_all types
			available_types = this.presence_types.filter(t => !t.is_system && t.available_to_all);
		}

		const working_types = available_types.filter(t => t.category === 'Working');
		const leave_types = available_types.filter(t => t.category === 'Leave');

		// Build dropdown HTML
		const make_item = (pt) => `
			<div class="dropdown-item" data-type="${pt.name}" style="--item-color: ${this.get_color_var(pt.color)}">
				<span class="item-icon">${pt.icon || '•'}</span>
				<span class="item-label">${pt.label}</span>
			</div>
		`;

		const cell_count = this.selected_cells.size;

		let dropdown_html = `
			<div class="inline-dropdown bulk-dropdown">
				<div class="dropdown-header">
					<span class="header-count">${cell_count} ${__('cells selected')}</span>
				</div>
				<div class="dropdown-content full-day-mode">
					${working_types.map(pt => make_item(pt)).join('')}
					${working_types.length && leave_types.length ? '<div class="dropdown-divider"></div>' : ''}
					${leave_types.map(pt => make_item(pt)).join('')}
					<div class="dropdown-divider"></div>
					<div class="dropdown-item split-trigger">
						<span class="item-icon">✂️</span>
						<span class="item-label">${__('Split AM/PM...')}</span>
					</div>
				</div>
				<div class="dropdown-content split-day-mode" style="display: none;">
					<div class="split-back">
						<span>←</span> ${__('Back to Full Day')}
					</div>
					<div class="split-container">
						<div class="split-column am-column">
							<div class="split-column-header">${__('AM')}</div>
							<div class="split-selection" data-half="am">
								<span class="selection-icon">--</span>
							</div>
							<div class="split-options">
								${working_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="am" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
								<div class="split-divider"></div>
								${leave_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="am" data-is-leave="1" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
							</div>
						</div>
						<div class="split-column pm-column">
							<div class="split-column-header">${__('PM')}</div>
							<div class="split-selection" data-half="pm">
								<span class="selection-icon">--</span>
							</div>
							<div class="split-options">
								${working_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="pm" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
								<div class="split-divider"></div>
								${leave_types.map(pt => `
									<div class="split-option" data-type="${pt.name}" data-half="pm" data-is-leave="1" style="--item-color: ${this.get_color_var(pt.color)}">
										<span class="option-icon">${pt.icon || '•'}</span>
									</div>
								`).join('')}
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		// Create backdrop and dropdown
		const $backdrop = $('<div class="inline-dropdown-backdrop"></div>');
		const $dropdown = $(dropdown_html);

		// Position dropdown near the selection toolbar button
		const $btn = this.wrapper.find('.btn-set-selection');
		if ($btn.length) {
			const btn_rect = $btn[0].getBoundingClientRect();
			$dropdown.css({
				position: 'fixed',
				left: btn_rect.left + 'px',
				top: (btn_rect.bottom + 4) + 'px',
				minWidth: '200px'
			});
		} else {
			// Fallback: center on screen
			$dropdown.css({
				position: 'fixed',
				left: '50%',
				top: '200px',
				transform: 'translateX(-50%)',
				minWidth: '200px'
			});
		}

		// Add to DOM
		$('body').append($backdrop).append($dropdown);

		// Store reference
		this.active_dropdown = { $backdrop, $dropdown, bulk: true };

		// Split mode state
		let am_type = null;
		let pm_type = null;

		const self = this;

		// Event handlers

		// Backdrop click closes dropdown
		$backdrop.on('click', () => this.close_inline_dropdown());

		// Full day item click - save to all selected cells
		$dropdown.find('.full-day-mode .dropdown-item:not(.split-trigger)').on('click', async function() {
			const type = $(this).data('type');
			self.close_inline_dropdown();
			await self.save_bulk_entries(type, 'full');
		});

		// Split trigger
		$dropdown.find('.split-trigger').on('click', () => {
			$dropdown.find('.full-day-mode').hide();
			$dropdown.find('.split-day-mode').show();
		});

		// Back to full day
		$dropdown.find('.split-back').on('click', () => {
			$dropdown.find('.split-day-mode').hide();
			$dropdown.find('.full-day-mode').show();
			// Reset split selections
			am_type = null;
			pm_type = null;
			$dropdown.find('.split-option').removeClass('selected disabled');
			$dropdown.find('.split-selection').html('<span class="selection-icon">--</span>');
		});

		// Split option click
		$dropdown.find('.split-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;

			const type = $(this).data('type');
			const half = $(this).data('half');
			const pt = self.presence_types_map.get(type);

			// Update selection
			if (half === 'am') {
				am_type = type;
				$dropdown.find('.am-column .split-option').removeClass('selected');
				$(this).addClass('selected');
				$dropdown.find('.am-column .split-selection').html(
					`<span class="selection-icon" style="--item-color: ${self.get_color_var(pt?.color)}">${pt?.icon || '•'}</span>`
				);
			} else {
				pm_type = type;
				$dropdown.find('.pm-column .split-option').removeClass('selected');
				$(this).addClass('selected');
				$dropdown.find('.pm-column .split-selection').html(
					`<span class="selection-icon" style="--item-color: ${self.get_color_var(pt?.color)}">${pt?.icon || '•'}</span>`
				);
			}

			// Update leave restrictions
			self.update_split_leave_restrictions($dropdown, am_type, pm_type, leave_types);

			// Auto-save when both selected
			if (am_type && pm_type) {
				self.close_inline_dropdown();
				await self.save_bulk_split_entries(am_type, pm_type);
			}
		});
	}

	show_bulk_presence_dialog() {
		if (this.selected_cells.size === 0) return;

		// Check if all selected cells are for the same employee
		const employees = new Set();
		this.selected_cells.forEach(key => {
			const [employee] = key.split('|');
			employees.add(employee);
		});
		const single_employee = employees.size === 1 ? [...employees][0] : null;

		// If single employee, show all types; if multiple employees, show only available_to_all
		const available_types = this.get_dialog_presence_types(single_employee);

		// Split into quick (show_in_quick_dialog=1) and extended types
		const working_quick = available_types.filter(t => t.category === 'Working' && t.show_in_quick_dialog);
		const working_extended = available_types.filter(t => t.category === 'Working' && !t.show_in_quick_dialog);
		const not_working_quick = available_types.filter(t => t.category === 'Leave' && t.show_in_quick_dialog);
		const not_working_extended = available_types.filter(t => t.category === 'Leave' && !t.show_in_quick_dialog);
		const all_not_working = [...not_working_quick, ...not_working_extended];

		// Check if there are any extended options to show
		const has_extended = working_extended.length > 0 || not_working_extended.length > 0;

		const make_options = (types) => types.map(pt => `
			<div class="presence-option" data-type="${pt.name}" data-category="${pt.category}" style="--option-color: ${this.get_color_var(pt.color)}">
				<span class="option-icon">${pt.icon || '•'}</span>
				<span class="option-label">${pt.label}</span>
			</div>
		`).join('');

		let is_split_day = false;
		let show_all = false;
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
						<div class="presence-dialog-compact">
							<!-- Header: Cell count | Tabs | Toggle -->
							<div class="dialog-header-row">
								<div class="header-info">
									<strong>${__("{0} cells", [this.selected_cells.size])}</strong>
								</div>
								<div class="header-controls">
									<div class="mode-tabs">
										<button type="button" class="mode-tab active" data-mode="full">${__('Full Day')}</button>
										<button type="button" class="mode-tab" data-mode="split">${__('Split')}</button>
									</div>
									${has_extended ? `
									<label class="show-all-toggle">
										<input type="checkbox" class="show-all-check">
										<span class="toggle-switch"></span>
										<span class="toggle-label">${__('All')}</span>
									</label>
									` : ''}
								</div>
							</div>

							<!-- Full Day Mode -->
							<div class="full-day-content">
								<div class="options-section working-section">
									<div class="options-row quick-options">
										${make_options(working_quick)}
									</div>
									${working_extended.length ? `
									<div class="options-row extended-options" style="display:none">
										${make_options(working_extended)}
									</div>
									` : ''}
								</div>
								<div class="options-divider"></div>
								<div class="options-section not-working-section">
									<div class="options-row quick-options">
										${make_options(not_working_quick)}
									</div>
									${not_working_extended.length ? `
									<div class="options-row extended-options" style="display:none">
										${make_options(not_working_extended)}
									</div>
									` : ''}
								</div>
							</div>

							<!-- Split Day Mode -->
							<div class="split-day-content" style="display:none">
								<div class="split-notice">
									<span>⚠️ ${__('Only one half can be leave')}</span>
								</div>
								<div class="split-columns">
									<div class="split-column am-column">
										<div class="column-label">${__('AM')}</div>
										<div class="options-section working-section">
											<div class="options-row quick-options">
												${make_options(working_quick)}
											</div>
											${working_extended.length ? `
											<div class="options-row extended-options" style="display:none">
												${make_options(working_extended)}
											</div>
											` : ''}
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick)}
											</div>
											${not_working_extended.length ? `
											<div class="options-row extended-options" style="display:none">
												${make_options(not_working_extended)}
											</div>
											` : ''}
										</div>
									</div>
									<div class="split-column pm-column">
										<div class="column-label">${__('PM')}</div>
										<div class="options-section working-section">
											<div class="options-row quick-options">
												${make_options(working_quick)}
											</div>
											${working_extended.length ? `
											<div class="options-row extended-options" style="display:none">
												${make_options(working_extended)}
											</div>
											` : ''}
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick)}
											</div>
											${not_working_extended.length ? `
											<div class="options-row extended-options" style="display:none">
												${make_options(not_working_extended)}
											</div>
											` : ''}
										</div>
									</div>
								</div>
							</div>
						</div>
					`
				}
			]
		});

		// Hide primary action button - we auto-save on selection
		d.$wrapper.find('.btn-primary').hide();

		const self = this;

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

		// Full day selection - AUTO-SAVE on click
		d.$wrapper.find('.full-day-content .presence-option').on('click', async function() {
			d.$wrapper.find('.full-day-content .presence-option').removeClass('selected');
			$(this).addClass('selected');
			full_day_type = $(this).data('type');

			// Auto-save and close
			d.hide();
			await self.save_bulk_entries(full_day_type, 'full');
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

		// Auto-save when both AM and PM are selected
		const tryAutoSaveSplit = async () => {
			if (am_type && pm_type) {
				d.hide();
				await self.save_bulk_split_entries(am_type, pm_type);
			}
		};

		// AM selection
		d.$wrapper.find('.am-column .presence-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.am-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			am_type = $(this).data('type');
			updateNotWorkingState();
			await tryAutoSaveSplit();
		});

		// PM selection
		d.$wrapper.find('.pm-column .presence-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.pm-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			pm_type = $(this).data('type');
			updateNotWorkingState();
			await tryAutoSaveSplit();
		});

		d.show();
	}

	/**
	 * Show read-only dialog for cells with Leave Applications
	 * @param {string} employee - Employee ID
	 * @param {string} date - Date string
	 * @param {string} employee_name - Display name
	 * @param {object} existing - Existing entry data
	 * @param {string} leave_side - 'full' for full day, 'am' for AM only, 'pm' for PM only
	 */
	async show_leave_info_dialog(employee, date, employee_name, existing, leave_side) {
		// Format date nicely: "Tue, 9 Dec"
		const date_obj = frappe.datetime.str_to_obj(date);
		const formatted_date = date_obj.toLocaleDateString('en-US', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});

		// Helper to get presence type label from cached map
		const get_pt_label = (type_name) => {
			const pt = this.presence_types_map.get(type_name);
			return pt?.label || type_name;
		};

		const get_status_badge = (status) => {
			if (status === 'approved') {
				return `<span class="leave-status-badge approved">${__('Approved')}</span>`;
			} else {
				return `<span class="leave-status-badge open">${__('Open')}</span>`;
			}
		};

		const get_leave_display = (presence_icon, presence_label, status, leave_app) => `
			<div class="leave-info-display">
				<div class="leave-presence">
					<span class="leave-icon">${presence_icon || '•'}</span>
					<span class="leave-label">${presence_label}</span>
					${get_status_badge(status)}
				</div>
				<button type="button" class="btn btn-sm btn-default btn-view-leave" data-leave="${leave_app}">
					<span>📋</span> ${__('View Leave Application')}
				</button>
			</div>
		`;

		let dialog_content = '';

		if (leave_side === 'full') {
			// Full day read-only
			dialog_content = `
				<div class="leave-info-dialog">
					<div class="dialog-header-row">
						<div class="header-info">
							<strong>${employee_name}</strong>
							<span class="text-muted"> - ${formatted_date}</span>
						</div>
					</div>
					${get_leave_display(
						existing.presence_type_icon,
						existing.presence_type_label || existing.presence_type,
						existing.leave_status,
						existing.leave_application
					)}
				</div>
			`;
		} else {
			// Split day - one side read-only, other editable
			const available_types = await this.get_employee_presence_types(employee, date);
			const working_quick = available_types.filter(t => t.category === 'Working' && t.show_in_quick_dialog);
			const not_working_quick = available_types.filter(t => t.category === 'Leave' && t.show_in_quick_dialog);

			const editable_type = leave_side === 'am' ? existing?.pm_presence_type : existing?.am_presence_type;

			const make_options = (types, selected_type) => types.map(pt => `
				<div class="presence-option ${selected_type === pt.name ? 'selected' : ''}"
					 data-type="${pt.name}"
					 data-category="${pt.category}"
					 style="--option-color: ${this.get_color_var(pt.color)}">
					<span class="option-icon">${pt.icon || '•'}</span>
					<span class="option-label">${pt.label}</span>
				</div>
			`).join('');

			// For split days, the leave_application is shared - use the single field
			// Look up the label from cached presence types
			const leave_half_content = leave_side === 'am'
				? get_leave_display(
					existing.am_presence_icon,
					get_pt_label(existing.am_presence_type),
					existing.am_leave_status,
					existing.leave_application
				)
				: get_leave_display(
					existing.pm_presence_icon,
					get_pt_label(existing.pm_presence_type),
					existing.pm_leave_status,
					existing.leave_application
				);

			const editable_half_content = `
				<div class="options-section working-section">
					<div class="options-row quick-options">
						${make_options(working_quick, editable_type)}
					</div>
				</div>
				<div class="options-divider-sm"></div>
				<div class="options-section not-working-section">
					<div class="options-row quick-options">
						${make_options(not_working_quick, editable_type)}
					</div>
				</div>
			`;

			dialog_content = `
				<div class="leave-info-dialog split-mode">
					<div class="dialog-header-row">
						<div class="header-info">
							<strong>${employee_name}</strong>
							<span class="text-muted"> - ${formatted_date}</span>
						</div>
						<div class="header-controls">
							<div class="mode-tabs">
								<button type="button" class="mode-tab" disabled>${__('Full Day')}</button>
								<button type="button" class="mode-tab active">${__('Split')}</button>
							</div>
						</div>
					</div>
					<div class="split-columns">
						<div class="split-column am-column ${leave_side === 'am' ? 'read-only' : ''}">
							<div class="column-label">${__('AM')}</div>
							${leave_side === 'am' ? leave_half_content : editable_half_content}
						</div>
						<div class="split-column pm-column ${leave_side === 'pm' ? 'read-only' : ''}">
							<div class="column-label">${__('PM')}</div>
							${leave_side === 'pm' ? leave_half_content : editable_half_content}
						</div>
					</div>
				</div>
			`;
		}

		const d = new frappe.ui.Dialog({
			title: __('Presence'),
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'content',
					options: dialog_content
				}
			]
		});

		// Hide primary action button
		d.$wrapper.find('.btn-primary').hide();

		// Handle View Leave Application button clicks
		d.$wrapper.find('.btn-view-leave').on('click', function() {
			const leave_app = $(this).data('leave');
			d.hide();
			frappe.set_route('Form', 'Leave Application', leave_app);
		});

		// For split mode with editable half - handle selection
		if (leave_side !== 'full') {
			const self = this;
			const editable_column = leave_side === 'am' ? '.pm-column' : '.am-column';

			d.$wrapper.find(`${editable_column} .presence-option`).on('click', async function() {
				d.$wrapper.find(`${editable_column} .presence-option`).removeClass('selected');
				$(this).addClass('selected');
				const selected_type = $(this).data('type');

				// Get the leave-locked half's type
				const locked_type = leave_side === 'am' ? existing.am_presence_type : existing.pm_presence_type;

				d.hide();

				// Save as split entry
				if (leave_side === 'am') {
					await self.save_split_entry(employee, date, locked_type, selected_type);
				} else {
					await self.save_split_entry(employee, date, selected_type, locked_type);
				}
			});
		}

		d.show();
	}

	/**
	 * Show read-only dialog for pending leave applications (not yet approved)
	 * @param {string} employee - Employee ID
	 * @param {string} date - Date string
	 * @param {string} employee_name - Display name
	 * @param {object} pending_leave - Pending leave info from API
	 */
	show_pending_leave_dialog(employee, date, employee_name, pending_leave) {
		// Format date nicely: "Tue, 9 Dec"
		const date_obj = frappe.datetime.str_to_obj(date);
		const formatted_date = date_obj.toLocaleDateString('en-US', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});

		const d = new frappe.ui.Dialog({
			title: __('Leave Application'),
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'content',
					options: `
						<div class="leave-info-dialog">
							<div class="dialog-header-row">
								<div class="header-info">
									<strong>${employee_name}</strong>
									<span class="text-muted"> - ${formatted_date}</span>
								</div>
							</div>
							<div class="leave-info-display">
								<div class="leave-presence">
									<span class="leave-icon">${pending_leave.icon || ''}</span>
									<span class="leave-label">${pending_leave.label || pending_leave.leave_type}</span>
									<span class="leave-status-badge open">${__('Open')}</span>
								</div>
							</div>
						</div>
					`
				}
			],
			primary_action_label: __('View Leave Application'),
			primary_action: () => {
				frappe.set_route('Form', 'Leave Application', pending_leave.name);
				d.hide();
			}
		});

		// Make primary button grey instead of blue
		d.$wrapper.find('.btn-primary').removeClass('btn-primary').addClass('btn-default');
		d.show();
	}

	async show_presence_dialog(employee, date, employee_name) {
		const key = `${employee}|${date}`;
		const existing = this.entries[key];
		const pending_leave = this.get_pending_leave(employee, date);

		// PRIORITY: If there's a pending leave application, show info dialog
		// Regardless of whether a Roll Call Entry exists
		if (pending_leave) {
			this.show_pending_leave_dialog(employee, date, employee_name, pending_leave);
			return;
		}

		// Check if this entry has a linked Leave Application (draft or approved)
		// If so, show read-only info dialog instead
		const entry_is_split = existing?.is_half_day && existing?.am_presence_type && existing?.pm_presence_type;

		// For split days, check individual AM/PM leave status
		const has_am_leave = entry_is_split && existing?.leave_application &&
			(existing?.am_leave_status === 'draft' || existing?.am_leave_status === 'approved');

		const has_pm_leave = entry_is_split && existing?.leave_application &&
			(existing?.pm_leave_status === 'draft' || existing?.pm_leave_status === 'approved');

		// For full day entries, check overall leave status
		const has_full_day_leave = !entry_is_split && existing?.leave_application &&
			(existing?.leave_status === 'draft' || existing?.leave_status === 'approved');

		// If full day leave OR both halves have leave, show fully read-only dialog
		if (has_full_day_leave || (has_am_leave && has_pm_leave)) {
			this.show_leave_info_dialog(employee, date, employee_name, existing, 'full');
			return;
		}

		// If split day with one half having leave, show split dialog with one side read-only
		if (has_am_leave || has_pm_leave) {
			this.show_leave_info_dialog(employee, date, employee_name, existing, has_am_leave ? 'am' : 'pm');
			return;
		}

		// Get employee-specific presence types (includes Employee Presence Settings permissions)
		const available_types = await this.get_employee_presence_types(employee, date);

		// Split into quick (show_in_quick_dialog=1) and extended types
		const working_quick = available_types.filter(t => t.category === 'Working' && t.show_in_quick_dialog);
		const working_extended = available_types.filter(t => t.category === 'Working' && !t.show_in_quick_dialog);
		const not_working_quick = available_types.filter(t => t.category === 'Leave' && t.show_in_quick_dialog);
		const not_working_extended = available_types.filter(t => t.category === 'Leave' && !t.show_in_quick_dialog);
		const all_working = [...working_quick, ...working_extended];
		const all_not_working = [...not_working_quick, ...not_working_extended];

		// Check if there are any extended options to show
		const has_extended = working_extended.length > 0 || not_working_extended.length > 0;

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
									${has_extended ? `
									<label class="show-all-toggle">
										<input type="checkbox" class="show-all-check" ${show_all ? 'checked' : ''}>
										<span class="toggle-switch"></span>
										<span class="toggle-label">${__('All')}</span>
									</label>
									` : ''}
								</div>
							</div>

							<!-- Full Day Mode -->
							<div class="full-day-content" ${is_split_day ? 'style="display:none"' : ''}>
								<div class="options-section working-section">
									<div class="options-row quick-options">
										${make_options(working_quick, existing?.presence_type)}
									</div>
									${working_extended.length ? `
									<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
										${make_options(working_extended, existing?.presence_type)}
									</div>
									` : ''}
								</div>
								<div class="options-divider"></div>
								<div class="options-section not-working-section">
									<div class="options-row quick-options">
										${make_options(not_working_quick, existing?.presence_type)}
									</div>
									${not_working_extended.length ? `
									<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
										${make_options(not_working_extended, existing?.presence_type)}
									</div>
									` : ''}
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
											${working_extended.length ? `
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(working_extended, existing?.am_presence_type)}
											</div>
											` : ''}
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick, existing?.am_presence_type)}
											</div>
											${not_working_extended.length ? `
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(not_working_extended, existing?.am_presence_type)}
											</div>
											` : ''}
										</div>
									</div>
									<div class="split-column pm-column">
										<div class="column-label">${__('PM')}</div>
										<div class="options-section working-section">
											<div class="options-row quick-options">
												${make_options(working_quick, existing?.pm_presence_type)}
											</div>
											${working_extended.length ? `
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(working_extended, existing?.pm_presence_type)}
											</div>
											` : ''}
										</div>
										<div class="options-divider-sm"></div>
										<div class="options-section not-working-section">
											<div class="options-row quick-options">
												${make_options(not_working_quick, existing?.pm_presence_type)}
											</div>
											${not_working_extended.length ? `
											<div class="options-row extended-options" ${!show_all ? 'style="display:none"' : ''}>
												${make_options(not_working_extended, existing?.pm_presence_type)}
											</div>
											` : ''}
										</div>
									</div>
								</div>
							</div>
						</div>
					`
				}
			],
			// Only show Clear button if there's existing data
			secondary_action_label: existing ? __('Clear') : null,
			secondary_action: existing ? async () => {
				d.hide();
				await this.delete_entry(employee, date);
			} : null
		});

		// Hide primary action button - we auto-save on selection
		d.$wrapper.find('.btn-primary').hide();

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

		// Full day selection - AUTO-SAVE on click
		d.$wrapper.find('.full-day-content .presence-option').on('click', async function() {
			d.$wrapper.find('.full-day-content .presence-option').removeClass('selected');
			$(this).addClass('selected');
			full_day_type = $(this).data('type');

			// Auto-save and close
			d.hide();
			await self.save_entry(employee, date, full_day_type, false);
		});

		const self = this;

		// Update not-working disabled state for split day
		const updateNotWorkingState = () => {
			const am_is_not_working = am_type && all_not_working.some(t => t.name === am_type);
			const pm_is_not_working = pm_type && all_not_working.some(t => t.name === pm_type);

			// If AM has not-working selected, disable PM not-working options
			d.$wrapper.find('.pm-column .not-working-section .presence-option').toggleClass('disabled', am_is_not_working);
			// If PM has not-working selected, disable AM not-working options
			d.$wrapper.find('.am-column .not-working-section .presence-option').toggleClass('disabled', pm_is_not_working);
		};

		// Auto-save when both AM and PM are selected
		const tryAutoSaveSplit = async () => {
			if (am_type && pm_type) {
				d.hide();
				await self.save_split_entry(employee, date, am_type, pm_type);
			}
		};

		// AM selection
		d.$wrapper.find('.am-column .presence-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.am-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			am_type = $(this).data('type');
			updateNotWorkingState();
			await tryAutoSaveSplit();
		});

		// PM selection
		d.$wrapper.find('.pm-column .presence-option').on('click', async function() {
			if ($(this).hasClass('disabled')) return;
			d.$wrapper.find('.pm-column .presence-option').removeClass('selected');
			$(this).addClass('selected');
			pm_type = $(this).data('type');
			updateNotWorkingState();
			await tryAutoSaveSplit();
		});

		// Initial state update
		updateNotWorkingState();

		d.show();
	}

	async save_entry(employee, date, presence_type, is_half_day = false) {
		try {
			const result = await frappe.call({
				method: 'flexitime.api.roll_call.save_entry',
				args: { employee, date, presence_type, is_half_day }
			});
			frappe.show_alert({ message: __('Saved'), indicator: 'green' });
			// Use targeted cell update instead of full re-render for better performance
			if (result.message) {
				this.update_cell(employee, date, result.message);
			}
		} catch (e) {
			frappe.msgprint(__('Error: {0}', [e.message || e]));
		}
	}

	async save_split_entry(employee, date, am_type, pm_type) {
		try {
			const result = await frappe.call({
				method: 'flexitime.api.roll_call.save_split_entry',
				args: { employee, date, am_presence_type: am_type, pm_presence_type: pm_type }
			});
			frappe.show_alert({ message: __('Saved'), indicator: 'green' });
			// Use targeted cell update instead of full re-render for better performance
			if (result.message) {
				this.update_cell(employee, date, result.message);
			}
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

			const response = await frappe.call({
				method: 'flexitime.api.roll_call.save_bulk_entries',
				args: { entries, presence_type, day_part }
			});

			frappe.show_alert({ message: __('Saved {0} entries', [entries.length]), indicator: 'green' });
			this.clear_selection();

			// Update cells individually instead of full refresh
			if (response.message?.entries) {
				for (const entry of response.message.entries) {
					this.update_cell(entry.employee, entry.date, entry);
				}
			} else {
				// Fallback to full refresh if entries not returned
				await this.refresh();
			}
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

			const response = await frappe.call({
				method: 'flexitime.api.roll_call.save_bulk_split_entries',
				args: { entries, am_presence_type: am_type, pm_presence_type: pm_type }
			});

			frappe.show_alert({ message: __('Saved {0} entries', [entries.length]), indicator: 'green' });
			this.clear_selection();

			// Update cells individually instead of full refresh
			if (response.message?.entries) {
				for (const entry of response.message.entries) {
					this.update_cell(entry.employee, entry.date, entry);
				}
			} else {
				// Fallback to full refresh if entries not returned
				await this.refresh();
			}
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

	// Throttle utility with leading and trailing edge support
	throttle(func, wait, options = {}) {
		let timeout = null;
		let lastArgs = null;
		let lastCallTime = 0;
		const { leading = true, trailing = true } = options;

		return function(...args) {
			const now = Date.now();
			lastArgs = args;

			// Leading edge: execute immediately if enough time has passed
			if (leading && (now - lastCallTime >= wait)) {
				lastCallTime = now;
				func.apply(this, args);
				return;
			}

			// Trailing edge: schedule execution after wait period
			if (trailing && !timeout) {
				timeout = setTimeout(() => {
					lastCallTime = Date.now();
					func.apply(this, lastArgs);
					timeout = null;
				}, wait);
			}
		}.bind(this);
	}

	update_visible_date_range(scrollLeft, clientWidth) {
		const all_days = this.get_days_in_range();
		const visible_days = all_days.filter(d => this.show_weekends || !d.is_weekend);

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

		// Cap total days to prevent unbounded growth
		if (this.total_days >= this.MAX_TOTAL_DAYS) {
			return;
		}

		this.is_expanding = true;

		// Safety timeout - reset flag after 10s if stuck
		const safetyTimeout = setTimeout(() => {
			this.is_expanding = false;
		}, 10000);

		try {
			// Expand by adding more days to the end
			this.total_days = Math.min(this.total_days + this.EXPAND_BY, this.MAX_TOTAL_DAYS);

			// Reload data for the new range
			await this.load_data();
			this.render();
		} finally {
			clearTimeout(safetyTimeout);
			this.is_expanding = false;
		}
	}

	async expand_left() {
		if (this.is_expanding) return;

		// Cap total days to prevent unbounded growth
		if (this.total_days >= this.MAX_TOTAL_DAYS) {
			return;
		}

		this.is_expanding = true;

		// Safety timeout - reset flag after 10s if stuck
		const safetyTimeout = setTimeout(() => {
			this.is_expanding = false;
		}, 10000);

		try {
			const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
			const old_scroll = $tableWrapper.length ? $tableWrapper[0].scrollLeft : 0;
			const old_scroll_width = $tableWrapper.length ? $tableWrapper[0].scrollWidth : 0;

			// Move start date back
			const start = frappe.datetime.str_to_obj(this.start_date);
			start.setDate(start.getDate() - this.EXPAND_BY);
			this.start_date = frappe.datetime.obj_to_str(start);
			this.total_days = Math.min(this.total_days + this.EXPAND_BY, this.MAX_TOTAL_DAYS);

			// Reload data for the new range
			await this.load_data();
			this.render();

			// Wait for DOM to update, then restore scroll position
			// Use requestAnimationFrame to ensure layout is complete
			requestAnimationFrame(() => {
				const new_wrapper = this.wrapper.find('.roll-call-table-wrapper');
				if (new_wrapper.length) {
					const new_scroll_width = new_wrapper[0].scrollWidth;
					// Calculate how much width was added to the left
					const added_width = new_scroll_width - old_scroll_width;
					// Adjust scroll to maintain same visual position
					new_wrapper[0].scrollLeft = old_scroll + added_width;
				}
			});
		} finally {
			clearTimeout(safetyTimeout);
			this.is_expanding = false;
		}
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
				if (!this.show_weekends && d.is_weekend) continue;

				// Count separator columns
				if (this.show_weekends && i > 0 && all_days[i-1]?.is_sunday) {
					col_index++;
				} else if (!this.show_weekends && d.is_monday && prev_visible?.is_friday) {
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

		const scrollLeft = $tableWrapper[0].scrollLeft;
		const scrollWidth = $tableWrapper[0].scrollWidth;
		const clientWidth = $tableWrapper[0].clientWidth;

		// Check if we're near the edge and need to load more data
		if (direction > 0) {
			// Scrolling right - check if near right edge
			const nearRightEdge = scrollWidth - scrollLeft - clientWidth < this.EDGE_THRESHOLD * 2;
			if (nearRightEdge && !this.is_expanding) {
				// Load more in background (don't await)
				this.expand_right();
			}
		} else {
			// Scrolling left - check if near left edge
			if (scrollLeft < this.EDGE_THRESHOLD * 2 && !this.is_expanding) {
				// Load more in background (don't await)
				this.expand_left();
			}
		}

		// Calculate scroll amount: 7 days worth of columns (or 5 if hiding weekends)
		const days_to_scroll = this.show_weekends ? 7 : 5;
		const scroll_amount = days_to_scroll * this.COLUMN_WIDTH;
		const new_scroll = scrollLeft + (scroll_amount * direction);

		// Smooth scroll
		$tableWrapper[0].scrollTo({
			left: Math.max(0, new_scroll),
			behavior: 'smooth'
		});
	}

	async goto_today() {
		// Reset to initial state based on settings
		await this.load_settings();  // Reload to get correct start date
		this.total_days = this.INITIAL_DAYS;
		this.visible_start_date = '';
		this.visible_end_date = '';
		this.refresh();

		// Scroll to start
		setTimeout(() => {
			const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
			if ($tableWrapper.length) {
				$tableWrapper[0].scrollLeft = 0;
			}
		}, 100);
	}

	/**
	 * Show date picker dialog to jump to a specific date
	 */
	show_date_picker() {
		const self = this;
		const today = frappe.datetime.get_today();

		// Calculate date limits (±1 year)
		const today_obj = frappe.datetime.str_to_obj(today);
		const min_date_obj = new Date(today_obj);
		min_date_obj.setFullYear(min_date_obj.getFullYear() - 1);
		const max_date_obj = new Date(today_obj);
		max_date_obj.setFullYear(max_date_obj.getFullYear() + 1);

		const min_date = frappe.datetime.obj_to_str(min_date_obj);
		const max_date = frappe.datetime.obj_to_str(max_date_obj);

		const d = new frappe.ui.Dialog({
			title: __('Jump to Date'),
			fields: [
				{
					label: __('Start Date'),
					fieldname: 'start_date',
					fieldtype: 'Date',
					default: self.start_date,
					reqd: 1,
					description: __('Select a date to navigate to (±1 year range)')
				}
			],
			primary_action_label: __('Go'),
			primary_action(values) {
				// Validate date is within range
				if (values.start_date < min_date || values.start_date > max_date) {
					frappe.msgprint(__('Please select a date within ±1 year from today'));
					return;
				}
				self.jump_to_date(values.start_date);
				d.hide();
			}
		});
		d.show();
	}

	/**
	 * Jump to a specific date, resetting the view
	 * @param {string} date - Date in YYYY-MM-DD format
	 */
	async jump_to_date(date) {
		// Set new start date (align to Monday of that week)
		this.start_date = this.get_start_of_week(date);
		this.total_days = this.INITIAL_DAYS;
		this.visible_start_date = '';
		this.visible_end_date = '';

		// Clear entries cache to force fresh load
		this.entries = {};

		await this.load_data();
		this.render();

		// Scroll to start
		setTimeout(() => {
			const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
			if ($tableWrapper.length) {
				$tableWrapper[0].scrollLeft = 0;
			}
		}, 100);
	}

	async refresh(preserve_scroll = true) {
		// Show loading indicator only in table area (not full page)
		const $tableWrapper = this.wrapper.find('.roll-call-table-wrapper');
		if ($tableWrapper.length) {
			// Quick refresh - preserve scroll position
			const scrollLeft = preserve_scroll ? $tableWrapper[0].scrollLeft : 0;
			$tableWrapper.css('opacity', '0.5');
			await this.load_data();
			this.render();
			// Restore scroll position after render
			if (preserve_scroll && scrollLeft > 0) {
				const $newWrapper = this.wrapper.find('.roll-call-table-wrapper');
				if ($newWrapper.length) {
					$newWrapper[0].scrollLeft = scrollLeft;
				}
			}
		} else {
			// Initial load
			this.wrapper.html(`<div class="roll-call-loading text-muted">${__('Loading...')}</div>`);
			await this.load_data();
			this.render();
		}
	}
}
