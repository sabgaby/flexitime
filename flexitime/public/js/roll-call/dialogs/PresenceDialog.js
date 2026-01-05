/**
 * Presence Dialog Module
 * Handles the main presence selection dialog for individual cells
 */
(function() {
	'use strict';

	class PresenceDialog {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		async show(employee, date, employee_name) {
			const key = `${employee}|${date}`;
			const existing = this.rollCall.entries[key];
			const pending_leave = this.rollCall.get_pending_leave(employee, date);

			// PRIORITY: If there's a pending leave application, show info dialog
			// Regardless of whether a Roll Call Entry exists
			if (pending_leave) {
				this.rollCall.dialogs.leave.showPending(employee, date, employee_name, pending_leave);
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
				this.rollCall.dialogs.leave.showInfo(employee, date, employee_name, existing, 'full');
				return;
			}

			// If split day with one half having leave, show split dialog with one side read-only
			if (has_am_leave || has_pm_leave) {
				this.rollCall.dialogs.leave.showInfo(employee, date, employee_name, existing, has_am_leave ? 'am' : 'pm');
				return;
			}

			// Get employee-specific presence types (includes Employee Presence Settings permissions)
			const available_types = await this.rollCall.get_employee_presence_types(employee, date);

			// Group by expect_work_hours (no quick/extended split)
			const all_working = available_types.filter(t => t.expect_work_hours === 1);
			const all_not_working = available_types.filter(t => t.expect_work_hours === 0);

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
					 style="--option-color: ${this.rollCall.get_color_var(pt.color)}">
					<span class="option-icon">${pt.icon || '•'}</span>
					<span class="option-label">${pt.label}</span>
				</div>
			`).join('');

			// Check if existing has split AM/PM
			const has_split = existing?.is_half_day && existing?.am_presence_type && existing?.pm_presence_type;

			let is_split_day = has_split;
			let full_day_type = existing?.presence_type || null;
			let am_type = existing?.am_presence_type || null;
			let pm_type = existing?.pm_presence_type || null;

			const self = this;
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
									</div>
								</div>

								<!-- Full Day Mode -->
								<div class="full-day-content" ${is_split_day ? 'style="display:none"' : ''}>
									<div class="options-section working-section">
										<div class="options-row">
											${make_options(all_working, existing?.presence_type)}
										</div>
									</div>
									<div class="options-divider"></div>
									<div class="options-section not-working-section">
										<div class="options-row">
											${make_options(all_not_working, existing?.presence_type)}
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
												<div class="options-row">
													${make_options(all_working, existing?.am_presence_type)}
												</div>
											</div>
											<div class="options-divider-sm"></div>
											<div class="options-section not-working-section">
												<div class="options-row">
													${make_options(all_not_working, existing?.am_presence_type)}
												</div>
											</div>
										</div>
										<div class="split-column pm-column">
											<div class="column-label">${__('PM')}</div>
											<div class="options-section working-section">
												<div class="options-row">
													${make_options(all_working, existing?.pm_presence_type)}
												</div>
											</div>
											<div class="options-divider-sm"></div>
											<div class="options-section not-working-section">
												<div class="options-row">
													${make_options(all_not_working, existing?.pm_presence_type)}
												</div>
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
					await this.rollCall.delete_entry(employee, date);
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

			// Full day selection - AUTO-SAVE on click
			d.$wrapper.find('.full-day-content .presence-option').on('click', async function() {
				d.$wrapper.find('.full-day-content .presence-option').removeClass('selected');
				$(this).addClass('selected');
				full_day_type = $(this).data('type');

				// Auto-save and close
				d.hide();
				await self.rollCall.save_entry(employee, date, full_day_type, false);
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
					await self.rollCall.save_split_entry(employee, date, am_type, pm_type);
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
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.PresenceDialog = PresenceDialog;
})();

