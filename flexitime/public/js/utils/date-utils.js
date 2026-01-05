/**
 * Shared Date Utilities for Flexitime
 * 
 * Provides consistent date manipulation functions for both portal and desk versions.
 * Handles both native JavaScript Date objects and Frappe datetime utilities.
 */

/**
 * Get Monday of the week containing the given date
 * @param {Date|string} date - Date object or date string (YYYY-MM-DD)
 * @param {boolean} useFrappe - Whether to use Frappe datetime utilities (for desk) or native Date (for portal)
 * @returns {Date|string} Monday of the week (Date object if useFrappe=false, string if useFrappe=true)
 */
function getMondayOfWeek(date, useFrappe = false) {
	if (useFrappe && typeof frappe !== 'undefined' && frappe.datetime) {
		// Desk version: use Frappe datetime utilities
		const date_str = typeof date === 'string' ? date : frappe.datetime.obj_to_str(date);
		const date_obj = frappe.datetime.str_to_obj(date_str);
		const day_of_week = date_obj.getDay(); // 0 = Sunday, 1 = Monday, etc.
		const days_since_monday = day_of_week === 0 ? 6 : day_of_week - 1;
		const monday = new Date(date_obj);
		monday.setDate(date_obj.getDate() - days_since_monday);
		return frappe.datetime.obj_to_str(monday);
	} else {
		// Portal version: use native Date objects
		const d = date instanceof Date ? new Date(date) : new Date(date);
		const day = d.getDay();
		const diff = d.getDate() - day + (day === 0 ? -6 : 1);
		return new Date(d.setDate(diff));
	}
}

/**
 * Add days to a date
 * @param {Date|string} date - Date object or date string
 * @param {number} days - Number of days to add (can be negative)
 * @param {boolean} useFrappe - Whether to use Frappe datetime utilities
 * @returns {Date|string} New date
 */
function addDays(date, days, useFrappe = false) {
	if (useFrappe && typeof frappe !== 'undefined' && frappe.datetime) {
		// Desk version: use Frappe datetime utilities
		const date_str = typeof date === 'string' ? date : frappe.datetime.obj_to_str(date);
		const date_obj = frappe.datetime.str_to_obj(date_str);
		const result = new Date(date_obj);
		result.setDate(result.getDate() + days);
		return frappe.datetime.obj_to_str(result);
	} else {
		// Portal version: use native Date objects
		const result = date instanceof Date ? new Date(date) : new Date(date);
		result.setDate(result.getDate() + days);
		return result;
	}
}

/**
 * Format date as YYYY-MM-DD
 * @param {Date|string} date - Date object or date string
 * @param {boolean} useFrappe - Whether to use Frappe datetime utilities
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
function formatDate(date, useFrappe = false) {
	if (useFrappe && typeof frappe !== 'undefined' && frappe.datetime) {
		// Desk version: use Frappe datetime utilities
		if (typeof date === 'string') {
			return date; // Already formatted
		}
		return frappe.datetime.obj_to_str(date);
	} else {
		// Portal version: use native Date formatting
		const d = date instanceof Date ? date : new Date(date);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
}

/**
 * Format date range for display
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @param {boolean} useFrappe - Whether to use Frappe datetime utilities
 * @returns {string} Formatted date range string
 */
function formatDateRange(startDate, endDate, useFrappe = false) {
	if (useFrappe && typeof frappe !== 'undefined' && frappe.datetime) {
		// Desk version: use Frappe datetime utilities
		const format_date = (d) => {
			if (typeof d === 'string') {
				d = frappe.datetime.str_to_obj(d);
			}
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		};

		const start = typeof startDate === 'string' ? frappe.datetime.str_to_obj(startDate) : startDate;
		const end = typeof endDate === 'string' ? frappe.datetime.str_to_obj(endDate) : endDate;

		const start_year = start.getFullYear();
		const end_year = end.getFullYear();

		if (start_year !== end_year) {
			return `${format_date(start)}, ${start_year} - ${format_date(end)}, ${end_year}`;
		} else {
			return `${format_date(start)} - ${format_date(end)}, ${end_year}`;
		}
	} else {
		// Portal version: use native Date formatting
		const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		
		const start = startDate instanceof Date ? startDate : new Date(startDate);
		const end = endDate instanceof Date ? endDate : new Date(endDate);

		const start_day = start.getDate();
		const start_month = MONTHS[start.getMonth()];
		const start_year = start.getFullYear();

		const end_day = end.getDate();
		const end_month = MONTHS[end.getMonth()];
		const end_year = end.getFullYear();

		if (start_year !== end_year) {
			return `${start_day} ${start_month} ${start_year} - ${end_day} ${end_month} ${end_year}`;
		} else {
			return `${start_day} ${start_month} - ${end_day} ${end_month} ${end_year}`;
		}
	}
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		getMondayOfWeek,
		addDays,
		formatDate,
		formatDateRange
	};
}

// Also make available globally for non-module usage
if (typeof window !== 'undefined') {
	window.FlexitimeDateUtils = {
		getMondayOfWeek,
		addDays,
		formatDate,
		formatDateRange
	};
}
