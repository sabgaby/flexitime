/**
 * Leave Dialogs Module
 * Handles all leave-related dialogs: create, view, info, and pending
 */
(function() {
	'use strict';

	class LeaveDialogs {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		showCreate() {
			const suggestions = this.rollCall.detect_leave_suggestions();
			if (!suggestions.length) {
				frappe.show_alert({ message: __('No leave applications needed'), indicator: 'green' });
				return;
			}

			const self = this;

			const items_html = suggestions.map(s => {
				const pt = this.rollCall.presence_types_map.get(s.presence_type);
				const icon = pt?.icon || '';
				const label = pt?.label || s.presence_type;
				const date_str = this.rollCall.format_date_range(s.from_date, s.to_date, s.days);

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
				self.rollCall.create_leave_application(presence_type, from_date, to_date);
			});

			d.show();
		}

		showView() {
			const apps = this.rollCall.detect_open_leave_applications();
			if (!apps.length) {
				frappe.show_alert({ message: __('No open leave applications'), indicator: 'green' });
				return;
			}

			const items_html = apps.map(app => {
				const date_str = this.rollCall.format_date_range(app.from_date, app.to_date, app.days);

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

		async showInfo(employee, date, employee_name, existing, leave_side) {
			// Format date nicely: "Tue, 9 Dec"
			const date_obj = frappe.datetime.str_to_obj(date);
			const formatted_date = date_obj.toLocaleDateString('en-US', {
				weekday: 'short',
				day: 'numeric',
				month: 'short'
			});

			// Helper to get presence type label from cached map
			const get_pt_label = (type_name) => {
				const pt = this.rollCall.presence_types_map.get(type_name);
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
				const available_types = await this.rollCall.get_employee_presence_types(employee, date);
				const all_working = available_types.filter(t => t.expect_work_hours === 1);
				const all_not_working = available_types.filter(t => t.expect_work_hours === 0);

				const editable_type = leave_side === 'am' ? existing?.pm_presence_type : existing?.am_presence_type;

				const make_options = (types, selected_type) => types.map(pt => `
					<div class="presence-option ${selected_type === pt.name ? 'selected' : ''}"
						 data-type="${pt.name}"
						 style="--option-color: ${this.rollCall.get_color_var(pt.color)}">
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

			const self = this;
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
						await self.rollCall.save_split_entry(employee, date, locked_type, selected_type);
					} else {
						await self.rollCall.save_split_entry(employee, date, selected_type, locked_type);
					}
				});
			}

			d.show();
		}

		showPending(employee, date, employee_name, pending_leave) {
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
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.LeaveDialogs = LeaveDialogs;
})();

