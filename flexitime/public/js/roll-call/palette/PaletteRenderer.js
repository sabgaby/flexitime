/**
 * Palette Renderer Module
 * Handles rendering of the presence type palette/legend
 */
(function() {
	'use strict';

	class PaletteRenderer {
		constructor(rollCallInstance) {
			this.rollCall = rollCallInstance;
		}

		render() {
			// Build grouped presence types based on configuration
			const groups = this.get_palette_groups();
			const hide_labels = groups.length <= 1;  // Hide labels if only one group

			const make_item = (pt) => `
				<button class="palette-item${pt.selectable === false ? ' disabled' : ''}"
						data-type="${pt.name}"
						${pt.selectable === false ? 'disabled' : ''}
						style="--item-color: ${this.rollCall.get_color_var(pt.color)}"
						title="${pt.label}${pt.selectable === false ? ' (' + __('no permission') + ')' : ''}">
					<span class="palette-icon">${pt.icon || '•'}</span>
					<span class="palette-label">${pt.label}</span>
				</button>
			`;

			// Build normal palette columns from groups
			const palette_columns = groups.map(group => `
				<div class="palette-column ${group.group_name}-column">
					${hide_labels ? '' : `<span class="palette-column-label">${group.label}</span>`}
					<div class="palette-column-items">
						${group.types.map(make_item).join('')}
					</div>
				</div>
			`).join('');

			// Normal palette - custom groups + Actions
			// Actions column only shows label if other groups have labels (for visual consistency)
			const normal_palette = `
				<div class="palette-normal${hide_labels ? ' single-group' : ''}">
					${palette_columns}
					<div class="palette-column action-column">
						${hide_labels ? '' : `<span class="palette-column-label">${__('Actions')}</span>`}
						<div class="palette-column-items">
							<button class="palette-item palette-action ${this.rollCall.palette_mode === 'split' ? 'active' : ''}"
									data-action="split" title="${__('Split AM/PM')}">
								<span class="palette-icon">✂️</span>
								<span class="palette-label">${__('Split')}</span>
							</button>
							<button class="palette-item palette-action palette-clear ${this.rollCall.palette_mode === 'clear' ? 'active' : ''}"
									data-action="clear" title="${__('Clear')}">
								<span class="palette-icon">🗑️</span>
								<span class="palette-label">${__('Clear')}</span>
							</button>
						</div>
					</div>
				</div>
			`;

			// Split mode palette - exact same layout as normal, just with AM/PM labels and data-half attribute
			const make_split_palette_item = (pt, half) => `
				<button class="palette-item palette-split-item${pt.selectable === false ? ' disabled' : ''}"
						data-type="${pt.name}" data-half="${half}"
						${pt.selectable === false ? 'disabled' : ''}
						style="--item-color: ${this.rollCall.get_color_var(pt.color)}"
						title="${pt.label}${pt.selectable === false ? ' (' + __('no permission') + ')' : ''}">
					<span class="palette-icon">${pt.icon || '•'}</span>
					<span class="palette-label">${pt.label}</span>
				</button>
			`;

			// Build split palette columns from groups
			const split_palette_columns = groups.map(group => `
				<div class="palette-column ${group.group_name}-column">
					${hide_labels ? '' : `<span class="palette-column-label">${group.label}</span>`}
					<div class="palette-column-items">
						${group.types.map(pt => make_split_palette_item(pt, 'am')).join('')}
					</div>
				</div>
			`).join('');

			const split_palette = `
				<div class="palette-split-mode${hide_labels ? ' single-group' : ''}" style="display: none;">
					<div class="split-palette-row am-row">
						<div class="split-palette-label">AM</div>
						${split_palette_columns}
					</div>
					<div class="split-palette-row pm-row">
						<div class="split-palette-label">PM</div>
						${groups.map(group => `
							<div class="palette-column ${group.group_name}-column">
								${hide_labels ? '' : `<span class="palette-column-label">${group.label}</span>`}
								<div class="palette-column-items">
									${group.types.map(pt => make_split_palette_item(pt, 'pm')).join('')}
								</div>
							</div>
						`).join('')}
					</div>
					<button class="btn btn-sm btn-default split-cancel-btn" data-action="split-cancel">
						${__('Cancel')}
					</button>
				</div>
			`;

			return `
				<div class="roll-call-palette">
					${normal_palette}
					${split_palette}
					<div class="palette-status-bar"></div>
				</div>
			`;
		}

		/**
		 * Get palette groups configuration
		 * Returns list of groups with their presence types
		 */
		get_palette_groups() {
			return this.build_groups();
		}

		/**
		 * Build groups from palette configuration
		 */
		build_groups() {
			const groups = [];
			const assigned_types = new Set();
			const presence_types_map = new Map(
				this.rollCall.presence_types.map(pt => [pt.name, pt])
			);

			// Process configured groups
			if (this.rollCall.palette_groups && this.rollCall.palette_groups.length > 0) {
				for (const config_group of this.rollCall.palette_groups) {
					const types = [];
					
					if (config_group.presence_types && Array.isArray(config_group.presence_types)) {
						for (const pt_name of config_group.presence_types) {
							const pt = presence_types_map.get(pt_name);
							if (pt) {
								types.push(pt);
								assigned_types.add(pt_name);
							}
						}
					}
					
					// Only add group if it has types
					if (types.length > 0) {
						groups.push({
							group_name: config_group.group_name,
							label: config_group.label,
							types: types
						});
					}
				}
			}

			// Handle unassigned presence types - add them to the last group or create a default group
			const unassigned_types = this.rollCall.presence_types.filter(
				pt => !assigned_types.has(pt.name)
			);
			
			if (unassigned_types.length > 0) {
				// Add unassigned types to the last group, or create a default group
				if (groups.length > 0) {
					// Add to last group
					groups[groups.length - 1].types.push(...unassigned_types);
				} else {
					// Create a default group for all types if no groups configured
					groups.push({
						group_name: 'all',
						label: __('All'),
						types: this.rollCall.presence_types
					});
				}
			}

			return groups;
		}
	}

	// Export to global namespace
	if (typeof window.FlexitimeRollCall === 'undefined') {
		window.FlexitimeRollCall = {};
	}
	window.FlexitimeRollCall.PaletteRenderer = PaletteRenderer;
})();

