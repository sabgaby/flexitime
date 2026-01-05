/**
 * Date Range Calculator
 * 
 * Shared utility for calculating and formatting date ranges for roll call.
 * Uses Frappe's datetime utilities for consistency.
 */

/**
 * Format date range for display in dialog cards
 * @param {string} from_date - Start date (YYYY-MM-DD)
 * @param {string} to_date - End date (YYYY-MM-DD)
 * @param {number} days - Number of days
 * @param {boolean} useFrappe - Whether to use Frappe datetime utilities
 * @returns {string} Formatted date string
 */
function formatDateRangeForDialog(from_date, to_date, days, useFrappe = true) {
	if (useFrappe && typeof frappe !== 'undefined' && frappe.datetime) {
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
	} else {
		// Fallback for portal version
		const DateUtils = window.FlexitimeDateUtils;
		if (DateUtils && DateUtils.formatDateRange) {
			return DateUtils.formatDateRange(from_date, to_date, false);
		}
		// Basic fallback
		return `${from_date} - ${to_date}`;
	}
}

/**
 * Calculate month spans for grid headers
 * @param {Array} days - Array of day objects with month, year, isWeekend properties
 * @param {boolean} showWeekends - Whether weekends are shown
 * @returns {Array} Array of {month, colspan} objects
 */
function calculateMonthSpans(days, showWeekends = false) {
	const spans = [];
	let currentMonth = null;
	let currentSpan = null;

	for (const d of days) {
		if (!showWeekends && d.is_weekend) continue;

		const monthKey = `${d.year}-${d.month}`;
		if (monthKey !== currentMonth) {
			if (currentSpan) spans.push(currentSpan);
			currentMonth = monthKey;
			currentSpan = {
				month: `${d.month} ${d.year}`,
				colspan: 1
			};
		} else {
			currentSpan.colspan++;
		}
	}
	if (currentSpan) spans.push(currentSpan);
	return spans;
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		formatDateRangeForDialog,
		calculateMonthSpans
	};
}

// Also make available globally
if (typeof window !== 'undefined') {
	if (!window.FlexitimeRollCallUtils) {
		window.FlexitimeRollCallUtils = {};
	}
	window.FlexitimeRollCallUtils.formatDateRangeForDialog = formatDateRangeForDialog;
	window.FlexitimeRollCallUtils.calculateMonthSpans = calculateMonthSpans;
}
