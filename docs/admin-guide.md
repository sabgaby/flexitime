# Flexitime Admin Guide

This guide is for HR Managers and administrators configuring and managing the Flexitime application.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Flexitime Settings](#flexitime-settings)
3. [Presence Types Management](#presence-types-management)
4. [Employee Work Patterns](#employee-work-patterns)
5. [Managing Weekly Entries](#managing-weekly-entries)
6. [Roll Call Management](#roll-call-management)
7. [Leave Integration](#leave-integration)
8. [Dashboard Usage](#dashboard-usage)
9. [Email Templates](#email-templates)
10. [Monitoring & Alerts](#monitoring--alerts)
11. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Initial Setup After Installation

After installing Flexitime, verify that the installation completed successfully:

1. **Check Presence Types**: Navigate to **Setup > Presence Type** and verify these system types exist:
   - `holiday` (expect_work_hours = 0)
   - `day_off` (expect_work_hours = 0)

2. **Check Email Templates**: Navigate to **Setup > Email Template** and verify these templates exist:
   - Roll Call Reminder
   - Timesheet Reminder
   - Missing Timesheet Alert
   - HR Missing Timesheet Summary
   - Balance Over Limit
   - Balance Warning
   - HR Balance Alerts Summary

3. **Check Custom Fields**: Verify custom fields were added:
   - **Employee**: `custom_flexitime_balance`, `nickname`
   - **Employee Presence Settings**: `flexitime_balance`, `uses_timesheet`, `show_in_roll_call`, `requires_weekly_entry`
   - **Leave Application**: `google_calendar_event_id`, `google_calendar_event_url`

4. **Check Leave Type**: Navigate to **HR > Leave Type** and verify "Flex Off" exists.

### First-Time Configuration Checklist

- [ ] Configure Flexitime Settings (see next section)
- [ ] Review and customize Presence Types
- [ ] Create Employee Work Patterns for all active employees
- [ ] Verify Holiday Lists are assigned to employees
- [ ] Test Roll Call functionality
- [ ] Test Weekly Entry creation and submission
- [ ] Configure Google Calendar sync (if needed)
- [ ] Review email templates and customize if needed

### Re-running Installation Setup

If presence types or email templates are missing, you can re-run the installation setup:

```bash
bench --site <your-site> execute flexitime.install.after_install
```

---

## Flexitime Settings

Navigate to **Flexitime > Flexitime Settings** to configure global settings.

### Roll Call Configuration

**Roll Call Start Day**
- **Today**: Opens Roll Call showing today's column
- **Start of Week**: Opens Roll Call showing Monday's column

**Display Name Format**
- **Full Name**: Shows employee's full name
- **Nickname**: Shows nickname if set, otherwise full name
- **Nickname (Full Name)**: Shows "Nickname (Full Name)"
- **Full Name (Nickname)**: Shows "Full Name (Nickname)"

### Google Calendar Integration

**Enable Calendar Sync**
- Check to enable automatic calendar event creation when leave is approved
- Requires Google Workspace authorization per employee

**Calendar Mode**
- **Primary Calendar**: Events created in employee's own Google Calendar
- **Shared Leave Calendar**: Events created in company-wide calendar (requires Shared Leave Calendar ID)

**Shared Leave Calendar ID**
- Required if using Shared Leave Calendar mode
- All employees must have write access to this calendar
- Find the Calendar ID in Google Calendar settings

### Auto-Lock Settings

**Enable Auto-Lock**
- Automatically locks submitted Weekly Entries after a specified number of days
- Prevents accidental edits to historical data

**Auto-Lock After (Days)**
- Number of days after submission before auto-locking
- Default: 14 days
- Locked entries can still be unlocked by HR if needed

### Submission Reminders

**Enable Submission Reminders**
- Send email reminders to employees who haven't submitted their Weekly Entry

**Reminder Day**
- Day of week to send reminders (e.g., Monday)
- Reminders check for unsubmitted entries from the previous week

**Reminder Email Template**
- Optional: Select a custom email template
- Default: Uses "Timesheet Reminder" template

---

## Presence Types Management

Navigate to **Setup > Presence Type** to manage presence types.

### Understanding Categories

Presence types are organized into three categories:

1. **Working**: Regular work presence (Office, Home Office, Working Offsite, etc.)
2. **Scheduled**: System-managed or pattern-based (Holiday, Day Off)
3. **Leave**: Leave types that link to ERPNext Leave Applications

### Creating Custom Presence Types

1. Click **New**
2. Fill in required fields:
   - **Presence Name**: Unique identifier (lowercase, underscores, e.g., `working_offsite`)
   - **Label**: Display name (e.g., "Working Offsite")
   - **Icon**: Emoji or icon (e.g., 🌍)
   - **Expect Work Hours**: Check if this presence type expects work hours from Employee Work Pattern. If unchecked, expected hours are 0.
3. Configure settings:
   - **Available to All**: Check if all employees can select this
   - **Show in Quick Dialog**: Show in main dialog vs "Show more"
   - **Color**: Background color for grid display
4. For leave types:
   - Check **Is Leave Type**
   - Check **Requires Leave Application** (if approval needed)
   - Select **Leave Type** from ERPNext Leave Types
   - Check **Deducts from Flextime Balance** for Flex Off
5. Click **Save**

### System Types

**holiday**
- Auto-created by scheduled task from Holiday List
- Cannot be deleted
- Employees cannot manually select
- Expected hours: 0

**day_off**
- Created by Employee Work Pattern when day has 0 hours
- Can be selected by employees (for swapping days)
- Expected hours: 0

### Leave-Linked Presence Types

When creating a leave presence type:

1. Check **Is Leave Type**
2. Check **Requires Leave Application**
3. Select the corresponding **Leave Type** from ERPNext
4. For Flex Off: Check **Deducts from Flextime Balance**

When employees select a leave presence type:
- System validates that a Leave Application exists
- Auto-links the Leave Application to Roll Call Entry
- Updates Weekly Entry expected hours accordingly

### Icon and Color Customization

**Icons**: Use emojis or text (e.g., 🏢, 🏠, 🏖️, 🤒)

**Colors**: Choose from Frappe UI colors:
- blue, green, orange, yellow, red, purple, pink, cyan, gray

Colors automatically adapt to light/dark mode.

### Availability Settings

**Available to All**: All employees can select this presence type

**Requires Pattern Match**: Only available if Work Pattern shows 0 expected hours for that day (used for day_off)

**Show in Quick Dialog**: Controls whether it appears in the main selection dialog or under "Show more"

---

## Employee Work Patterns

Navigate to **Flexitime > Employee Work Pattern** to manage work schedules.

### Creating Work Patterns for New Employees

1. Click **New**
2. Select **Employee**
3. Set **Valid From** date (usually their start date)
4. Set **FTE Percentage**:
   - 100% = Full-time (40 hours/week)
   - 80% = Part-time (32 hours/week)
   - 60% = Part-time (24 hours/week)
   - etc.
5. Set **Flexitime Limit Hours**:
   - Default: 20 × FTE% (e.g., 100% FTE = 20 hours, 80% FTE = 16 hours)
   - Can be customized per company policy
6. Enter daily hours (Mon-Sun):
   - Regular work days: Enter expected hours (e.g., 8.0)
   - Day off: Enter 0 (will auto-create day_off Roll Call entries)
   - Weekend: Usually 0 (unless employee works weekends)
7. **Weekly Expected Hours** auto-calculates
8. Add **Notes** if needed (e.g., "Standard full-time schedule")
9. Click **Submit** (required for pattern to take effect)

**Important**: Patterns must be **submitted** to take effect. Draft patterns are ignored.

### Setting FTE Percentage and Flexitime Limits

**FTE Percentage** determines:
- Expected weekly hours (base_hours × FTE%)
- Flexitime limit (typically 20 × FTE%)

**Flexitime Limit Hours**:
- Maximum allowed balance (positive or negative)
- Default calculation: 20 × FTE%
- Can be customized per employee or company policy
- Alerts sent when balance approaches or exceeds limit

### Configuring Daily Hours

Enter expected hours for each day:
- **Monday-Friday**: Usually 8.0 hours each (for full-time)
- **Saturday/Sunday**: Usually 0 (unless employee works weekends)
- **Day Off**: Enter 0 (e.g., Friday = 0 for 4-day week)

**Weekly Expected Hours** automatically sums all days.

### Handling Pattern Changes

When an employee's schedule changes (FTE change, different days, etc.):

1. **End Current Pattern**:
   - Open the current submitted Work Pattern
   - Set **Valid To** to the last day of the old schedule
   - Save (can edit valid_to after submit)

2. **Create New Pattern**:
   - Click **New Employee Work Pattern**
   - Select same employee
   - Set **Valid From** to the first day of new schedule (usually a Monday)
   - Enter new schedule details
   - Submit

**What Happens**:
- Past Weekly Entries remain unchanged (they used the old pattern)
- Future Weekly Entries use the new pattern automatically
- Balance carries forward (doesn't reset)
- System automatically selects correct pattern for each date

### Day-Off Entries Auto-Creation

When you submit an Employee Work Pattern:
- System automatically creates `day_off` Roll Call entries for all days with 0 hours
- Entries are created for the pattern's validity period
- Source is set to "Pattern"
- Employees can swap these days if needed

### Pattern Validation

The system validates:
- No overlapping patterns (for same employee)
- Valid date ranges
- FTE percentage is reasonable (0-100%)
- At least one day has hours > 0

---

## Employee Configuration

Navigate to **Flexitime > Employee Presence Settings** to configure employee-specific Flexitime settings. This is where employees can also view their flexitime balance.

### Flexitime Balance

**Flexitime Balance** (`flexitime_balance`):
- Read-only field showing the employee's current running flexitime balance
- Automatically fetched from the Employee doctype
- Updated when weekly entries are submitted
- Employees can view but not edit this field

### Timesheet Usage

**Uses Timesheet** (`uses_timesheet`):
- Checkbox indicating if the employee uses ERPNext Timesheets for time tracking
- When enabled, weekly entries will pull actual hours from Timesheets
- When disabled, employees must manually enter hours in weekly entries

### Roll Call Visibility

**Show in Roll Call** (`show_in_roll_call`):
- Controls which employees appear in the Roll Call view
- Only employees with this checkbox enabled will be visible in roll call
- Default: Unchecked (employees must be explicitly enabled)
- HR-only field (employees cannot edit this)

**Use Case**: 
- Enable for employees who need to track daily presence
- Disable for executives or employees who don't need to submit roll call entries

### Weekly Entry Requirements

**Requires Weekly Entry** (`requires_weekly_entry`):
- Controls which employees must submit weekly entries
- Only employees with this checkbox enabled will:
  - Have weekly entries auto-created on Mondays
  - Receive weekly entry reminders
  - Appear in missing timesheet reports
- Default: Unchecked (employees don't require weekly entries by default)
- HR-only field (employees cannot edit this)

**Use Case**:
- Enable for employees who need to track and submit weekly hours
- Disable for executives or employees who don't need to submit weekly entries

### Setting Up New Employees

When adding a new employee to Flexitime:

1. **Enable Roll Call** (if needed):
   - Open the Employee record
   - Go to "Flexitime Settings" section
   - Check "Show in Roll Call" if employee needs to track daily presence

2. **Enable Weekly Entries** (if needed):
   - Check "Requires Weekly Entry" if employee needs to submit weekly timesheets

3. **Create Work Pattern** (if weekly entries are enabled):
   - See [Employee Work Patterns](#employee-work-patterns) section

**Note**: Both fields are HR-only and cannot be edited by employees themselves.

---

## Managing Weekly Entries

Navigate to **Flexitime > Weekly Entry** to manage weekly time summaries.

### Understanding Weekly Entry Lifecycle

1. **Auto-Created**: Every Monday at 06:00, system creates Weekly Entries for employees with "Requires Weekly Entry" enabled
2. **Draft**: Employee reviews and enters actual hours
3. **Submitted**: Employee submits (must be sequential - cannot skip weeks)
4. **Locked**: Auto-locked after configured days (can be unlocked by HR)

### Reviewing Employee Submissions

**List View**:
- Filter by employee, week, status
- View: employee, week start, total actual hours, total expected hours, weekly delta, running balance, status

**Detail View**:
- See all daily entries with presence types
- Review actual vs expected hours
- Check balance calculations
- View notes

### Unlocking and Amending Entries

**To Unlock**:
1. Open the Weekly Entry
2. Uncheck **Locked** field
3. Save

**To Amend**:
1. Unlock the entry
2. Make changes (actual hours, presence types, etc.)
3. Save
4. System automatically recalculates balance and cascades to future weeks

**Important**: Amending an entry recalculates all future weeks' balances automatically.

### Handling Missing Submissions

**From Dashboard**:
1. Navigate to **Flexitime > Dashboard**
2. View "Missing Timesheets" section
3. Click "Remind" for individual employees
4. Or click "Send All Reminders" for bulk

**Manually**:
1. Check Weekly Entry list for draft entries
2. Contact employees directly
3. Or use reminder functionality

**Creating Missing Entries**:
- System auto-creates entries every Monday
- If missing, you can create manually:
  1. Click **New Weekly Entry**
  2. Select employee and week start date
  3. System auto-populates from Roll Call

### Balance Recalculation

**Automatic**:
- Every Monday at 01:00, system recalculates all balances
- On Weekly Entry submit/cancel/amend, balance recalculates

**Manual**:
- Open Weekly Entry
- Click **Actions > Recalculate Balance**
- Or wait for scheduled task

**What Gets Recalculated**:
- Previous balance (from prior week)
- Weekly delta (actual - expected)
- Running balance (previous + delta)
- Employee's current balance field

---

## Roll Call Management

Navigate to **Flexitime > Roll Call** to manage daily presence tracking.

### Understanding the Roll Call Grid

**Grid Layout**:
- Rows: Employees (sorted alphabetically)
- Columns: Days of the week (Monday-Sunday)
- Cells: Show presence type icon and color

**Viewing Options**:
- Filter by department, company, branch
- Navigate between weeks
- See team presence (all employees visible)

### Editing Employee Entries

**As HR Manager**:
- Can edit any employee's entries
- Click cell to open edit dialog
- Select presence type
- Can use bulk operations

**Employee Restrictions**:
- Employees can only edit their own entries
- Cannot edit locked entries
- Cannot edit entries with approved leave

### Locking Past Entries

**Automatic Locking**:
- Daily at 00:05, system locks entries from completed weeks
- Prevents editing past entries

**Manual Locking**:
- Not typically needed (automatic)
- Can lock individual entries if needed

**Unlocking**:
- HR can unlock entries if corrections needed
- Unlock Roll Call Entry, make changes, save

### Bulk Operations

**Select Multiple Cells**:
1. Click and drag to select range
2. Or Ctrl+Click to select individual cells
3. Right-click or use toolbar button
4. Select presence type to apply
5. Choose "Full Day", "AM Only", or "PM Only"
6. Click Apply

**Bulk Delete**:
1. Select cells to delete
2. Right-click > Delete
3. Confirm

**Use Cases**:
- Setting team presence for same day
- Applying day off to multiple employees
- Bulk corrections

---

## Leave Integration

Flexitime automatically integrates with ERPNext Leave Applications.

### How Leave Syncs to Roll Call

**When Leave is Approved**:
1. System creates Roll Call Entry with matching Presence Type
2. Links Leave Application to Roll Call Entry
3. Updates Weekly Entry expected hours
4. Syncs to Google Calendar (if enabled)

**When Leave is Cancelled**:
1. System reverts Roll Call Entry
2. Updates Weekly Entry accordingly

### Flex Off Leave Type Setup

**Flex Off** is a special leave type that deducts from flexitime balance:

1. Navigate to **HR > Leave Type**
2. Verify "Flex Off" exists (created on install)
3. Settings:
   - **Is Leave Without Pay**: Yes
   - **Max Leaves Allowed**: 0 (unlimited)
   - **Is Compensatory**: No

4. In **Presence Type**:
   - Find/create Flex Off presence type
   - Link to "Flex Off" Leave Type
   - Check **Deducts from Flextime Balance**

**How It Works**:
- Expected hours remain at Work Pattern value (not reduced to 0)
- Actual hours: 0 (employee doesn't work)
- Weekly delta: negative (deducts from balance)
- Employee "spends" accumulated overtime

### Handling Leave Application Changes

**Approved Leave**:
- Creates Roll Call Entry automatically
- Cannot modify Roll Call Entry directly
- Must cancel Leave Application first

**Draft Leave**:
- Shows as tentative in Roll Call (striped pattern)
- Employee can see draft status
- Line manager can see draft status
- Others see as tentative

**Half-Day Leave**:
- System handles correctly
- AM or PM can be leave
- Expected hours adjusted accordingly

### Google Calendar Sync Configuration

**Setup**:
1. Enable in Flexitime Settings
2. Choose Calendar Mode (Primary or Shared)
3. If Shared: Enter Shared Leave Calendar ID
4. Employees authorize Google Calendar access

**How It Works**:
- When leave is approved, system creates calendar event
- Event includes leave type, dates, employee name
- Employees can see team absences in calendar
- Events update if leave is cancelled

**Troubleshooting**:
- Check employee has authorized Google Calendar
- Verify calendar permissions
- Check Error Log for sync errors

---

## Dashboard Usage

Navigate to **Flexitime > Dashboard** for HR overview and management.

### Today's Overview

**Number Cards**:
- Working Today: Count of employees working
- On Leave: Count on leave
- Day Off/Other: Count on day off or other

**Presence Distribution Chart**:
- Bar chart showing count by presence type
- Visual overview of today's presence

### Balance Alerts

**Shows**:
- Employees approaching limit (80% of limit)
- Employees over limit

**Actions**:
- Click employee name to view details
- Review balance and limit
- Contact employee if needed

**Alerts Sent**:
- Employees receive email alerts
- HR receives summary email

### Missing Roll Call - Next Week

**Shows**:
- Employees missing Roll Call entries for next week
- Which days are missing

**Actions**:
- Click "Remind" for individual employee
- Click "Send All Reminders" for bulk
- Reminders use "Roll Call Reminder" email template

### Missing Timesheets

**Shows**:
- Employees with unsubmitted Weekly Entries
- Status: Draft or Not Created
- Hours logged vs expected

**Actions**:
- Click "Remind" for individual employee
- Click "Send All Reminders" for bulk
- Reminders use "Timesheet Reminder" email template

### Leave Planning Summary

**Tentative Days**:
- Employees planning leave without Leave Application
- Shows date ranges and presence types
- Helps identify planning vs approved leave

**Pending Approval**:
- Leave Applications awaiting approval
- Shows employee, leave type, dates, days
- Click "Review" to open Leave Application

**Conflicts**:
- Days with 3+ people on leave
- Helps identify resource conflicts
- Shows date and employee names

**Actions**:
- Review pending approvals
- Identify conflicts early
- Plan coverage

### Sending Reminders

**Individual Reminders**:
1. Find employee in relevant section
2. Click "Remind" button
3. Email sent immediately

**Bulk Reminders**:
1. Click "Send All Reminders" button
2. Confirmation dialog appears
3. All employees in section receive reminders

**Email Templates Used**:
- Roll Call Reminder: For missing Roll Call entries
- Timesheet Reminder: For unsubmitted Weekly Entries

---

## Email Templates

Navigate to **Setup > Email Template** to manage reminder and alert templates.

### Available Templates

**Roll Call Reminder**
- Sent: Friday 09:00 (scheduled) or manually
- Recipients: Employees missing Roll Call entries
- Variables: `employee_name`, `week_start`, `week_end`, `missing_days`, `roll_call_url`

**Timesheet Reminder**
- Sent: Friday 14:00 (scheduled) or manually
- Recipients: Employees with unsubmitted Weekly Entries
- Variables: `employee_name`, `week_start`, `week_end`, `status`, `hours_logged`, `weekly_entry_url`

**Missing Timesheet Alert**
- Sent: Monday 09:00 (scheduled)
- Recipients: Employees with missing timesheets from last week
- Variables: `employee_name`, `week_start`, `week_end`

**HR Missing Timesheet Summary**
- Sent: Monday 09:00 (scheduled)
- Recipients: HR Managers
- Variables: `week_start`, `missing_count`, `missing_employees`

**Balance Over Limit**
- Sent: Monday 08:00 (scheduled)
- Recipients: Employees over flexitime limit
- Variables: `employee_name`, `balance`, `limit`, `over_by`

**Balance Warning**
- Sent: Monday 08:00 (scheduled)
- Recipients: Employees approaching limit (80%)
- Variables: `employee_name`, `balance`, `limit`, `percentage`

**HR Balance Alerts Summary**
- Sent: Monday 08:00 (scheduled)
- Recipients: HR Managers
- Variables: `alerts` (list of employees with warnings)

### Customizing Templates

1. Open Email Template
2. Edit **Subject** and **Response** fields
3. Use Jinja2 template syntax
4. Available variables listed above
5. Save

**Example Subject**:
```
Reminder: Fill Roll Call for {{ week_start }} - {{ week_end }}
```

**Example Response**:
```
Hi {{ employee_name }},

Please fill your Roll Call for the week of {{ week_start }} to {{ week_end }}.

Missing days: {{ missing_days }}

[Fill Roll Call]({{ roll_call_url }})
```

### Template Variables Reference

All templates have access to Frappe's standard variables plus custom ones:

**Standard**:
- `user`: Current user
- `today`: Today's date

**Custom (varies by template)**:
- `employee_name`: Employee's full name
- `week_start`, `week_end`: Week dates (formatted)
- `missing_days`: Comma-separated list of missing days
- `balance`, `limit`: Balance values
- `roll_call_url`, `weekly_entry_url`: Direct links

---

## Monitoring & Alerts

### Balance Limit Alerts

**When Sent**:
- Monday 08:00 (scheduled)
- When balance exceeds limit
- When balance exceeds 80% of limit (warning)

**Recipients**:
- Employee (individual alert)
- HR Managers (summary)

**Actions**:
- Review employee's balance history
- Contact employee if needed
- Plan Flex Off if positive balance
- Plan extra work if negative balance

### Missing Submission Alerts

**When Sent**:
- Monday 09:00 (scheduled)
- For unsubmitted Weekly Entries from last week

**Recipients**:
- Employee (individual alert)
- HR Managers (summary)

**Actions**:
- Follow up with employees
- Help resolve issues
- Ensure compliance

### Scheduled Task Monitoring

**Check Task Status**:
1. Navigate to **Setup > Scheduled Job Type**
2. Filter by "Flexitime"
3. Review last execution times
4. Check for errors

**Key Tasks**:
- `lock_past_roll_call`: Daily 00:05
- `auto_create_roll_call_entries`: Daily 00:10
- `sync_timesheet_hours`: Every 2 hours
- `create_weekly_entries`: Monday 06:00
- `calculate_weekly_balances`: Monday 01:00
- `check_balance_limits`: Monday 08:00
- `send_roll_call_reminders`: Friday 09:00
- `send_timesheet_reminders`: Friday 14:00

**Troubleshooting**:
- Check Error Log for task failures
- Verify scheduler is running
- Check task logs for details

### Error Log Review

**Navigate to**: **Setup > Error Log**

**Filter by**:
- "Flexitime" in message
- Recent errors
- Critical errors

**Common Errors**:
- Missing presence types
- Balance calculation errors
- Calendar sync failures
- Permission errors

**Actions**:
- Review error details
- Fix underlying issues
- Re-run failed operations if needed

---

## Troubleshooting

### Missing Presence Types Error

**Error**: "Required Presence Type 'xxx' not found"

**Solution**:
```bash
bench --site <your-site> execute flexitime.install.after_install
```

This re-creates required system presence types.

### Balance Calculation Issues

**Problem**: Balance seems incorrect

**Check**:
1. Verify Work Pattern is submitted and valid for the date
2. Check Weekly Entry calculations:
   - Total actual hours
   - Total expected hours
   - Weekly delta
3. Verify previous week's balance
4. Check for amendments that might have affected balance

**Fix**:
1. Open Weekly Entry
2. Click **Actions > Recalculate Balance**
3. Or wait for Monday 01:00 scheduled task

**Common Causes**:
- Work Pattern not submitted
- Expected hours calculation wrong
- Previous week not submitted
- Amendments not cascaded

### Entry Locking Problems

**Problem**: Entries locked when they shouldn't be

**Check**:
1. Verify entry date (past entries auto-lock)
2. Check auto-lock settings in Flexitime Settings
3. Review entry's locked_on timestamp

**Fix**:
1. HR can unlock entries manually
2. Adjust auto-lock settings if needed
3. Verify locking schedule is correct

### Calendar Sync Issues

**Problem**: Leave not syncing to Google Calendar

**Check**:
1. Verify calendar sync enabled in Flexitime Settings
2. Check employee has authorized Google Calendar
3. Review Error Log for sync errors
4. Verify calendar permissions

**Fix**:
1. Re-authorize Google Calendar for employee
2. Check calendar ID is correct (for shared calendar)
3. Verify calendar permissions
4. Check Error Log for specific errors

### Weekly Entry Not Created

**Problem**: Weekly Entry missing for employee

**Check**:
1. Verify employee is Active
2. Check if entry already exists
3. Review scheduled task logs
4. Verify employee has Work Pattern

**Fix**:
1. Create manually: **New Weekly Entry**
2. Select employee and week start
3. System auto-populates from Roll Call
4. Or wait for next Monday 06:00 creation

### Roll Call Not Loading

**Problem**: Roll Call page not loading or showing errors

**Check**:
1. Clear browser cache
2. Check browser console for JavaScript errors
3. Verify user has Employee record linked
4. Check permissions

**Fix**:
1. Clear cache and reload
2. Run: `bench build --app flexitime`
3. Check Error Log for backend errors
4. Verify user permissions

### Presence Type Not Showing

**Problem**: Presence type not available in selection dialog

**Check**:
1. Verify `available_to_all` is checked OR employee has permission
2. Check `show_in_quick_dialog` setting
3. Verify `day_off_presence_type` in Flexitime Settings is configured correctly
4. Check if presence type is system type (not selectable)

**Fix**:
1. Update presence type settings
2. Add employee permission if needed
3. Check Work Pattern for day off requirements

### Leave Not Syncing to Roll Call

**Problem**: Approved leave not creating Roll Call entry

**Check**:
1. Verify Presence Type is linked to Leave Type
2. Check Leave Application is Approved and Submitted
3. Verify date range matches
4. Review Error Log

**Fix**:
1. Link Presence Type to Leave Type
2. Ensure Leave Application is properly approved
3. Manually create Roll Call entry if needed
4. Check event handlers are registered

---

## Additional Resources

- [Flexitime Balance Guide](../flexitime_balance_guide.md) - Detailed balance calculation explanation
- [Developer Guide](./developer-guide.md) - Technical documentation
- [End-User Guide](./end-user-guide.md) - Employee documentation

For technical support or questions, refer to the Developer Guide or contact your system administrator.
