/**
 * Presence Type Utilities
 * 
 * Shared utilities for working with presence types across roll call components.
 * Uses Frappe's standard color system for light/dark mode support.
 */

/**
 * Get presence color using Frappe's CSS variable system
 * @param {string|null} color - Color name or hex value
 * @returns {string} CSS color value
 */
function getPresenceColor(color) {
	const ColorUtils = window.FlexitimeColorUtils;
	if (ColorUtils && ColorUtils.getPresenceColor) {
		// Prefer Frappe CSS variables for light/dark mode support
		return ColorUtils.getPresenceColor(color, true);
	}
	// Fallback
	if (!color) return 'var(--bg-light-gray)';
	if (color.startsWith('var(') || color.startsWith('rgb') || color.startsWith('#')) {
		return color;
	}
	const frappe_colors = ['blue', 'green', 'orange', 'yellow', 'red', 'purple', 'pink', 'cyan', 'gray', 'grey'];
	if (frappe_colors.includes(color.toLowerCase())) {
		return `var(--bg-${color.toLowerCase()})`;
	}
	return 'var(--bg-light-gray)';
}

/**
 * Format employee display name based on settings
 * @param {Object} employee - Employee object with employee_name and nickname
 * @param {string} displayFormat - Format: 'Full Name', 'Nickname', 'Nickname (Full Name)', 'Full Name (Nickname)'
 * @returns {string} Formatted display name
 */
function formatEmployeeDisplayName(employee, displayFormat = 'Full Name') {
	const full_name = employee.employee_name || employee.name;
	const nickname = employee.nickname || '';

	switch (displayFormat) {
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

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		getPresenceColor,
		formatEmployeeDisplayName
	};
}

// Also make available globally
if (typeof window !== 'undefined') {
	if (!window.FlexitimeRollCallUtils) {
		window.FlexitimeRollCallUtils = {};
	}
	window.FlexitimeRollCallUtils.getPresenceColor = getPresenceColor;
	window.FlexitimeRollCallUtils.formatEmployeeDisplayName = formatEmployeeDisplayName;
}
