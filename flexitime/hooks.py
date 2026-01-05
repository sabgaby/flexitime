# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Flexitime Application Hooks.

This file configures the Flexitime application within the Frappe framework.
It defines scheduled tasks, document events, permissions, and other hooks
that integrate the app with ERPNext/Frappe.

Main Features:
    - Roll Call: Daily presence tracking for employees
    - Weekly Entry: Weekly time summaries with flexitime balance
    - Employee Work Pattern: Define work schedules per employee
    - Leave Integration: Automatic sync with Leave Applications
    - Google Calendar: Optional calendar sync for absences
    - Email Reminders: Automated reminders for missing entries

Key Configurations:
    required_apps: ["erpnext"]
    after_install: Creates default presence types, email templates, custom fields

Document Events:
    Leave Application: before_submit, on_update
        - Validates no hours recorded for leave dates
        - Creates/reverts Roll Call and Weekly entries
        - Syncs to Google Calendar (if enabled)

Scheduled Tasks:
    Daily: Lock past entries, auto-create system entries, sync timesheets
    Weekly: Create weekly entries, calculate balances, send reminders
    See scheduler_events for full schedule

Permissions:
    Custom permission queries for Roll Call Entry, Weekly Entry,
    and Employee Work Pattern. See flexitime.flexitime.permissions module.

Fixtures:
    - Custom Fields (module=Flexitime)
    - Client Scripts (module=Flexitime)
    - Presence Types
    - Email Templates (Roll Call/Timesheet reminders, balance alerts)
"""

app_name = "flexitime"
app_title = "Flexitime"
app_publisher = "Gabs"
app_description = "Swiss-compliant time tracking with flexitime balance management"
app_license = "mit"

# Apps
# ------------------
required_apps = ["erpnext"]

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "flexitime",
		"logo": "/assets/flexitime/images/flexitime-logo.svg",
		"title": "Flexitime",
		"route": "/app/roll-call",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# Load shared CSS variables and base styles first, then desk-specific styles
app_include_css = [
	"/assets/flexitime/css/shared-variables.css",
	"/assets/flexitime/css/roll-call-base.css",
	"/assets/flexitime/css/flexitime.css"
]
# Load shared utilities globally (used by multiple pages)
# Also load roll-call modules globally (they're lightweight and only used on roll-call page)
# RollCallTable is shared between desk app and portal - changes automatically apply to both
app_include_js = [
	"/assets/flexitime/js/utils/date-utils.js",
	"/assets/flexitime/js/utils/color-utils.js",
	"/assets/flexitime/js/roll-call/utils/presence-utils.js",
	"/assets/flexitime/js/roll-call/shared/DateRangeCalculator.js",
	"/assets/flexitime/js/roll-call/grid/GridRenderer.js",
	"/assets/flexitime/js/roll-call/interactions/SelectionManager.js",
	"/assets/flexitime/js/roll-call/interactions/EventManager.js",
	"/assets/flexitime/js/roll-call/interactions/ClipboardManager.js",
	"/assets/flexitime/js/roll-call/interactions/UndoManager.js",
	"/assets/flexitime/js/roll-call/data/DataManager.js",
	"/assets/flexitime/js/roll-call/dialogs/PresenceDialog.js",
	"/assets/flexitime/js/roll-call/dialogs/LeaveDialogs.js",
	"/assets/flexitime/js/roll-call/dialogs/BulkDialog.js",
	"/assets/flexitime/js/roll-call/palette/PaletteRenderer.js",
	"/assets/flexitime/js/roll-call/RollCallTable.js"
]

# Installation
# ------------

after_install = "flexitime.install.after_install"

# Document Events
# ---------------

doc_events = {
	"Leave Application": {
		"before_submit": "flexitime.flexitime.events.leave_application.before_submit",
		"on_update": "flexitime.flexitime.events.leave_application.on_update"
	},
	"Leave Allocation": {
		"before_validate": "flexitime.flexitime.events.leave_allocation.before_validate",
		"validate": "flexitime.flexitime.events.leave_allocation.validate"
	}
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	"daily": [
		"flexitime.flexitime.tasks.daily.lock_past_roll_call",
		"flexitime.flexitime.tasks.daily.auto_create_roll_call_entries",
		"flexitime.flexitime.tasks.daily.auto_lock_submitted_entries"
	],
	"weekly": [
		"flexitime.flexitime.tasks.weekly.create_weekly_entries"
	],
	"cron": {
		# Every 2 hours - sync timesheet hours
		"0 */2 * * *": [
			"flexitime.flexitime.tasks.daily.sync_timesheet_hours"
		],
		# Monday 01:00 - calculate balances
		"0 1 * * 1": [
			"flexitime.flexitime.tasks.weekly.calculate_weekly_balances"
		],
		# Monday 08:00 - check balance limits
		"0 8 * * 1": [
			"flexitime.flexitime.tasks.weekly.check_balance_limits"
		],
		# Monday 09:00 - missing timesheet alerts AND submission reminders
		"0 9 * * 1": [
			"flexitime.flexitime.tasks.weekly.send_missing_timesheet_alerts",
			"flexitime.flexitime.tasks.weekly.send_submission_reminders"
		],
		# Friday 09:00 - roll call reminder
		"0 9 * * 5": [
			"flexitime.flexitime.tasks.weekly.send_roll_call_reminders"
		],
		# Friday 14:00 - timesheet reminder
		"0 14 * * 5": [
			"flexitime.flexitime.tasks.weekly.send_timesheet_reminders"
		]
	}
}

# Fixtures
# --------

fixtures = [
	{
		"dt": "Custom Field",
		"filters": [
			["module", "=", "Flexitime"]
		]
	},
	{
		"dt": "Client Script",
		"filters": [
			["module", "=", "Flexitime"]
		]
	},
	# Note: Presence Type is NOT included in fixtures.
	# Default Presence Types are created by install.py on first install.
	# Users can customize them via Setup > Presence Type without
	# having their changes overwritten on every bench migrate.
	{
		"dt": "Email Template",
		"filters": [
			["name", "in", [
				"Roll Call Reminder",
				"Timesheet Reminder",
				"Missing Timesheet Alert",
				"HR Missing Timesheet Summary",
				"Balance Over Limit",
				"Balance Warning",
				"HR Balance Alerts Summary"
			]]
		]
	}
]

# Permissions
# -----------

permission_query_conditions = {
	"Roll Call Entry": "flexitime.flexitime.permissions.roll_call_entry_query",
	"Weekly Entry": "flexitime.flexitime.permissions.weekly_entry_query",
	"Employee Work Pattern": "flexitime.flexitime.permissions.employee_work_pattern_query"
}

has_permission = {
	"Roll Call Entry": "flexitime.flexitime.permissions.has_roll_call_permission",
	"Weekly Entry": "flexitime.flexitime.permissions.has_weekly_entry_permission",
	"Employee Work Pattern": "flexitime.flexitime.permissions.has_work_pattern_permission"
}
