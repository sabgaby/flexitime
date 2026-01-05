/**
 * Shared Color Utilities for Flexitime
 * 
 * Provides consistent color handling using Frappe's CSS variable system
 * for proper light/dark mode support.
 * 
 * Uses Frappe's standard color variables: var(--bg-${color})
 * This ensures colors adapt automatically to light/dark themes.
 */

/**
 * Get presence color using Frappe's CSS variable system
 * Supports both Frappe color names (which use CSS variables) and legacy hex values
 * 
 * @param {string|null|undefined} color - Color name (e.g., 'blue', 'green') or hex value
 * @param {boolean} preferFrappeVars - Whether to prefer Frappe CSS variables (default: true)
 * @returns {string} CSS color value (CSS variable or hex)
 */
function getPresenceColor(color, preferFrappeVars = true) {
	if (!color) {
		return preferFrappeVars ? 'var(--bg-light-gray)' : '#e5e7eb';
	}

	// If already a CSS variable or rgb/rgba, return as-is
	if (color.startsWith('var(') || color.startsWith('rgb')) {
		return color;
	}

	// If it's a hex color, return as-is (legacy support)
	if (color.startsWith('#')) {
		return color;
	}

	// Frappe standard color names that have CSS variables
	const frappe_colors = [
		'blue', 'green', 'orange', 'yellow', 'red', 
		'purple', 'pink', 'cyan', 'gray', 'grey'
	];

	const colorLower = color.toLowerCase();

	// Use Frappe CSS variables for standard colors (supports light/dark mode)
	if (preferFrappeVars && frappe_colors.includes(colorLower)) {
		return `var(--bg-${colorLower})`;
	}

	// Fallback: if not a Frappe color, return as-is (might be a custom color name)
	// For portal version without Frappe CSS, we could map to hex, but prefer CSS vars
	if (preferFrappeVars) {
		// Default to light-gray if unknown color
		return 'var(--bg-light-gray)';
	}

	// Legacy hex mapping (only used if preferFrappeVars is false)
	// This is for portal version that might not have Frappe CSS loaded
	const colorMap = {
		'blue': '#3b82f6',
		'green': '#22c55e',
		'red': '#ef4444',
		'orange': '#f97316',
		'yellow': '#eab308',
		'purple': '#a855f7',
		'pink': '#ec4899',
		'gray': '#6b7280',
		'grey': '#6b7280',
		'cyan': '#06b6d4',
		'indigo': '#6366f1'
	};

	return colorMap[colorLower] || color;
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		getPresenceColor
	};
}

// Also make available globally for non-module usage
if (typeof window !== 'undefined') {
	window.FlexitimeColorUtils = {
		getPresenceColor
	};
}
