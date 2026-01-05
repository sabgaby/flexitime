/**
 * Bulk Dialog Module
 * Handles bulk presence selection for multiple selected cells
 */
(function() {
	'use strict';

	class BulkDialog {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		show() {
			if (this.rollCall.selection.selected_cells.size === 0) return;

			// Check if all selected cells are for the same employee
			const employees = new Set();
			this.rollCall.selection.selected_cells.forEach(key => {
				const [employee] = key.split('|');
				employees.add(employee);
			});
			const single_employee = employees.size === 1 ? [...employees][0] : null;

			// If single employee, show all types; if multiple employees, show only available_to_all
			const available_types = this.rollCall.get_dialog_presence_types(single_employee);

			// Group by expect_work_hours (no quick/extended split)
			const all_working = available_types.filter(t => t.expect_work_hours === 1);
			const all_not_working = available_types.filter(t => t.expect_work_hours === 0);

			const make_options = (types) => types.map(pt => `
				<div class="presence-option" data-type="${pt.name}" style="--option-color: ${this.rollCall.get_color_var(pt.color)}">
					<span class="option-icon">${pt.icon || '•'}</span>
					<span class="option-label">${pt.label}</span>
				</div>
			`).join('');

			let is_split_day = false;
			let full_day_type = null;
			let am_type = null;
			let pm_type = null;

			const self = this;
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
										<strong>${__("{0} cells", [this.rollCall.selection.selected_cells.size])}</strong>
									</div>
									<div class="header-controls">
										<div class="mode-tabs">
											<button type="button" class="mode-tab active" data-mode="full">${__('Full Day')}</button>
											<button type="button" class="mode-tab" data-mode="split">${__('Split')}</button>
										</div>
									</div>
								</div>

								<!-- Full Day Mode -->
								<div class="full-day-content">
									<div class="options-section working-section">
										<div class="options-row">
											${make_options(all_working)}
										</div>
									</div>
									<div class="options-divider"></div>
									<div class="options-section not-working-section">
										<div class="options-row">
											${make_options(all_not_working)}
										</div>
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
												<div class="options-row">
													${make_options(all_working)}
												</div>
											</div>
											<div class="options-divider-sm"></div>
											<div class="options-section not-working-section">
												<div class="options-row">
													${make_options(all_not_working)}
												</div>
											</div>
										</div>
										<div class="split-column pm-column">
											<div class="column-label">${__('PM')}</div>
											<div class="options-section working-section">
												<div class="options-row">
													${make_options(all_working)}
												</div>
											</div>
											<div class="options-divider-sm"></div>
											<div class="options-section not-working-section">
												<div class="options-row">
													${make_options(all_not_working)}
												</div>
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
				await self.rollCall.save_bulk_entries(full_day_type, 'full');
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
					await self.rollCall.save_bulk_split_entries(am_type, pm_type);
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
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.BulkDialog = BulkDialog;
})();

