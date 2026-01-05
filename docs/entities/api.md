# API Modules Documentation

This document contains structured descriptions for all Flexitime API modules. These descriptions are designed to be copied into Fibery database entries.

---

## flexitime.flexitime.api

**Purpose:** Dashboard and general API endpoints used by the Flexitime Dashboard and reminder functionality.

**Functions:**
- `get_today_overview()`: Get count of employees by presence type for today (or specified date)
- `get_balance_alerts()`: Get employees with balance warnings or over limit (HR only)
- `get_missing_roll_call_next_week()`: Get employees missing Roll Call entries for next week
- `get_missing_timesheets()`: Get employees with missing or draft Weekly Entries
- `send_reminder()`: Send reminder to a specific employee (roll-call or timesheet)
- `send_all_reminders()`: Send reminders to all employees with missing data (HR only)
- `get_roll_call_data()`: Get Roll Call data for a week (legacy, used by some pages)

**Relationships:**
- Part of: flexitime.flexitime
- Used by: flexitime_dashboard page
- Reads: Roll Call Entry, Weekly Entry, Employee, Employee Work Pattern
- Uses: Email Templates (for reminders)

**Notes:** Dashboard endpoints are readable by all logged-in users. Balance alerts and reminders require HR Manager role. Reminder functions use email templates with context variables. Missing entries functions check for gaps in data. All endpoints return JSON data for frontend consumption.

---

## flexitime.api.roll_call

**Purpose:** Roll Call-specific API endpoints used by both Desk and Portal Roll Call pages. Handles all Roll Call entry operations.

**Functions:**
- `get_current_user_info()`: Get current user info for the SPA
- `get_default_company()`: Get user's default company
- `get_events()`: Get Roll Call entries for a date range with leave application status
- `save_entry()`: Save/update a single Roll Call entry (full day)
- `save_split_entry()`: Save/update a split AM/PM Roll Call entry
- `save_bulk_entries()`: Save multiple entries in bulk
- `save_bulk_split_entries()`: Save multiple split entries in bulk
- `delete_bulk_entries()`: Delete multiple entries in bulk
- `get_leave_planning_summary()`: Get aggregated leave planning data (lightweight for dashboards)

**Helper Functions:**
- `get_current_employee()`: Get employee ID for current user
- `can_edit_employee_entry()`: Check if user can edit an employee's entry
- `is_hr_department_member()`: Check if user has HR Manager role
- `validate_presence_type_for_roll_call()`: Validate presence type before save
- `sync_roll_call_to_weekly_entry()`: Sync changes to Weekly Entry
- `ensure_holiday_entries_batch()`: Batch auto-create holiday entries
- `ensure_day_off_entries_batch()`: Batch auto-create day_off entries

**Relationships:**
- Part of: flexitime.api
- Used by: Roll Call page (Desk and Portal)
- Creates/Updates: Roll Call Entry
- Updates: Weekly Entry (via sync)
- Reads: Presence Type, Leave Application, Employee Work Pattern

**Notes:** All endpoints require authentication (not allow_guest). Permission checks ensure employees can only edit own entries (HR can edit all). Auto-creates holiday and day_off entries on get_events(). Validates presence types and leave applications before save. Bulk operations optimize performance with batch queries. Changes automatically sync to Weekly Entry Daily Entry child table. Leave planning summary provides lightweight aggregated data for dashboards.
