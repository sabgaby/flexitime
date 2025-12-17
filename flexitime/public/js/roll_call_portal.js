/**
 * Roll Call Portal - Website version for employees without Desk access
 *
 * This module provides a simplified Roll Call interface for website users.
 * Users can view everyone's roll call entries but only edit their own.
 *
 * @module roll_call_portal
 */

(function() {
	'use strict';

	// Configuration
	const DAYS_TO_SHOW = 14; // Two weeks
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	/**
	 * RollCallPortal class - Main controller for the portal page
	 */
	class RollCallPortal {
		constructor() {
			this.currentEmployee = window.rollCallPortalData?.currentEmployee;
			this.startDate = this.getMonday(new Date());
			this.showWeekends = false;
			this.entries = {};
			this.employees = [];
			this.presenceTypes = [];
			this.presenceTypesMap = new Map();
			this.selectedCell = null;

			this.init();
		}

		/**
		 * Initialize the portal
		 */
		async init() {
			if (!window.rollCallPortalData?.isLoggedIn) {
				window.location.href = '/login?redirect-to=/roll-call';
				return;
			}

			this.bindEvents();
			await this.loadPresenceTypes();
			await this.loadData();
		}

		/**
		 * Bind DOM events
		 */
		bindEvents() {
			// Navigation buttons
			document.querySelector('.btn-today')?.addEventListener('click', () => this.goToToday());
			document.querySelector('.btn-prev')?.addEventListener('click', () => this.navigateWeek(-1));
			document.querySelector('.btn-next')?.addEventListener('click', () => this.navigateWeek(1));

			// Weekend toggle
			document.querySelector('.show-weekends-check')?.addEventListener('change', (e) => {
				this.showWeekends = e.target.checked;
				this.render();
			});

			// Modal close
			document.querySelector('.presence-modal-backdrop')?.addEventListener('click', () => this.closeModal());
			document.querySelector('.presence-modal .btn-close')?.addEventListener('click', () => this.closeModal());

			// Keyboard navigation
			document.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					this.closeModal();
				}
			});
		}

		/**
		 * Load presence types from server
		 */
		async loadPresenceTypes() {
			try {
				const response = await this.callAPI('frappe.client.get_list', {
					doctype: 'Presence Type',
					fields: ['name', 'label', 'icon', 'category', 'color', 'is_system', 'is_leave', 'available_to_all'],
					order_by: 'sort_order asc',
					limit_page_length: 0
				});

				this.presenceTypes = response || [];
				this.presenceTypesMap = new Map(this.presenceTypes.map(pt => [pt.name, pt]));
				this.renderLegend();
			} catch (error) {
				console.error('Failed to load presence types:', error);
			}
		}

		/**
		 * Load roll call data from server
		 */
		async loadData() {
			this.showLoading(true);

			try {
				const endDate = this.addDays(this.startDate, DAYS_TO_SHOW - 1);

				// Get events using the existing API
				const response = await this.callAPI('flexitime.api.roll_call.get_events', {
					month_start: this.formatDate(this.startDate),
					month_end: this.formatDate(endDate)
				});

				// Process entries
				this.entries = {};
				if (response.entries) {
					for (const [employee, entryList] of Object.entries(response.entries)) {
						for (const entry of entryList) {
							const key = `${employee}|${entry.date}`;
							this.entries[key] = entry;
						}
					}
				}

				// Load employees
				const empResponse = await this.callAPI('frappe.client.get_list', {
					doctype: 'Employee',
					filters: { status: 'Active' },
					fields: ['name', 'employee_name', 'image', 'nickname'],
					order_by: 'employee_name asc',
					limit_page_length: 0
				});

				this.employees = empResponse || [];

				this.render();
			} catch (error) {
				console.error('Failed to load data:', error);
				this.showError('Failed to load roll call data. Please refresh the page.');
			} finally {
				this.showLoading(false);
			}
		}

		/**
		 * Render the roll call grid
		 */
		render() {
			const days = this.getDaysInRange();
			this.updateDateRange(days);
			this.renderHeaders(days);
			this.renderBody(days);

			document.querySelector('.roll-call-grid-container').style.display = 'block';
		}

		/**
		 * Update the date range display
		 */
		updateDateRange(days) {
			const first = days[0];
			const last = days[days.length - 1];
			const rangeText = `${first.day} ${MONTHS[first.month]} - ${last.day} ${MONTHS[last.month]} ${last.year}`;
			document.querySelector('.date-range').textContent = rangeText;
		}

		/**
		 * Render table headers
		 */
		renderHeaders(days) {
			// Month row
			const monthRow = document.querySelector('.roll-call-grid thead .month-row');
			let monthHtml = '<th class="employee-col" rowspan="2">Employee</th>';

			const monthSpans = this.getMonthSpans(days);
			for (const span of monthSpans) {
				monthHtml += `<th colspan="${span.colspan}" class="month-header">${span.month}</th>`;
			}
			monthRow.innerHTML = monthHtml;

			// Day row
			const dayRow = document.querySelector('.roll-call-grid thead .day-row');
			let dayHtml = '';
			const today = this.formatDate(new Date());

			for (const d of days) {
				if (!this.showWeekends && d.isWeekend) continue;

				const classes = ['day-col'];
				if (d.isWeekend) classes.push('weekend');
				if (d.dateStr === today) classes.push('today');

				dayHtml += `
					<th class="${classes.join(' ')}">
						<div class="day-header">
							<span class="weekday">${d.weekday}</span>
							<span class="day-num">${d.day}</span>
						</div>
					</th>
				`;
			}
			dayRow.innerHTML = dayHtml;
		}

		/**
		 * Render table body (employee rows)
		 */
		renderBody(days) {
			const tbody = document.querySelector('.roll-call-grid tbody');
			let html = '';

			for (const emp of this.employees) {
				const isOwn = emp.name === this.currentEmployee;
				const displayName = emp.nickname || emp.employee_name;
				const avatar = emp.image
					? `<img src="${emp.image}" class="avatar-img" alt="${displayName}">`
					: `<span class="avatar-letter">${displayName.charAt(0).toUpperCase()}</span>`;

				let cells = '';
				const today = this.formatDate(new Date());

				for (const d of days) {
					if (!this.showWeekends && d.isWeekend) continue;

					const key = `${emp.name}|${d.dateStr}`;
					const entry = this.entries[key];
					const canEdit = isOwn && !d.isWeekend;
					const isToday = d.dateStr === today;

					const classes = ['day-cell'];
					if (d.isWeekend) classes.push('weekend');
					if (isToday) classes.push('today');
					if (canEdit) classes.push('editable');
					if (entry) classes.push('has-entry');

					let content = '';
					let cellStyle = '';

					if (entry && !d.isWeekend) {
						const pt = this.presenceTypesMap.get(entry.presence_type);
						if (pt) {
							cellStyle = `--presence-color: ${this.getColorVar(pt.color)}`;
							content = `<span class="presence-icon">${pt.icon || ''}</span>`;
						}
					}

					const clickHandler = canEdit
						? `onclick="rollCallPortal.openModal('${emp.name}', '${d.dateStr}')"`
						: '';

					cells += `
						<td class="${classes.join(' ')}" data-employee="${emp.name}" data-date="${d.dateStr}" style="${cellStyle}" ${clickHandler}>
							${content}
						</td>
					`;
				}

				html += `
					<tr class="${isOwn ? 'own-row' : ''}" data-employee="${emp.name}">
						<td class="employee-col">
							<div class="employee-info">
								<div class="employee-avatar">${avatar}</div>
								<span class="employee-name">${displayName}</span>
							</div>
						</td>
						${cells}
					</tr>
				`;
			}

			tbody.innerHTML = html;
		}

		/**
		 * Render the legend
		 */
		renderLegend() {
			const container = document.querySelector('.legend-items');
			if (!container) return;

			let html = '';
			for (const pt of this.presenceTypes) {
				if (pt.is_system) continue; // Skip system types like weekend

				html += `
					<div class="legend-item">
						<span class="legend-icon" style="--presence-color: ${this.getColorVar(pt.color)}">${pt.icon || ''}</span>
						<span class="legend-label">${pt.label || pt.name}</span>
					</div>
				`;
			}
			container.innerHTML = html;
		}

		/**
		 * Open the presence type selector modal
		 */
		openModal(employee, date) {
			if (employee !== this.currentEmployee) {
				return; // Can only edit own entries
			}

			this.selectedCell = { employee, date };

			const modal = document.querySelector('.presence-modal');
			const list = modal.querySelector('.presence-types-list');

			// Build presence type options
			let html = '';
			for (const pt of this.presenceTypes) {
				// Skip system types and leave types (require leave application)
				if (pt.is_system) continue;
				if (pt.is_leave) continue;

				html += `
					<button class="presence-type-option" data-type="${pt.name}" style="--presence-color: ${this.getColorVar(pt.color)}">
						<span class="option-icon">${pt.icon || ''}</span>
						<span class="option-label">${pt.label || pt.name}</span>
					</button>
				`;
			}

			// Add clear option
			html += `
				<button class="presence-type-option clear-option" data-type="">
					<span class="option-icon">-</span>
					<span class="option-label">Clear</span>
				</button>
			`;

			list.innerHTML = html;

			// Bind click events
			list.querySelectorAll('.presence-type-option').forEach(btn => {
				btn.addEventListener('click', () => {
					this.selectPresenceType(btn.dataset.type);
				});
			});

			modal.style.display = 'flex';
		}

		/**
		 * Close the modal
		 */
		closeModal() {
			document.querySelector('.presence-modal').style.display = 'none';
			this.selectedCell = null;
		}

		/**
		 * Select a presence type and save
		 */
		async selectPresenceType(presenceType) {
			if (!this.selectedCell) return;

			const { employee, date } = this.selectedCell;
			this.closeModal();

			try {
				if (presenceType) {
					// Save entry
					await this.callAPI('flexitime.api.roll_call.save_entry', {
						employee: employee,
						date: date,
						presence_type: presenceType,
						is_half_day: false
					});
				} else {
					// Delete entry
					await this.callAPI('flexitime.api.roll_call.delete_bulk_entries', {
						entries: JSON.stringify([{ employee, date }])
					});
				}

				// Reload data
				await this.loadData();
			} catch (error) {
				console.error('Failed to save entry:', error);
				this.showError('Failed to save. Please try again.');
			}
		}

		/**
		 * Navigate to today
		 */
		goToToday() {
			this.startDate = this.getMonday(new Date());
			this.loadData();
		}

		/**
		 * Navigate weeks forward or backward
		 */
		navigateWeek(direction) {
			this.startDate = this.addDays(this.startDate, direction * 7);
			this.loadData();
		}

		// ============================================
		// Utility Methods
		// ============================================

		/**
		 * Get array of day objects for the current range
		 */
		getDaysInRange() {
			const days = [];
			for (let i = 0; i < DAYS_TO_SHOW; i++) {
				const date = this.addDays(this.startDate, i);
				const dayOfWeek = date.getDay();
				const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

				days.push({
					date: date,
					dateStr: this.formatDate(date),
					day: date.getDate(),
					month: date.getMonth(),
					year: date.getFullYear(),
					weekday: WEEKDAYS[dayOfWeek === 0 ? 6 : dayOfWeek - 1],
					isWeekend: isWeekend,
					isMonday: dayOfWeek === 1,
					isSunday: dayOfWeek === 0
				});
			}
			return days;
		}

		/**
		 * Calculate month spans for header
		 */
		getMonthSpans(days) {
			const spans = [];
			let currentMonth = null;
			let currentSpan = null;

			for (const d of days) {
				if (!this.showWeekends && d.isWeekend) continue;

				const monthKey = `${d.year}-${d.month}`;
				if (monthKey !== currentMonth) {
					if (currentSpan) spans.push(currentSpan);
					currentMonth = monthKey;
					currentSpan = {
						month: `${MONTHS[d.month]} ${d.year}`,
						colspan: 1
					};
				} else {
					currentSpan.colspan++;
				}
			}
			if (currentSpan) spans.push(currentSpan);
			return spans;
		}

		/**
		 * Get Monday of the week containing the given date
		 */
		getMonday(date) {
			const d = new Date(date);
			const day = d.getDay();
			const diff = d.getDate() - day + (day === 0 ? -6 : 1);
			return new Date(d.setDate(diff));
		}

		/**
		 * Add days to a date
		 */
		addDays(date, days) {
			const result = new Date(date);
			result.setDate(result.getDate() + days);
			return result;
		}

		/**
		 * Format date as YYYY-MM-DD
		 */
		formatDate(date) {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return `${year}-${month}-${day}`;
		}

		/**
		 * Convert color name to CSS variable or hex
		 */
		getColorVar(color) {
			if (!color) return '#e5e7eb';
			if (color.startsWith('#') || color.startsWith('rgb')) return color;

			// Map common color names to CSS variables or hex
			const colorMap = {
				'blue': '#3b82f6',
				'green': '#22c55e',
				'red': '#ef4444',
				'orange': '#f97316',
				'yellow': '#eab308',
				'purple': '#a855f7',
				'pink': '#ec4899',
				'gray': '#6b7280',
				'cyan': '#06b6d4',
				'indigo': '#6366f1'
			};

			return colorMap[color.toLowerCase()] || color;
		}

		/**
		 * Make API call to Frappe
		 */
		async callAPI(method, args = {}) {
			const response = await fetch('/api/method/' + method, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Frappe-CSRF-Token': window.rollCallPortalData?.csrfToken || frappe?.csrf_token || ''
				},
				body: JSON.stringify(args)
			});

			if (!response.ok) {
				throw new Error(`API call failed: ${response.status}`);
			}

			const data = await response.json();
			return data.message;
		}

		/**
		 * Show/hide loading state
		 */
		showLoading(show) {
			const loading = document.querySelector('.loading-state');
			const grid = document.querySelector('.roll-call-grid-container');

			if (show) {
				loading.style.display = 'flex';
				grid.style.display = 'none';
			} else {
				loading.style.display = 'none';
			}
		}

		/**
		 * Show error message
		 */
		showError(message) {
			// Simple alert for now - could be enhanced with a toast notification
			alert(message);
		}
	}

	// Initialize when DOM is ready
	document.addEventListener('DOMContentLoaded', () => {
		window.rollCallPortal = new RollCallPortal();
	});
})();
