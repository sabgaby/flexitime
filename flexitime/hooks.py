app_name = "flexitime"
app_title = "Flexitime"
app_publisher = "Gaby"
app_description = "Swiss-compliant time tracking with flexitime balance management"
app_email = "gaby@swisscluster.ch"
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
		"route": "/flexitime/roll-call",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "/assets/flexitime/css/flexitime.css"
# app_include_js = ""

# Website Route Rules
# -------------------
# Route /flexitime/* to the Vue SPA
website_route_rules = [
	{"from_route": "/flexitime/<path:app_path>", "to_route": "flexitime"},
]

# Installation
# ------------

after_install = "flexitime.install.after_install"

# Document Events
# ---------------

doc_events = {
	"Leave Application": {
		"on_update": "flexitime.flexitime.events.leave_application.on_update"
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
	{
		"dt": "Presence Type"
	},
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
