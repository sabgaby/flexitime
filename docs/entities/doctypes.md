# DocTypes Documentation

This document contains structured descriptions for all Flexitime DocTypes. These descriptions are designed to be copied into Fibery database entries.

---

## Roll Call Entry

**Purpose:** Daily presence tracking record for employees showing where they worked or if they were on leave.

**Key Fields:**
- `employee`, `date`: Identifies who and when
- `presence_type`: Office, Home Office, Vacation, etc. (links to Presence Type)
- `is_half_day`: Boolean flag for split day entries
- `am_presence_type`, `pm_presence_type`: Separate presence types for morning and afternoon
- `am_presence_icon`, `pm_presence_icon`: Icons for AM/PM display
- `leave_application`: Auto-linked when leave type matches (links to Leave Application)
- `is_locked`: Prevents editing after week completion
- `source`: Manual, System, Leave, or Pattern - indicates how entry was created
- `notes`: Optional notes field for additional information

**Relationships:**
- Links to: Employee, Presence Type, Leave Application
- Used by: Weekly Entry (for presence type sync to Daily Entry child table)

**Notes:** Can be full day or split AM/PM. Auto-created for holidays (System source) and day_off (Pattern source). Locked automatically after week completion. Employees can edit own entries; HR can edit all. Changes sync to Weekly Entry Daily Entry child table.

---

## Weekly Entry

**Purpose:** Weekly time summary with flexitime balance calculation. Tracks actual vs expected hours and maintains running balance chain.

**Key Fields:**
- `employee`, `employee_name`: Employee reference
- `calendar_week`: ISO format (e.g., 2025-W03)
- `week_start`, `week_end`: Monday and Sunday dates
- `daily_entries`: Child table (Daily Entry) with one row per day
- `total_actual_hours`: Sum of all daily actual_hours
- `total_expected_hours`: Calculated based on Work Pattern, holidays, and leaves
- `weekly_delta`: Actual - Expected (can be positive or negative)
- `previous_balance`: Balance from previous week's running_balance
- `running_balance`: previous_balance + weekly_delta
- `timesheet_hours`: Hours pulled from ERPNext Timesheets (hidden field)
- `is_locked`: Prevents editing after auto-lock period
- `submitted_on`, `locked_on`: Timestamps for tracking
- `notes`: Optional notes field

**Relationships:**
- Links to: Employee
- Contains: Daily Entry (child table)
- References: Roll Call Entry (for presence type sync)

**Notes:** Submittable document. Must be submitted sequentially (cannot submit Week 12 if Week 11 is draft). Balance chain: previous_balance + weekly_delta = running_balance. On submit, updates Employee.custom_flexitime_balance. Auto-locked after configured days. HR can unlock and amend.

---

## Daily Entry (Child Table)

**Purpose:** Daily record within Weekly Entry showing presence type, expected hours, and actual hours for each day of the week.

**Key Fields:**
- `date`: The specific day
- `presence_type`: Synced from Roll Call Entry
- `presence_type_icon`, `presence_type_label`: Display fields from Presence Type
- `expected_hours`: Calculated from Work Pattern based on presence type
- `actual_hours`: Hours worked (manual entry or from Timesheets)
- `timesheet_hours`: Hours from ERPNext Timesheets (synced every 2 hours)
- `leave_application`: Linked Leave Application if applicable

**Relationships:**
- Child of: Weekly Entry
- References: Presence Type, Leave Application
- Synced from: Roll Call Entry

**Notes:** Auto-populated from Roll Call Entry on Weekly Entry save. Expected hours calculated from Work Pattern. For Flex Off, expected hours remain at pattern value (to deduct from balance). For regular leave, expected hours are 0. Cannot be manually added/deleted (system-managed).

---

## Employee Work Pattern

**Purpose:** Defines employee's work schedule, FTE percentage, and flexitime limits. Used to calculate expected hours for Weekly Entries.

**Key Fields:**
- `employee`, `employee_name`: Employee reference
- `valid_from`, `valid_to`: Date range when this pattern applies (valid_to can be NULL for current pattern)
- `fte_percentage`: Full-time equivalent (100% = full-time, 80% = part-time, etc.)
- `flexitime_limit_hours`: Maximum allowed balance (typically 20 × FTE%)
- `monday_hours` through `sunday_hours`: Expected hours for each day (0 = day off)
- `weekly_expected_hours`: Auto-calculated sum of all days
- `notes`: Reason for pattern or change

**Relationships:**
- Links to: Employee
- Used by: Weekly Entry (for expected hours calculation), Roll Call Entry (auto-creates day_off entries)

**Notes:** Submittable document. Date-based validity allows multiple patterns over time. Auto-creates day_off Roll Call entries on submit for days with 0 hours. Only submitted patterns are used. Pattern selection: valid_from <= date AND (valid_to >= date OR valid_to IS NULL). When schedule changes, end current pattern and create new one.

---

## Presence Type

**Purpose:** Categorizes presence types into Working, Scheduled, or Leave categories. Controls what employees can select in Roll Call and how entries affect balance calculations.

**Key Fields:**
- `presence_name`: Unique identifier (e.g., "office", "vacation")
- `label`: Display name (e.g., "Office", "Vacation")
- `icon`: Emoji or icon for display
- `expect_work_hours`: If checked, expects work hours from Employee Work Pattern. If unchecked, expected hours are 0.
- `sort_order`: Display order
- `requires_leave_application`: Requires Leave Application for approval
- `leave_type`: Links to ERPNext Leave Type (if requires_leave_application)
- `available_to_all`: All employees can select (vs restricted)
- `color`: Background color (blue, green, orange, yellow, red, purple, pink, cyan, gray)
- `description`: Help text for employees

**System Configuration (Flexitime Settings)**:
- `holiday_presence_type`: Presence Type used for holidays from Holiday List
- `day_off_presence_type`: Presence Type used for scheduled days off from Work Pattern (only available on days with 0 expected hours)

**Relationships:**
- Links to: Leave Type (optional)
- Used by: Roll Call Entry, Daily Entry

**Notes:** Holiday and day off presence types are configured in Flexitime Settings. Leave types link to ERPNext Leave Types. Expected hours calculation: If `expect_work_hours=1`, uses Work Pattern hours (office, home, flex_off). If `expect_work_hours=0`, expected hours are 0 (vacation, sick, holiday, day_off). Flex Off has `expect_work_hours=1`, so it keeps expected hours from the pattern and deducts from the flexitime balance. Day off presence type is only available for selection on days where Work Pattern shows 0 expected hours.

---

## Flexitime Settings (Single DocType)

**Purpose:** Global configuration for Flexitime app. Single document containing all system-wide settings.

**Key Fields:**
- `roll_call_start_day`: Default view when opening Roll Call (Today or Start of Week)
- `roll_call_display_name`: How to show employee names (Full Name, Nickname, etc.)
- `enable_calendar_sync`: Enable Google Calendar integration
- `calendar_mode`: Primary Calendar or Shared Leave Calendar
- `shared_leave_calendar_id`: Calendar ID for shared calendar (if using Shared mode)
- `enable_auto_lock`: Automatically lock submitted Weekly Entries
- `auto_lock_after_days`: Days after submission before locking (default: 14)
- `enable_submission_reminders`: Send email reminders for unsubmitted entries
- `submission_reminder_day`: Day of week to send reminders
- `reminder_email_template`: Optional custom email template

**Relationships:**
- None (single document)

**Notes:** System-wide settings. Only HR Managers can edit. Accessed via Flexitime Settings menu. Changes take effect immediately. Calendar sync requires Google Workspace authorization per employee.

---

## Employee Presence Permission

**Purpose:** (Optional) Controls which presence types individual employees can use. Allows restricting access to certain presence types per employee.

**Key Fields:**
- `employee`: Employee reference
- `presence_type`: Presence Type that employee can use

**Relationships:**
- Links to: Employee, Presence Type

**Notes:** Optional feature for restricting presence type access per employee. If not used, presence types with `available_to_all=1` are available to all employees. Can be used for role-based presence types (e.g., only managers can select "Conference").

---

## Employee Presence Settings

**Purpose:** (Optional) Employee-specific presence settings and configurations.

**Key Fields:**
- `employee`: Employee reference
- Custom settings fields (if implemented)

**Relationships:**
- Links to: Employee

**Notes:** Optional feature for employee-specific configurations. Currently minimal usage. Can be extended for custom settings per employee.
