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
		this.palette_groups = [];  // Palette groups configuration
		this.entries = {};
		this.pending_leaves = {};  // Open leave applications not yet approved
		this.employees = [];
		this.employees_map = new Map();  // O(1) lookup cache
		this.is_hr_manager = frappe.user_roles.includes('HR Manager') || frappe.user_roles.includes('HR User');
		this.can_edit_all = false;  // Whether user can edit all employees (HR)
		this.editable_employees = new Set();  // Set of employee IDs user can edit
		this.current_employee = null;
		this.show_weekends = false;  // Default to hiding weekends

		// Selection state is now managed by SelectionManager

		// Clipboard is now managed by ClipboardManager

		// Keyboard focus
		this.focused_cell = null;  // {employee, date}


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

		// Leave suggestions optimization
		this._suggestions_dirty = true;
		this._suggestions_cache = null;
		this._suggestion_update_timer = null;

		// Cell element cache for O(1) DOM lookups
		this.cell_element_map = new Map();  // "employee|date" -> DOM element

		// Render debouncing for rapid updates
		this._render_debounce_timer = null;
		this._pending_render = false;

		// Undo stack for reverting operations
		// Format: [{ action: 'apply'|'paste'|'delete'|'split', entries: [{employee, date, previous_state}] }]
		// Undo stack is now managed by UndoManager

		// Initialize dialogs and palette modules (modules are guaranteed to be loaded by page handler)
		this.initialize_modules();

		this.setup();
	}

	/**
	 * Throttle utility with leading and trailing edge support
	 */
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

	/**
	 * Initialize dialog and palette modules
	 * Modules are guaranteed to be loaded by the page handler before this is called
	 */
	initialize_modules() {
		// Initialize grid renderer
		this.grid = new window.FlexitimeRollCall.GridRenderer(this);
		
		// Initialize selection manager
		this.selection = new window.FlexitimeRollCall.SelectionManager(this);
		
		// Initialize event manager
		this.events = new window.FlexitimeRollCall.EventManager(this);
		
		// Initialize data manager
		this.data = new window.FlexitimeRollCall.DataManager(this);
		
		// Initialize clipboard manager
		this.clipboard = new window.FlexitimeRollCall.ClipboardManager(this);
		
		// Initialize undo manager
		this.undo = new window.FlexitimeRollCall.UndoManager(this);

		// Initialize dialogs
		this.dialogs = {
			presence: new window.FlexitimeRollCall.PresenceDialog(this),
			leave: new window.FlexitimeRollCall.LeaveDialogs(this),
			bulk: new window.FlexitimeRollCall.BulkDialog(this)
		};

		// Initialize palette renderer
		this.palette = new window.FlexitimeRollCall.PaletteRenderer(this);
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

		// Load editable employees (permissions)
		await this.load_editable_employees();

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
			const start_day_setting = result.message?.roll_call_start_day || 'Current Day';
			this.display_name_format = result.message?.roll_call_display_name || 'Full Name';

			if (start_day_setting === 'Start of Week') {
				// Get Monday of current week using shared utility
				const DateUtils = window.FlexitimeDateUtils || {};
				const getMonday = DateUtils.getMondayOfWeek || this.get_start_of_week.bind(this);
				this.start_date = getMonday ? getMonday(frappe.datetime.get_today(), true) : this.get_start_of_week(frappe.datetime.get_today());
			} else {
				// Default: Current Day
				this.start_date = frappe.datetime.get_today();
			}

			// Load palette groups configuration
			try {
				const palette_result = await frappe.call({
					method: 'flexitime.flexitime.doctype.flexitime_settings.flexitime_settings.get_palette_groups'
				});
				this.palette_groups = palette_result.message || [];
			} catch (e) {
				// If palette groups can't be loaded, use empty array
				this.palette_groups = [];
			}
		} catch (e) {
			// Use defaults if settings not found
			this.start_date = frappe.datetime.get_today();
			this.display_name_format = 'Full Name';
			this.palette_groups = [];
		}
	}

	async load_editable_employees() {
		try {
			const result = await frappe.call({
				method: 'flexitime.api.roll_call.get_editable_employees'
			});
			if (result.message) {
				this.can_edit_all = result.message.can_edit_all || false;
				this.editable_employees = new Set(result.message.editable_employees || []);
			}
		} catch (e) {
			// Fall back to only allowing own entries
			this.can_edit_all = false;
			this.editable_employees = new Set();
			if (this.current_employee) {
				this.editable_employees.add(this.current_employee);
			}
		}
	}

	/**
	 * Check if current user can edit entries for a given employee
	 * @param {string} employee_id - The employee ID to check
	 * @returns {boolean} True if user can edit this employee's entries
	 */
	can_edit_employee(employee_id) {
		if (this.can_edit_all) return true;
		return this.editable_employees.has(employee_id);
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
		// @deprecated Use window.FlexitimeDateUtils.getMondayOfWeek() instead
		const DateUtils = window.FlexitimeDateUtils;
		if (DateUtils && DateUtils.getMondayOfWeek) {
			return DateUtils.getMondayOfWeek(date_str, true);
		}
		// Fallback implementation
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
					fields: ['name', 'label', 'icon', 'expect_work_hours', 'color', 'requires_leave_application', 'leave_type', 'available_to_all'],
					filters: {},
					order_by: 'sort_order asc',
					limit_page_length: 0
				}
			});
			this.presence_types = result.message || [];

			// Get selectable types for current employee to mark palette items
			let selectable_names = new Set();
			if (this.current_employee) {
				const selectable_result = await frappe.call({
					method: 'flexitime.flexitime.doctype.presence_type.presence_type.get_available_presence_types',
					args: { employee: this.current_employee, date: frappe.datetime.get_today() }
				});
				const selectable_types = selectable_result.message || [];
				selectable_names = new Set(selectable_types.map(t => t.name));
			} else {
				// Non-employee users can only select available_to_all types
				selectable_names = new Set(this.presence_types.filter(t => t.available_to_all).map(t => t.name));
			}

			// Mark each type as selectable or not
			this.presence_types.forEach(pt => {
				pt.selectable = selectable_names.has(pt.name);
			});

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
			// Return all types - will be filtered by employee permissions
			return this.presence_types;
		}
		// For cross-employee bulk operations, only show available_to_all types
		return this.presence_types.filter(t => t.available_to_all);
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
	// @deprecated Use window.FlexitimeColorUtils.getPresenceColor() instead
	get_color_var(color) {
		const ColorUtils = window.FlexitimeColorUtils;
		if (ColorUtils && ColorUtils.getPresenceColor) {
			// Desk version: prefer Frappe CSS variables for light/dark mode support
			return ColorUtils.getPresenceColor(color, true);
		}
		// Fallback implementation
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
		// Calculate colspan for each month (no separator columns - just thick borders)
		const spans = [];
		let current_month = null;
		let count = 0;

		for (let i = 0; i < days.length; i++) {
			const day = days[i];

			// Skip weekends when hidden
			if (!this.show_weekends && day.is_weekend) continue;

			// No separator columns - just count the actual day columns
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
		// Count visible columns (no separator columns - just thick borders)
		let count = 0;

		for (let i = 0; i < days.length; i++) {
			const d = days[i];
			if (!this.show_weekends && d.is_weekend) continue;
			count++;
		}
		return count;
	}

	getVisibleDateRange() {
		// Show the visible date range (updated dynamically on scroll)
		const start = this.visible_start_date || this.start_date;
		const end = this.visible_end_date || this.get_end_date();

		// Use shared date utility for consistent formatting
		const DateUtils = window.FlexitimeDateUtils;
		if (DateUtils && DateUtils.formatDateRange) {
			return DateUtils.formatDateRange(start, end, true);
		}

		// Fallback implementation
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

	/**
	 * Debounced render - batches rapid render calls
	 */
	render_debounced() {
		return this.grid.render_debounced();
	}

	render() {
		return this.grid.render();
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

		this.events.bind_suggestion_events();
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
			if (pt.requires_leave_application) {
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

	// Wrapper method for backwards compatibility - delegate to palette module
	render_palette() {
		return this.palette.render();
	}

	render_legend() {
		// Keep for backwards compatibility - now just calls render_palette
		return this.render_palette();
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


	// ========================================
	// PALETTE BAR METHODS
	// ========================================

	/**
	 * Bind events for the palette bar
	 * NOTE: This method is deprecated - use this.events.bind_palette_events() instead
	 * Keeping for backwards compatibility but it now just delegates to EventManager
	 */
	bind_palette_events() {
		// Delegate to EventManager to avoid duplicate event handlers
		this.events.bind_palette_events();
	}

	/**
	 * Apply presence type to selected cells (no paint mode - selection first)
	 */
	select_palette_type(type) {
		// Only apply if there are selected cells
		if (this.selection.selected_cells.size > 0) {
				this.data.apply_to_selection(type);
		} else {
			// No cells selected - show hint
			frappe.show_alert({ message: __('Select cells first, then click a type to apply'), indicator: 'blue' });
		}
	}

	/**
	 * Enter split mode (for AM/PM entries)
	 */
	enter_split_mode() {
		this.palette_mode = 'split';
		this.split_am_type = null;
		this.split_pm_type = null;

		// Store selected cells for split mode (in case something clears them)
		this.split_selected_cells = new Set(this.selection.selected_cells);

		// Show split palette, hide normal palette
		const $normalPalette = this.wrapper.find('.palette-normal');
		const $splitPalette = this.wrapper.find('.palette-split-mode');

		$normalPalette.hide();
		$splitPalette.css('display', 'flex');
		this.wrapper.find('.palette-split-item').removeClass('active');

		// Update table mode
		this.wrapper.find('.roll-call-table').addClass('split-mode');
		this.update_status_bar();
	}

	/**
	 * Select a type in split mode (AM or PM)
	 */
	select_split_type(type, half) {
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

		// AUTO-APPLY: When both selected AND cells are selected, apply immediately
		if (this.split_am_type && this.split_pm_type) {
			if (this.selection.selected_cells.size > 0) {
				// Apply to selection immediately
				this.data.apply_split_to_selection();
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
		this.split_selected_cells = null;  // Clear stored cells

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

	/**
	 * Clear all cells in current selection
	 */
	clear_selection_cells() {
		if (this.selection.selected_cells.size === 0) return;

		let cleared = 0;
		let skipped = 0;

		for (const key of this.selection.selected_cells) {
			const [employee, date] = key.split('|');
			const result = this.data.clear_cell(employee, date);
			if (result.skipped) {
				skipped++;
			} else {
				cleared++;
			}
		}

		// Clear selection and exit clear mode after clearing
		this.selection.clear_selection();
		this.exit_paint_mode();
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
			to_date: to_date
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
		// Use shared DateRangeCalculator utility
		const DateRangeUtils = window.FlexitimeRollCallUtils;
		if (DateRangeUtils && DateRangeUtils.formatDateRangeForDialog) {
			return DateRangeUtils.formatDateRangeForDialog(from_date, to_date, days, true);
		}
		// Fallback implementation
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
	// Wrapper methods for backwards compatibility - delegate to dialog modules
	show_create_leave_dialog() {
		this.dialogs.leave.showCreate();
	}

	show_view_leave_dialog() {
		this.dialogs.leave.showView();
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

		const info = this.selection.get_selection_info();

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
					<button type="button" class="btn btn-xs btn-link status-action btn-create-leave-from-status" data-presence-type="${entry.presence_type}" data-from-date="${range.from_date}" data-to-date="${range.to_date}" style="padding: 0; text-decoration: none; color: var(--primary);">
						📝 ${__('Create Leave App')}: ${dateRangeLabel}
					</button>
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
				const pt = [...info.presenceTypes][0];
				statusParts.push(`<span class="status-separator">│</span>`);
				statusParts.push(`
					<button type="button" class="btn btn-xs btn-link status-action btn-create-leave-from-status" data-presence-type="${pt}" data-from-date="${firstDate}" data-to-date="${lastDate}" style="padding: 0; text-decoration: none; color: var(--primary);">
						📝 ${__('Create Leave App')}: ${frappe.datetime.str_to_user(firstDate)} - ${frappe.datetime.str_to_user(lastDate)}
					</button>
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
	 * Navigate cells with arrow keys
	 */
	navigate_cells(direction, extend_selection = false) {
		// Get current focus point (last selected cell or first visible editable cell)
		let current_key = null;
		if (this.selection.selected_cells.size > 0) {
			current_key = Array.from(this.selection.selected_cells).pop();
		}

		if (!current_key) {
			// Select first editable cell
			const $first = this.wrapper.find('.day-cell.editable:not(.weekend):first');
			if ($first.length) {
				this.selection.select_cell($first);
			}
			return;
		}

		const [employee, date] = current_key.split('|');
		const $current_cell = this.get_cell_element(employee, date);
		const coords = this.selection.get_cell_coords($current_cell);
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
			this.selection.select_cell($new_cell);
		} else {
			// Arrow: move selection
			this.selection.clear_selection();
			this.selection.select_cell($new_cell);
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

	// Clipboard methods moved to ClipboardManager

	/**
	 * Delete selected cells
	 */

	// ========================================
	// UNDO FUNCTIONALITY
	// ========================================

	// Undo methods moved to UndoManager

	show_bulk_presence_dialog() {
		this.dialogs.bulk.show();
	}

	// Wrapper methods for backwards compatibility - delegate to dialog modules
	async show_leave_info_dialog(employee, date, employee_name, existing, leave_side) {
		return this.dialogs.leave.showInfo(employee, date, employee_name, existing, leave_side);
	}

	show_pending_leave_dialog(employee, date, employee_name, pending_leave) {
		this.dialogs.leave.showPending(employee, date, employee_name, pending_leave);
	}

	async show_presence_dialog(employee, date, employee_name) {
		return this.dialogs.presence.show(employee, date, employee_name);
	}

	// Old method implementation removed - now using modules above
	// Keeping this comment for reference:
	/*
	async show_leave_info_dialog_OLD(employee, date, employee_name, existing, leave_side) {
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
			const all_working = available_types.filter(t => t.expect_work_hours === 1);
			const all_not_working = available_types.filter(t => t.expect_work_hours === 0);

			const editable_type = leave_side === 'am' ? existing?.pm_presence_type : existing?.am_presence_type;

			const make_options = (types, selected_type) => types.map(pt => `
				<div class="presence-option ${selected_type === pt.name ? 'selected' : ''}"
					 data-type="${pt.name}"
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
					<div class="options-row">
						${make_options(all_working, editable_type)}
					</div>
				</div>
				<div class="options-divider-sm"></div>
				<div class="options-section not-working-section">
					<div class="options-row">
						${make_options(all_not_working, editable_type)}
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
					await self.data.save_split_entry(employee, date, locked_type, selected_type);
				} else {
					await self.data.save_split_entry(employee, date, selected_type, locked_type);
				}
			});
		}

		d.show();
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
			await this.data.load_data();
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
			await this.data.load_data();
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
		// Use shared utility for getting Monday of week
		const DateUtils = window.FlexitimeDateUtils || {};
		const getMonday = DateUtils.getMondayOfWeek || this.get_start_of_week.bind(this);
		this.start_date = getMonday ? getMonday(date, true) : this.get_start_of_week(date);
		this.total_days = this.INITIAL_DAYS;
		this.visible_start_date = '';
		this.visible_end_date = '';

		// Clear entries cache to force fresh load
		this.entries = {};

		await this.data.load_data();
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
			await this.data.load_data();
			this.render();
			this.build_element_map();
			// Only rebind events if not already bound (events use delegation, so rebinding is safe but unnecessary)
			// Just rebind suggestion events which are dynamically created
			this.bind_suggestion_events();
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
			await this.data.load_data();
			this.render();
			this.build_element_map();
			this.events.bind_events();
			this.events.bind_palette_events();
		}
		$tableWrapper.css('opacity', '1');
	}
}
