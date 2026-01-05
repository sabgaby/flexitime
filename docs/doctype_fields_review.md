# DocType Fields Review

Edit this file to review and modify field labels and descriptions.

---

## 1. Roll Call Entry

File: `flexitime/flexitime/doctype/roll_call_entry/roll_call_entry.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | employee | Employee | | Link |
| 2 | employee_name | Employee Name | | Data (read-only) |
| 3 | date | Date | | Date |
| 4 | day_of_week | Day of Week | | Data (read-only) |
| 5 | presence_type | Presence Type | | Link |
| 6 | presence_type_icon | Icon | | Data (read-only) |
| 7 | presence_type_label | Presence Label | | Data (read-only) |
| 8 | is_half_day | Split AM/PM | Check to split presence between morning and afternoon | Check |
| 9 | half_day_type | Half Day Type | Which half of the day this presence applies to | Select |
| 10 | source | Source | How this entry was created: Manual, Leave Application, System, or Work Pattern | Select |
| 11 | leave_application | Leave Application | | Link (read-only) |
| 12 | am_presence_type | AM Presence Type | | Link |
| 13 | am_presence_icon | AM Icon | | Data (read-only) |
| 14 | pm_presence_type | PM Presence Type | | Link |
| 15 | pm_presence_icon | PM Icon | | Data (read-only) |
| 16 | is_locked | Locked | Entry is locked and cannot be edited | Check (read-only) |
| 17 | notes | Notes | | Small Text |
| 18 | previous_source | Previous Source | Stores original source before leave overwrite for restore on cancellation | Data (hidden) |
| 19 | previous_presence_type | Previous Presence Type | Stores original presence type before leave overwrite for restore on cancellation | Link (hidden) |

---

## 2. Weekly Entry

File: `flexitime/flexitime/doctype/weekly_entry/weekly_entry.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | employee | Employee | | Link |
| 2 | employee_name | Employee Name | | Data (read-only) |
| 3 | calendar_week | Calendar Week | ISO calendar week | Data (read-only) |
| 4 | week_start | Week Start (Monday) | | Date |
| 5 | week_end | Week End (Sunday) | | Date (read-only) |
| 6 | daily_entries | Daily Entries | | Table |
| 7 | total_actual_hours | Total Actual Hours | Sum of all daily actual hours | Float (read-only) |
| 8 | total_expected_hours | Total Expected Hours | Pro-rata expected hours | Float (read-only) |
| 9 | weekly_delta | Weekly Delta | Actual - Expected | Float (read-only) |
| 10 | timesheet_hours | Timesheet Hours | Hours pulled from Timesheets | Float (hidden) |
| 11 | previous_balance | Previous Balance | Balance from prior week | Float (read-only) |
| 12 | running_balance | Running Balance | Previous + Delta | Float (read-only) |
| 13 | notes | Notes | | Small Text |
| 14 | is_locked | Locked | Entry is locked and cannot be edited | Check (read-only) |
| 15 | submitted_on | Submitted On | | Datetime (read-only) |
| 16 | locked_on | Locked On | | Datetime (read-only) |
| 17 | amended_from | Amended From | | Link (read-only) |

---

## 3. Daily Entry (child table of Weekly Entry)

File: `flexitime/flexitime/doctype/daily_entry/daily_entry.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | day_of_week | Day | | Data (read-only) |
| 2 | date | Date | | Date (read-only) |
| 3 | presence_type_icon | (empty) | | Data (read-only) |
| 4 | expected_hours | Expected | | Float (read-only) |
| 5 | actual_hours | Actual Hours | | Float |
| 6 | difference | Delta | | Float (read-only) |
| 7 | timesheet_hours | Timesheet | | Float (hidden) |
| 8 | presence_type | Presence Type | | Link (hidden) |
| 9 | presence_type_label | Presence | | Data (hidden) |
| 10 | is_timesheet_user | Is Timesheet User | | Check (hidden) |
| 11 | leave_application | Leave Application | | Link (read-only) |
| 12 | notes | Notes | | Small Text (hidden) |

---

## 4. Presence Type

File: `flexitime/flexitime/doctype/presence_type/presence_type.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | presence_name | Presence Name | | Data |
| 2 | label | Label | | Data |
| 3 | icon | Icon | | Data |
| 11 | color | Color | | Select |
| 12 | description | Description | Help text for employees | Small Text |
| 4 | expect_work_hours | Expect Work Hours | If checked, this presence type expects work hours from the Employee Work Pattern. If unchecked, expected hours are 0. | Check |
| 5 | sort_order | Sort Order | Sort 1-n in palette | Int |
| 6 | palette_group | Palette Group |  | Select |
| 7 | available_to_all | Available to All | All employees can select this presence type | Check |
| 8 | requires_leave_application | Requires Leave Application | When checked, this presence type requires a Leave Application for approval | Check |
| 9 | leave_type | Leave Type | The Leave Type to link when this presence requires approval | Link |

---

## 5. Employee Presence Settings

File: `flexitime/flexitime/doctype/employee_presence_settings/employee_presence_settings.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | employee | Employee | | Link |
| 2 | employee_name | Employee Name | | Data (read-only) |
| 3 | flexitime_balance | Flexitime Balance | Current running flexitime balance (hours) | Float (read-only) |
| 4 | uses_timesheet | Uses Timesheet | Employee uses ERPNext Timesheets for time tracking | Check |
| 5 | show_in_roll_call | Show in Roll Call | | Check |
| 6 | requires_weekly_entry | Requires Weekly Entry | s | Check |
| 7 | presence_permissions | Presence Permissions |  | Table |

---

## 6. Employee Presence Permission (child table of Employee Presence Settings)

File: `flexitime/flexitime/doctype/employee_presence_permission/employee_presence_permission.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | presence_type | Presence Type | | Link |
| 2 | presence_type_label | Presence Type Label | | Data (read-only) |
| 3 | from_date | From Date | | Date |
| 4 | to_date | To Date | Leave blank for no end date | Date |

---

## 7. Employee Work Pattern

File: `flexitime/flexitime/doctype/employee_work_pattern/employee_work_pattern.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | employee | Employee | | Link |
| 2 | employee_name | Employee Name | | Data (read-only) |
| 3 | fte_percentage | FTE Percentage | | Percent |
| 4 | flexitime_limit_hours | Flexitime Limit Hours | Maximum +/- balance | Float |
| 5 | monday_hours | Monday Hours | | Float |
| 6 | tuesday_hours | Tuesday Hours | | Float |
| 7 | wednesday_hours | Wednesday Hours | | Float |
| 8 | thursday_hours | Thursday Hours | | Float |
| 9 | friday_hours | Friday Hours | | Float |
| 10 | saturday_hours | Saturday Hours | | Float |
| 11 | sunday_hours | Sunday Hours | | Float |
| 12 | weekly_expected_hours | Weekly Expected Hours | Auto-calculated sum of all days | Float (read-only) |
| 13 | valid_from | Valid From | | Date |
| 14 | valid_to | Valid To | Leave empty if this is the current pattern | Date |
| 15 | notes | Notes | Reason for pattern or change | Small Text |

---

## 8. Flexitime Settings

File: `flexitime/flexitime/doctype/flexitime_settings/flexitime_settings.json`

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | roll_call_start_day | Roll Call Start Day | The starting column when opening Roll Call page | Select |
| 2 | roll_call_display_name | Display Name Format | How to display employee names in Roll Call grid | Select |
| 3 | palette_group_options | Palette Groups | One group per line. First group is the default. These options appear in the Presence Type 'Palette Group' field. | Small Text |
| 4 | enable_calendar_sync | Enable Calendar Sync | Create Google Calendar events when leave is approved. | Check |
| 5 | calendar_mode | Calendar Mode | Primary: Event in employee's own calendar. Shared: Event in company-wide leave calendar (requires all employees to have write access). | Select |
| 6 | shared_leave_calendar_id | Shared Leave Calendar ID | Calendar ID for the shared leave calendar. All employees must have write access to this calendar. | Data |
| 7 | enable_auto_lock | Enable Auto-Lock | Automatically lock submitted Weekly Entries after a specified number of days | Check |
| 8 | auto_lock_after_days | Auto-Lock After (Days) | Number of days after submission before auto-locking | Int |
| 9 | enable_submission_reminders | Enable Submission Reminders | Send email reminders to employees who haven't submitted their Weekly Entry | Check |
| 10 | submission_reminder_day | Reminder Day | Day of week to send submission reminders | Select |
| 11 | reminder_email_template | Reminder Email Template | Email template for submission reminders (optional) | Link |
| 12 | sick_leave_type | Sick Leave Type | Specify which Leave Type is used for sick leave. This enables incapacity to work declaration and sick leave reason fields. | Link |
| 13 | holiday_presence_type | Holiday Presence Type | Specify which Presence Type represents holidays from the Holiday List | Link |
| 14 | day_off_presence_type | Day Off Presence Type | Presence Type used for scheduled days off from Employee Work Pattern | Link |

---

## Custom Fields (added to ERPNext DocTypes)

File: `flexitime/fixtures/custom_field.json`

### On Employee

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | nickname | Nickname | Short name or nickname for display in Roll Call and Calendar | Data |
| 2 | integrations_tab | Integrations | | Tab Break |
| 3 | google_workspace_section | Google Workspace | Connect your Google account to enable calendar sync for leave applications | Section Break |
| 4 | google_workspace_status_html | Connection Status | | HTML |

### On Leave Application

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | incapacity_to_work | Incapacity to Work | Percentage of incapacity to work (0-100%). Required for sick leave. | Percent (hidden by default) |
| 2 | caring_for_sick_loved_one | Caring for sick loved one | Check if this sick leave is for caring for a sick loved one | Check (hidden by default) |
| 3 | calendar_section | Google Calendar | | Section Break |
| 4 | google_calendar_event_url | Event Link | | Data (URL, read-only) |
| 5 | google_calendar_link | Google Calendar | | HTML (hidden) |
| 6 | google_calendar_event_id | Google Calendar Event ID | | Data (hidden, read-only) |

### On Company

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | base_weekly_hours | Base Weekly Hours (100% FTE) | Standard weekly working hours for 100% FTE employees (e.g., 40 hours). Used to calculate expected hours based on FTE percentage and holidays. | Float (default: 40) |

### On Leave Type

| # | Field Name | Label | Description | Type |
|---|------------|-------|-------------|------|
| 1 | allow_zero_allocation | Allow Zero Allocation | Allow creating allocations with zero leaves for this leave type. Use for sick leave, military leave, etc. that don't require pre-allocation but need to appear in the leave dropdown. The balance will go negative when employees apply for leave. | Check |
