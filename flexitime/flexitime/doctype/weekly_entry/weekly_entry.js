// Copyright (c) 2025, Gaby and contributors
// For license information, please see license.txt

frappe.ui.form.on('Weekly Entry', {
	refresh: function(frm) {
		// Add custom styling for the grid
		frm.fields_dict.daily_entries.$wrapper.find('.grid-heading-row').css({
			'background-color': 'var(--subtle-fg)',
			'font-weight': '600'
		});

		// Highlight weekends and handle leave day read-only state
		frm.doc.daily_entries?.forEach((row, idx) => {
			const grid_row = frm.fields_dict.daily_entries.grid.grid_rows[idx];
			if (!grid_row) return;

			// Highlight weekends
			if (row.day_of_week === 'Saturday' || row.day_of_week === 'Sunday') {
				grid_row.row.css({
					'background-color': 'var(--subtle-accent)'
				});
			}

			// Make actual_hours read-only on leave days (rows with leave_application)
			if (row.leave_application && frm.doc.docstatus === 0) {
				grid_row.toggle_editable('actual_hours', false);
				grid_row.row.css({
					'background-color': 'var(--subtle-warning-bg, rgba(255, 193, 7, 0.1))'
				});
			}
		});

		// Status indicator
		frm.trigger('set_status_indicator');

		// Lock/Unlock buttons for HR Manager
		if (frappe.user.has_role('HR Manager')) {
			if (frm.doc.docstatus === 1 && !frm.doc.is_locked) {
				frm.add_custom_button(__('Lock'), function() {
					frappe.confirm(
						__('Are you sure you want to lock this Weekly Entry? This will prevent further amendments.'),
						function() {
							frappe.call({
								method: 'flexitime.flexitime.doctype.weekly_entry.weekly_entry.lock_weekly_entry',
								args: { name: frm.doc.name },
								callback: function(r) {
									frm.reload_doc();
								}
							});
						}
					);
				}, __('Actions'));
			}

			if (frm.doc.is_locked) {
				frm.add_custom_button(__('Unlock'), function() {
					frappe.confirm(
						__('Are you sure you want to unlock this Weekly Entry? This will allow amendments.'),
						function() {
							frappe.call({
								method: 'flexitime.flexitime.doctype.weekly_entry.weekly_entry.unlock_weekly_entry',
								args: { name: frm.doc.name },
								callback: function(r) {
									frm.reload_doc();
								}
							});
						}
					);
				}, __('Actions'));
			}
		}

		// Disable form if locked (except for HR)
		if (frm.doc.is_locked && !frappe.user.has_role('HR Manager')) {
			frm.disable_form();
			frm.set_intro(__('This Weekly Entry is locked and cannot be edited.'), 'yellow');
		}
	},

	set_status_indicator: function(frm) {
		// Set page indicator based on status
		if (frm.doc.is_locked) {
			frm.page.set_indicator(__('Locked'), 'gray');
		} else if (frm.doc.docstatus === 1) {
			frm.page.set_indicator(__('Submitted'), 'blue');
		} else if (frm.doc.docstatus === 0) {
			frm.page.set_indicator(__('Draft'), 'orange');
		} else if (frm.doc.docstatus === 2) {
			frm.page.set_indicator(__('Cancelled'), 'red');
		}
	},

	employee: function(frm) {
		if (frm.doc.employee && frm.doc.week_start) {
			frm.trigger('populate_daily_entries');
		}
	},

	week_start: function(frm) {
		if (frm.doc.week_start) {
			// Ensure it's a Monday
			const date = frappe.datetime.str_to_obj(frm.doc.week_start);
			const dayOfWeek = date.getDay();

			if (dayOfWeek !== 1) {
				// Calculate Monday of this week
				const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
				date.setDate(date.getDate() + diff);
				frm.set_value('week_start', frappe.datetime.obj_to_str(date));
				return;
			}

			// Set week_end (Sunday)
			const weekEnd = new Date(date);
			weekEnd.setDate(weekEnd.getDate() + 6);
			frm.set_value('week_end', frappe.datetime.obj_to_str(weekEnd));

			// Populate daily entries
			if (frm.doc.employee) {
				frm.trigger('populate_daily_entries');
			}
		}
	},

	populate_daily_entries: function(frm) {
		frappe.call({
			method: 'flexitime.flexitime.doctype.weekly_entry.weekly_entry.get_week_data',
			args: {
				employee: frm.doc.employee,
				week_start: frm.doc.week_start
			},
			callback: function(r) {
				if (r.message) {
					frm.clear_table('daily_entries');

					r.message.days.forEach(function(day) {
						let row = frm.add_child('daily_entries');
						row.date = day.date;
						row.day_of_week = day.day_of_week;
						row.expected_hours = day.expected_hours;
						// Do not auto-fill actual_hours - only use value from server if it exists
						row.actual_hours = day.actual_hours || 0;
						row.presence_type = day.presence_type;
						row.presence_type_icon = day.presence_type_icon;
						row.presence_type_label = day.presence_type_label;
						row.leave_application = day.leave_application;
						row.difference = (row.actual_hours || 0) - (row.expected_hours || 0);
					});

					frm.refresh_field('daily_entries');
					frm.set_value('previous_balance', r.message.previous_balance || 0);
					frm.trigger('calculate_totals');
				}
			}
		});
	},

	calculate_totals: function(frm) {
		let total_actual = 0;

		frm.doc.daily_entries?.forEach(row => {
			total_actual += flt(row.actual_hours) || 0;
		});

		// Get holiday-adjusted expected hours from server
		// This accounts for FTE percentage and holidays proportionally
		if (frm.doc.employee && frm.doc.week_start) {
			frappe.call({
				method: 'flexitime.flexitime.utils.calculate_weekly_expected_hours_with_holidays',
				args: {
					employee: frm.doc.employee,
					week_start: frm.doc.week_start
				},
				callback: function(r) {
					const total_expected = flt(r.message) || 0;
					const weekly_delta = total_actual - total_expected;
					const running_balance = flt(frm.doc.previous_balance) + weekly_delta;

					frm.set_value('total_actual_hours', total_actual);
					frm.set_value('total_expected_hours', total_expected);
					frm.set_value('weekly_delta', weekly_delta);
					frm.set_value('running_balance', running_balance);
				},
				error: function() {
					// Fallback to sum of daily expected hours if server call fails
					let total_expected = 0;
					frm.doc.daily_entries?.forEach(row => {
						total_expected += flt(row.expected_hours) || 0;
					});
					const weekly_delta = total_actual - total_expected;
					const running_balance = flt(frm.doc.previous_balance) + weekly_delta;

					frm.set_value('total_actual_hours', total_actual);
					frm.set_value('total_expected_hours', total_expected);
					frm.set_value('weekly_delta', weekly_delta);
					frm.set_value('running_balance', running_balance);
				}
			});
		} else {
			// Fallback if employee/week_start not set
			let total_expected = 0;
			frm.doc.daily_entries?.forEach(row => {
				total_expected += flt(row.expected_hours) || 0;
			});
			const weekly_delta = total_actual - total_expected;
			const running_balance = flt(frm.doc.previous_balance) + weekly_delta;

			frm.set_value('total_actual_hours', total_actual);
			frm.set_value('total_expected_hours', total_expected);
			frm.set_value('weekly_delta', weekly_delta);
			frm.set_value('running_balance', running_balance);
		}
	}
});

frappe.ui.form.on('Daily Entry', {
	actual_hours: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		frappe.model.set_value(cdt, cdn, 'difference',
			(flt(row.actual_hours) || 0) - (flt(row.expected_hours) || 0)
		);
		frm.trigger('calculate_totals');
	}
});
