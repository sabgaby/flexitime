# Tasks Documentation

This document contains structured descriptions for all Flexitime scheduled tasks. These descriptions are designed to be copied into Fibery database entries.

---

## daily.py

**Purpose:** Daily scheduled tasks for maintaining data integrity, auto-creating entries, and syncing external data.

**Functions:**
- `lock_past_roll_call()`: Locks Roll Call entries from completed weeks (prevents editing past entries)
- `auto_create_roll_call_entries()`: Pre-creates system entries for holidays for next 2 weeks
- `sync_timesheet_hours()`: Updates Daily Entry timesheet_hours from ERPNext Timesheets
- `auto_lock_submitted_entries()`: Locks submitted Weekly Entries after configured number of days

**Schedule:**
- `lock_past_roll_call`: Daily 00:05
- `auto_create_roll_call_entries`: Daily 00:10
- `sync_timesheet_hours`: Every 2 hours (cron: `0 */2 * * *`)
- `auto_lock_submitted_entries`: Daily (runs with other daily tasks)

**Relationships:**
- Part of: flexitime.flexitime.tasks
- Updates: Roll Call Entry, Weekly Entry, Daily Entry
- Reads: Flexitime Settings (for auto-lock configuration)
- Reads: ERPNext Timesheet (for sync)

**Notes:** Maintains data integrity by locking past entries. Auto-creates holiday entries (not day_off - those are created by Work Pattern). Syncs Timesheet hours every 2 hours for draft Weekly Entries. Auto-locks submitted entries based on Flexitime Settings configuration. All tasks log results for monitoring.

---

## weekly.py

**Purpose:** Weekly scheduled tasks for creating entries, calculating balances, checking limits, and sending reminders.

**Functions:**
- `create_weekly_entries()`: Creates Weekly Entry documents for all active employees for current week
- `calculate_weekly_balances()`: Recalculates running flexitime balance for all employees
- `check_balance_limits()`: Checks for employees exceeding flexitime limits and sends alerts
- `send_roll_call_reminders()`: Emails employees to fill Roll Call for next week
- `send_timesheet_reminders()`: Emails employees with unsubmitted Weekly Entry
- `send_missing_timesheet_alerts()`: Alerts employees and HR about missing timesheets from last week
- `send_submission_reminders()`: Configurable reminders based on Flexitime Settings
- `get_missing_roll_call_days()`: Helper function to find missing Roll Call days

**Schedule:**
- `create_weekly_entries`: Monday 06:00
- `calculate_weekly_balances`: Monday 01:00
- `check_balance_limits`: Monday 08:00
- `send_missing_timesheet_alerts`: Monday 09:00
- `send_submission_reminders`: Monday 09:00 (based on settings)
- `send_roll_call_reminders`: Friday 09:00
- `send_timesheet_reminders`: Friday 14:00

**Relationships:**
- Part of: flexitime.flexitime.tasks
- Creates: Weekly Entry
- Updates: Weekly Entry, Employee (custom_flexitime_balance)
- Reads: Flexitime Settings (for reminder configuration)
- Uses: Email Templates (for sending emails)

**Notes:** Creates Weekly Entries every Monday morning. Recalculates balances early Monday (before limit checks). Balance calculation runs through all submitted Weekly Entries in order. Limit checks send alerts to employees and HR summary. Reminders use configured email templates. All tasks handle errors gracefully and log results.
