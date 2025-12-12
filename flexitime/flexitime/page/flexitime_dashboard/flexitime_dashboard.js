frappe.pages['flexitime-dashboard'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Flexitime Dashboard',
		single_column: true
	});

	page.add_inner_button(__('Refresh'), () => {
		page.dashboard.load_data();
	});

	page.dashboard = new FlexitimeDashboard(page);
};

frappe.pages['flexitime-dashboard'].refresh = function(wrapper) {
	const page = wrapper.page;
	if (page.dashboard) {
		page.dashboard.load_data();
	}
};

class FlexitimeDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.make();
	}

	make() {
		this.wrapper.html(`
			<div class="flexitime-dashboard">
				<div class="number-cards-container mb-4"></div>
				<div class="chart-container mb-4"></div>
				<div class="row mb-4">
					<div class="col-md-6">
						<div class="frappe-card leave-planning-summary">
							<div class="card-head">
								<span class="card-head-title">${__('Leave Planning Summary')}</span>
								<span class="card-head-subtitle text-muted ml-2">${new Date().getFullYear()}</span>
							</div>
							<div class="card-body section-content"></div>
						</div>
					</div>
					<div class="col-md-6">
						<div class="frappe-card balance-alerts">
							<div class="card-head">
								<span class="card-head-title">${__('Balance Alerts')}</span>
							</div>
							<div class="card-body section-content"></div>
						</div>
					</div>
				</div>
				<div class="row mb-4">
					<div class="col-md-6">
						<div class="frappe-card missing-roll-call">
							<div class="card-head">
								<span class="card-head-title">${__('Missing Roll Call - Next Week')}</span>
							</div>
							<div class="card-body section-content"></div>
						</div>
					</div>
					<div class="col-md-6">
						<div class="frappe-card missing-timesheets">
							<div class="card-head">
								<span class="card-head-title">${__('Missing Timesheets')}</span>
							</div>
							<div class="card-body section-content"></div>
						</div>
					</div>
				</div>
			</div>
		`);

		this.load_data();
	}

	async load_data() {
		frappe.show_progress(__('Loading'), 20, 100);

		try {
			await Promise.all([
				this.load_number_cards(),
				this.load_today_chart(),
				this.load_leave_planning_summary(),
				this.load_balance_alerts(),
				this.load_missing_roll_call(),
				this.load_missing_timesheets()
			]);

			frappe.hide_progress();
		} catch (error) {
			frappe.hide_progress();
			console.error('Dashboard error:', error);
			frappe.msgprint(__('Error loading dashboard: ') + error.message);
		}
	}

	async load_number_cards() {
		const today = frappe.datetime.get_today();

		const result = await frappe.call({
			method: 'flexitime.flexitime.api.get_today_overview',
			args: { date: today }
		});

		const data = result.message || {};
		const container = this.wrapper.find('.number-cards-container');
		container.empty();

		// Create a row for number cards
		const row = $('<div class="row"></div>').appendTo(container);

		// Calculate totals for each category
		let totalWorking = 0;
		let totalLeave = 0;
		let totalOther = 0;

		const cardConfig = {
			'Office': { color: 'blue', icon: 'building' },
			'Home Office': { color: 'green', icon: 'home' },
			'Working Offsite': { color: 'purple', icon: 'globe' },
			'Vacation': { color: 'orange', icon: 'sun' },
			'Sick Leave': { color: 'red', icon: 'thermometer' },
			'Day Off': { color: 'grey', icon: 'moon' }
		};

		// Sum up totals
		Object.entries(data).forEach(([type, count]) => {
			if (['Office', 'Home Office', 'Working Offsite'].includes(type)) {
				totalWorking += count;
			} else if (['Vacation', 'Sick Leave'].includes(type)) {
				totalLeave += count;
			} else {
				totalOther += count;
			}
		});

		// Create summary number cards using frappe's native style
		const cards = [
			{ label: __('Working Today'), value: totalWorking, color: 'green' },
			{ label: __('On Leave'), value: totalLeave, color: 'orange' },
			{ label: __('Day Off/Other'), value: totalOther, color: 'grey' }
		];

		cards.forEach(card => {
			const col = $(`
				<div class="col-md-4 col-sm-6 mb-3">
					<div class="number-card" style="border-left: 3px solid var(--${card.color});">
						<div class="number-card-value">${card.value}</div>
						<div class="number-card-label">${card.label}</div>
					</div>
				</div>
			`).appendTo(row);
		});

		// Add today's date header
		container.prepend(`
			<div class="mb-3">
				<h5 class="text-muted">${__("Today's Overview")} - ${frappe.datetime.str_to_user(today)}</h5>
			</div>
		`);
	}

	async load_today_chart() {
		const today = frappe.datetime.get_today();

		const result = await frappe.call({
			method: 'flexitime.flexitime.api.get_today_overview',
			args: { date: today }
		});

		const data = result.message || {};
		const container = this.wrapper.find('.chart-container');
		container.empty();

		if (Object.keys(data).length === 0) {
			container.html(`<p class="text-muted text-center">${__('No roll call data for today')}</p>`);
			return;
		}

		// Create chart wrapper
		const chartWrapper = $('<div class="frappe-card"><div class="card-head"><span class="card-head-title">' + __('Presence Distribution') + '</span></div><div class="card-body"><div id="presence-chart"></div></div></div>').appendTo(container);

		// Prepare data for Frappe Chart
		const labels = Object.keys(data);
		const values = Object.values(data);

		const colors = {
			'Office': '#5e64ff',
			'Home Office': '#29cd42',
			'Working Offsite': '#7c3aed',
			'Vacation': '#ffa00a',
			'Sick Leave': '#ff5858',
			'Day Off': '#8d99a6'
		};

		const chartColors = labels.map(label => colors[label] || '#8d99a6');

		// Use Frappe's native chart
		new frappe.Chart('#presence-chart', {
			data: {
				labels: labels,
				datasets: [{
					values: values
				}]
			},
			type: 'bar',
			height: 200,
			colors: chartColors,
			barOptions: {
				spaceRatio: 0.5
			},
			axisOptions: {
				xAxisMode: 'tick',
				xIsSeries: false
			},
			tooltipOptions: {
				formatTooltipY: d => d + ' ' + __('employees')
			}
		});
	}

	async load_leave_planning_summary() {
		const result = await frappe.call({
			method: 'flexitime.api.roll_call.get_leave_planning_summary',
			args: {
				year: new Date().getFullYear().toString(),
				employee_filter: 'managed'
			}
		});

		const data = result.message || {};
		const container = this.wrapper.find('.leave-planning-summary .section-content');

		const tentative = data.tentative || { total_days: 0, employee_count: 0, by_employee: [] };
		const pending = data.pending_approval || { count: 0, applications: [] };
		const conflicts = data.conflicts || [];

		// Build summary cards
		let html = `
			<div class="row mb-3">
				<div class="col-4 text-center">
					<div class="summary-stat">
						<div class="stat-value text-warning">${tentative.total_days}</div>
						<div class="stat-label text-muted small">${__('Tentative Days')}</div>
					</div>
				</div>
				<div class="col-4 text-center">
					<div class="summary-stat">
						<div class="stat-value text-primary">${pending.count}</div>
						<div class="stat-label text-muted small">${__('Pending Approval')}</div>
					</div>
				</div>
				<div class="col-4 text-center">
					<div class="summary-stat">
						<div class="stat-value ${conflicts.length > 0 ? 'text-danger' : 'text-success'}">${conflicts.length}</div>
						<div class="stat-label text-muted small">${__('Conflicts')}</div>
					</div>
				</div>
			</div>`;

		// Pending approvals section
		if (pending.applications.length > 0) {
			html += `
				<div class="subsection mb-3">
					<div class="subsection-title text-muted small mb-2">${__('Pending Approvals')}</div>
					<div class="list-group list-group-flush">`;

			pending.applications.slice(0, 5).forEach(leave => {
				html += `
					<div class="list-group-item d-flex justify-content-between align-items-center px-0 py-2">
						<div>
							<strong>${leave.employee_name}</strong>
							<div class="text-muted small">
								${leave.leave_type} · ${frappe.datetime.str_to_user(leave.from_date)} - ${frappe.datetime.str_to_user(leave.to_date)}
								<span class="badge badge-secondary ml-1">${leave.days} ${__('days')}</span>
							</div>
						</div>
						<a href="/app/leave-application/${leave.name}" class="btn btn-xs btn-primary">${__('Review')}</a>
					</div>`;
			});

			html += `</div></div>`;
		}

		// Conflicts section
		if (conflicts.length > 0) {
			html += `
				<div class="subsection mb-3">
					<div class="subsection-title text-muted small mb-2">
						<span class="indicator-pill red">${__('Conflicts')}</span>
					</div>
					<div class="list-group list-group-flush">`;

			conflicts.slice(0, 3).forEach(conflict => {
				const employeeNames = conflict.employees.map(e => e.employee_name).join(', ');
				html += `
					<div class="list-group-item px-0 py-2">
						<div class="d-flex justify-content-between align-items-center">
							<strong>${frappe.datetime.str_to_user(conflict.date)}</strong>
							<span class="badge badge-danger">${conflict.count} ${__('people')}</span>
						</div>
						<div class="text-muted small">${employeeNames}</div>
					</div>`;
			});

			html += `</div></div>`;
		}

		// Tentative section (employees planning leave)
		if (tentative.by_employee.length > 0) {
			html += `
				<div class="subsection">
					<div class="subsection-title text-muted small mb-2">${__('Planning Leave')} (${tentative.employee_count} ${__('employees')})</div>
					<div class="list-group list-group-flush">`;

			tentative.by_employee.slice(0, 5).forEach(emp => {
				const rangeText = emp.date_ranges.map(r =>
					r.from_date === r.to_date
						? frappe.datetime.str_to_user(r.from_date)
						: `${frappe.datetime.str_to_user(r.from_date)} - ${frappe.datetime.str_to_user(r.to_date)}`
				).join(', ');

				html += `
					<div class="list-group-item d-flex justify-content-between align-items-center px-0 py-2">
						<div>
							<strong>${emp.employee_name}</strong>
							<div class="text-muted small">${rangeText}</div>
						</div>
						<span class="badge badge-warning">${emp.days} ${__('days')}</span>
					</div>`;
			});

			html += `</div></div>`;
		}

		// Empty state
		if (tentative.total_days === 0 && pending.count === 0 && conflicts.length === 0) {
			html = `<p class="text-muted text-center">${__('No leave planning activity')} ✓</p>`;
		}

		container.html(html);
	}

	async load_balance_alerts() {
		const result = await frappe.call({
			method: 'flexitime.flexitime.api.get_balance_alerts'
		});

		const alerts = result.message || [];
		const container = this.wrapper.find('.balance-alerts .section-content');

		if (alerts.length === 0) {
			container.html(`<p class="text-muted">${__('No balance alerts')}</p>`);
			return;
		}

		let html = `<div class="list-group list-group-flush">`;

		alerts.forEach(alert => {
			const indicatorClass = alert.status === 'over' ? 'red' : 'orange';
			const statusText = alert.status === 'over' ? __('Over Limit') : __('Warning');
			const balanceSign = alert.balance >= 0 ? '+' : '';

			html += `
				<div class="list-group-item d-flex justify-content-between align-items-center px-0">
					<div>
						<a href="/app/employee/${alert.employee}"><strong>${alert.employee_name}</strong></a>
						<div class="text-muted small">
							${__('Balance')}: ${balanceSign}${alert.balance.toFixed(1)}h · ${__('Limit')}: ±${alert.limit.toFixed(1)}h
						</div>
					</div>
					<span class="indicator-pill ${indicatorClass}">${statusText}</span>
				</div>`;
		});

		html += `</div>`;
		container.html(html);
	}

	async load_missing_roll_call() {
		const result = await frappe.call({
			method: 'flexitime.flexitime.api.get_missing_roll_call_next_week'
		});

		const missing = result.message || [];
		const container = this.wrapper.find('.missing-roll-call .section-content');

		if (missing.length === 0) {
			container.html(`<p class="text-muted">${__('All roll calls filled for next week')} ✓</p>`);
			return;
		}

		let html = `
			<div class="mb-2 text-right">
				<button class="btn btn-xs btn-default send-all-reminders" data-type="roll-call">
					${__('Send All Reminders')}
				</button>
			</div>
			<div class="list-group list-group-flush">`;

		missing.forEach(emp => {
			html += `
				<div class="list-group-item d-flex justify-content-between align-items-center px-0">
					<div>
						<strong>${emp.employee_name}</strong>
						<div class="text-muted small">${__('Missing')}: ${emp.missing_days.join(', ')}</div>
					</div>
					<button class="btn btn-xs btn-default send-reminder" data-employee="${emp.employee}" data-type="roll-call">
						${__('Remind')}
					</button>
				</div>`;
		});

		html += `</div>`;
		container.html(html);

		this.bind_reminder_buttons();
	}

	async load_missing_timesheets() {
		const result = await frappe.call({
			method: 'flexitime.flexitime.api.get_missing_timesheets'
		});

		const missing = result.message || [];
		const container = this.wrapper.find('.missing-timesheets .section-content');

		if (missing.length === 0) {
			container.html(`<p class="text-muted">${__('All timesheets submitted')} ✓</p>`);
			return;
		}

		let html = `
			<div class="mb-2 text-right">
				<button class="btn btn-xs btn-default send-all-reminders" data-type="timesheet">
					${__('Send All Reminders')}
				</button>
			</div>
			<div class="list-group list-group-flush">`;

		missing.forEach(entry => {
			const statusClass = entry.status === 'Not Created' ? 'red' : 'orange';

			html += `
				<div class="list-group-item d-flex justify-content-between align-items-center px-0">
					<div>
						<strong>${entry.employee_name}</strong>
						<div class="text-muted small">
							${__('Week')}: ${frappe.datetime.str_to_user(entry.week_start)} ·
							<span class="indicator-pill ${statusClass}">${entry.status}</span>
							· ${entry.hours_logged || 0}/${entry.expected_hours || 40}h
						</div>
					</div>
					<button class="btn btn-xs btn-default send-reminder" data-employee="${entry.employee}" data-type="timesheet">
						${__('Remind')}
					</button>
				</div>`;
		});

		html += `</div>`;
		container.html(html);

		this.bind_reminder_buttons();
	}

	bind_reminder_buttons() {
		this.wrapper.find('.send-reminder').off('click').on('click', async (e) => {
			const btn = $(e.currentTarget);
			const employee = btn.data('employee');
			const type = btn.data('type');

			btn.prop('disabled', true);

			try {
				await frappe.call({
					method: 'flexitime.flexitime.api.send_reminder',
					args: { employee, reminder_type: type }
				});

				frappe.show_alert({
					message: __('Reminder sent'),
					indicator: 'green'
				});
			} catch (error) {
				frappe.msgprint(__('Failed to send reminder'));
			}

			btn.prop('disabled', false);
		});

		this.wrapper.find('.send-all-reminders').off('click').on('click', async (e) => {
			const btn = $(e.currentTarget);
			const type = btn.data('type');

			btn.prop('disabled', true);

			try {
				await frappe.call({
					method: 'flexitime.flexitime.api.send_all_reminders',
					args: { reminder_type: type }
				});

				frappe.show_alert({
					message: __('Reminders sent'),
					indicator: 'green'
				});
			} catch (error) {
				frappe.msgprint(__('Failed to send reminders'));
			}

			btn.prop('disabled', false);
		});
	}
}
