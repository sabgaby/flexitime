# Flexitime Developer Guide

This guide is for developers extending, customizing, and troubleshooting the Flexitime application.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core DocTypes](#core-doctypes)
3. [API Reference](#api-reference)
4. [Scheduled Tasks](#scheduled-tasks)
5. [Permission System](#permission-system)
6. [Balance Calculation Logic](#balance-calculation-logic)
7. [Leave Integration](#leave-integration)
8. [Customization Points](#customization-points)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)
11. [Development Workflow](#development-workflow)

---

## Architecture Overview

### Application Structure

```
flexitime/
├── flexitime/                    # App root
│   ├── hooks.py                 # App hooks, scheduled tasks, fixtures
│   ├── install.py              # Post-installation setup
│   ├── modules.txt             # Module definition
│   ├── api/                    # API endpoints
│   │   └── roll_call.py        # Roll Call API
│   └── flexitime/              # Main module
│       ├── api.py              # Dashboard API
│       ├── utils.py           # Utility functions
│       ├── permissions.py     # Permission handlers
│       ├── doctype/           # DocType definitions
│       ├── events/             # Document event handlers
│       ├── tasks/              # Scheduled tasks
│       └── page/               # Page definitions
```

### Key DocTypes and Relationships

```
Employee
├── Employee Work Pattern (1:N, date-based)
├── Roll Call Entry (1:N, by date)
└── Weekly Entry (1:N, by week)

Weekly Entry
├── Daily Entry (1:N, child table)
└── References Roll Call Entry (for presence type sync)

Roll Call Entry
├── Links to Presence Type
├── Links to Leave Application (optional)
└── Syncs to Weekly Entry Daily Entry

Presence Type
├── Links to Leave Type (optional)
└── Used by Roll Call Entry, Daily Entry

Leave Application (ERPNext)
└── Creates/updates Roll Call Entry (via events)
```

### Data Flow

**Daily Presence Tracking**:
```
Employee → Roll Call Entry → Weekly Entry Daily Entry
```

**Weekly Balance Calculation**:
```
Weekly Entry → Calculate Delta → Update Running Balance → Employee Balance Field
```

**Leave Integration**:
```
Leave Application (Approved) → Event Handler → Roll Call Entry → Weekly Entry
```

### Permission Model

- **HR Manager**: Full access to all documents
- **Employee**: 
  - Roll Call Entry: Read all, write own
  - Weekly Entry: Read/write own (draft only)
  - Work Pattern: Read own (read-only)

---

## Core DocTypes

### Roll Call Entry

**Location**: `flexitime/flexitime/doctype/roll_call_entry/`

**Key Methods**:
- `validate()`: Validates presence type, leave application, locked status
- `on_update()`: Syncs to Weekly Entry

**Key Fields**:
- `employee`, `date`: Primary identifiers
- `presence_type`: Links to Presence Type
- `is_half_day`: Boolean for split entries
- `am_presence_type`, `pm_presence_type`: Split day support
- `leave_application`: Auto-linked Leave Application
- `is_locked`: Prevents editing
- `source`: Manual, System, Leave, Pattern

**Validation**:
- Presence type must be valid
- Leave type presence requires Leave Application
- Cannot edit locked entries (except system updates)
- Cannot set leave if hours already recorded

### Weekly Entry

**Location**: `flexitime/flexitime/doctype/weekly_entry/`

**Key Methods**:
- `autoname()`: Generates name from employee and ISO week
- `validate()`: Validates week, calculates totals, checks sequential submission
- `on_submit()`: Updates employee balance, records submission timestamp
- `on_cancel()`: Triggers balance recalculation
- `on_update_after_submit()`: Cascades balance recalculation

**Key Fields**:
- `employee`, `week_start`, `week_end`: Identifiers
- `daily_entries`: Child table (Daily Entry)
- `total_actual_hours`: Sum of daily actual_hours
- `total_expected_hours`: Calculated from Work Pattern, holidays, leaves
- `weekly_delta`: Actual - Expected
- `previous_balance`: From previous week's running_balance
- `running_balance`: previous_balance + weekly_delta
- `is_locked`: Auto-locked after submission

**Balance Chain**:
```python
running_balance = previous_balance + weekly_delta
```

**Sequential Submission**:
- Cannot submit Week N if Week N-1 is draft
- HR Managers can bypass
- Ensures balance chain integrity

### Employee Work Pattern

**Location**: `flexitime/flexitime/doctype/employee_work_pattern/`

**Key Methods**:
- `validate()`: Validates date ranges, FTE, hours
- `on_submit()`: Auto-creates day_off Roll Call entries
- `get_hours_for_weekday()`: Returns expected hours for a weekday

**Key Fields**:
- `employee`, `valid_from`, `valid_to`: Date-based validity
- `fte_percentage`: Full-time equivalent (0-100)
- `flexitime_limit_hours`: Maximum balance
- `monday_hours` through `sunday_hours`: Daily expected hours
- `weekly_expected_hours`: Auto-calculated sum

**Pattern Selection**:
```python
def get_work_pattern(employee, date):
    """Returns active pattern for date"""
    # valid_from <= date AND (valid_to >= date OR valid_to IS NULL)
    # docstatus = 1 (submitted)
```

### Presence Type

**Location**: `flexitime/flexitime/doctype/presence_type/`

**Key Methods**:
- `validate()`: Validates parent and leave type settings
- `get_available_presence_types()`: Returns selectable types for employee/date (filters day off type based on Flexitime Settings)

**Key Fields**:
- `presence_name`: Unique identifier
- `expect_work_hours`: If checked, expects work hours from Employee Work Pattern. If unchecked, expected hours are 0.
- `requires_leave_application`: Requires Leave Application
- `leave_type`: Links to ERPNext Leave Type
- `available_to_all`: All employees can select

**System Configuration (Flexitime Settings)**:
- `holiday_presence_type`: Presence Type used for holidays from Holiday List
- `day_off_presence_type`: Presence Type used for scheduled days off from Work Pattern (only available on days with 0 expected hours)

**Expected Hours Logic**:
- If `expect_work_hours=1`: Uses Work Pattern hours (office, home, offsite, flex_off)
- If `expect_work_hours=0`: 0 hours (vacation, sick, holiday, day_off, etc.)
- Flex Off has `expect_work_hours=1`, so it keeps expected hours from the pattern and deducts from balance

### Flexitime Settings

**Location**: `flexitime/flexitime/doctype/flexitime_settings/`

**Key Methods**:
- `get_settings()`: Returns cached settings document

**Key Fields**:
- `roll_call_start_day`: Today or Start of Week
- `roll_call_display_name`: Name format
- `enable_calendar_sync`: Google Calendar toggle
- `calendar_mode`: Primary or Shared
- `enable_auto_lock`: Auto-lock toggle
- `auto_lock_after_days`: Days before locking
- `enable_submission_reminders`: Reminder toggle
- `submission_reminder_day`: Day of week for reminders

---

## API Reference

### Roll Call API

**Module**: `flexitime.api.roll_call`

**Base Path**: `/api/method/flexitime.api.roll_call`

#### `get_events(month_start, month_end, employee_filters=None)`

Fetch Roll Call entries for a date range with leave application status.

**Parameters**:
- `month_start` (str): Start date (YYYY-MM-DD)
- `month_end` (str): End date (YYYY-MM-DD)
- `employee_filters` (dict, optional): Filters for employees (company, department, branch)

**Returns**:
```python
{
    "entries": {
        "employee_id": [
            {
                "name": "entry_name",
                "employee": "employee_id",
                "date": "2025-01-15",
                "presence_type": "office",
                "presence_type_icon": "🏢",
                "presence_type_label": "Office",
                "is_half_day": False,
                "am_presence_type": None,
                "pm_presence_type": None,
                "leave_status": "none" | "approved" | "draft" | "tentative",
                "is_locked": False
            }
        ]
    },
    "pending_leaves": {
        "employee_id": {
            "2025-01-15": [
                {
                    "name": "leave_app_name",
                    "leave_type": "Vacation",
                    "status": "Open",
                    "is_half_day": False,
                    "presence_type": "vacation",
                    "icon": "🏖️",
                    "label": "Vacation"
                }
            ]
        }
    },
    "current_employee": "employee_id",
    "warnings": {
        "missing_work_patterns": [...]
    }
}
```

**Notes**: Auto-creates holiday and day_off entries. Returns leave status for visualization.

#### `save_entry(employee, date, presence_type, is_half_day=False)`

Save or update a single Roll Call entry (full day).

**Parameters**:
- `employee` (str): Employee ID
- `date` (str): Date (YYYY-MM-DD)
- `presence_type` (str): Presence Type name
- `is_half_day` (bool): Whether it's a half day

**Returns**: Entry dict with leave_status calculated

**Permission**: Employee can only edit own entries (HR can edit all)

**Notes**: Validates presence type and leave application. Auto-links Leave Application if found. Syncs to Weekly Entry.

#### `save_split_entry(employee, date, am_presence_type, pm_presence_type)`

Save or update a split AM/PM Roll Call entry.

**Parameters**:
- `employee` (str): Employee ID
- `date` (str): Date (YYYY-MM-DD)
- `am_presence_type` (str): Morning presence type
- `pm_presence_type` (str): Afternoon presence type

**Returns**: Entry dict with leave_status calculated

**Notes**: Validates both presence types. Uses AM for primary presence_type.

#### `save_bulk_entries(entries, presence_type, day_part="full")`

Save multiple Roll Call entries at once.

**Parameters**:
- `entries` (list): List of `{employee, date}` dicts
- `presence_type` (str): Presence Type to apply
- `day_part` (str): "full", "am", or "pm"

**Returns**: `{"saved": count, "total": count, "entries": [...]}`

**Notes**: Optimized with batch queries. Skips locked entries.

#### `get_leave_planning_summary(year=None, employee_filter=None)`

Get aggregated leave planning data for dashboards.

**Parameters**:
- `year` (str, optional): Year to summarize (default: current year)
- `employee_filter` (str, optional): "managed", "all", or employee ID

**Returns**:
```python
{
    "year": "2025",
    "tentative": {
        "total_days": 15,
        "employee_count": 3,
        "by_employee": [
            {
                "employee": "employee_id",
                "employee_name": "John Doe",
                "days": 5,
                "date_ranges": [
                    {
                        "from_date": "2025-02-10",
                        "to_date": "2025-02-14",
                        "presence_type": "vacation",
                        "label": "Vacation",
                        "days": 5
                    }
                ]
            }
        ]
    },
    "pending_approval": {
        "count": 2,
        "applications": [...]
    },
    "conflicts": [
        {
            "date": "2025-02-15",
            "count": 3,
            "employees": [...]
        }
    ]
}
```

### Dashboard API

**Module**: `flexitime.flexitime.api`

**Base Path**: `/api/method/flexitime.flexitime.api`

#### `get_today_overview(date=None)`

Get count of employees by presence type for today.

**Parameters**:
- `date` (str, optional): Date to get overview for (default: today)

**Returns**: `{"presence_type": count, ...}`

#### `get_balance_alerts()`

Get employees with balance warnings or over limit.

**Returns**: List of employees with balance issues

**Permission**: HR Manager only

#### `get_missing_roll_call_next_week()`

Get employees missing Roll Call entries for next week.

**Returns**: List of employees with missing days

#### `get_missing_timesheets()`

Get employees with missing or draft Weekly Entries.

**Returns**: List of employees with missing submissions

#### `send_reminder(employee, reminder_type)`

Send reminder to a specific employee.

**Parameters**:
- `employee` (str): Employee ID
- `reminder_type` (str): "roll-call" or "timesheet"

**Permission**: HR Manager only

#### `send_all_reminders(reminder_type)`

Send reminders to all employees with missing data.

**Parameters**:
- `reminder_type` (str): "roll-call" or "timesheet"

**Permission**: HR Manager only

---

## Scheduled Tasks

### Daily Tasks

**Module**: `flexitime.flexitime.tasks.daily`

#### `lock_past_roll_call()`

**Schedule**: Daily 00:05

**Purpose**: Locks Roll Call entries from completed weeks

**Implementation**:
```python
# Lock all entries before current week
frappe.db.sql("""
    UPDATE `tabRoll Call Entry`
    SET is_locked = 1
    WHERE date < %s AND is_locked = 0
""", current_week_start)
```

#### `auto_create_roll_call_entries()`

**Schedule**: Daily 00:10

**Purpose**: Pre-creates system entries for holidays for next 2 weeks

**Implementation**:
- Loops through active employees
- Checks Holiday List for each date
- Creates `holiday` Roll Call entries
- Skips if entry already exists

**Notes**: Only creates holidays. Day_off entries created by Work Pattern on submit.

#### `sync_timesheet_hours()`

**Schedule**: Every 2 hours (`0 */2 * * *`)

**Purpose**: Updates Daily Entry timesheet_hours from ERPNext Timesheets

**Implementation**:
- Gets all Draft Weekly Entries for current and previous week
- For each Daily Entry, fetches Timesheet hours
- Updates timesheet_hours field
- Saves Weekly Entry if changed

#### `auto_lock_submitted_entries()`

**Schedule**: Daily

**Purpose**: Locks submitted Weekly Entries after configured days

**Implementation**:
- Reads `enable_auto_lock` and `auto_lock_after_days` from Flexitime Settings
- Finds submitted but not locked entries
- Calculates days since submission
- Locks if days >= auto_lock_after_days

### Weekly Tasks

**Module**: `flexitime.flexitime.tasks.weekly`

#### `create_weekly_entries()`

**Schedule**: Monday 06:00

**Purpose**: Creates Weekly Entry documents for current week

**Implementation**:
- Gets Monday of current week
- Loops through active employees
- Checks if entry already exists
- Creates Weekly Entry if missing
- Auto-populates from Roll Call

#### `calculate_weekly_balances()`

**Schedule**: Monday 01:00

**Purpose**: Recalculates running flexitime balance for all employees

**Implementation**:
```python
for employee in employees:
    entries = get_all_submitted_weekly_entries(employee, order_by="week_start")
    running_balance = 0
    for entry in entries:
        entry.previous_balance = running_balance
        entry.running_balance = running_balance + entry.weekly_delta
        running_balance = entry.running_balance
        save_entry(entry)
    update_employee_balance(employee, running_balance)
```

**Notes**: Runs through all submitted entries in order. Updates Employee.custom_flexitime_balance.

#### `check_balance_limits()`

**Schedule**: Monday 08:00

**Purpose**: Checks for employees exceeding flexitime limits

**Implementation**:
- Gets Work Pattern for each employee
- Reads flexitime_limit_hours
- Compares with current balance
- Sends alerts if:
  - Balance > limit (over limit)
  - Balance > limit × 0.8 (warning)
- Sends summary to HR

#### `send_roll_call_reminders()`

**Schedule**: Friday 09:00

**Purpose**: Emails employees to fill Roll Call for next week

**Implementation**:
- Gets next week's date range
- Finds employees with missing Roll Call entries
- Sends "Roll Call Reminder" email template

#### `send_timesheet_reminders()`

**Schedule**: Friday 14:00

**Purpose**: Emails employees with unsubmitted Weekly Entry

**Implementation**:
- Gets current week
- Finds employees with draft or missing Weekly Entry
- Sends "Timesheet Reminder" email template

#### `send_missing_timesheet_alerts()`

**Schedule**: Monday 09:00

**Purpose**: Alerts employees and HR about missing timesheets from last week

**Implementation**:
- Gets last week's start date
- Finds employees with draft or missing Weekly Entry
- Sends "Missing Timesheet Alert" to employees
- Sends "HR Missing Timesheet Summary" to HR

#### `send_submission_reminders()`

**Schedule**: Monday 09:00 (configurable day)

**Purpose**: Configurable reminders based on Flexitime Settings

**Implementation**:
- Reads `submission_reminder_day` from settings
- Checks if today matches reminder day
- Finds employees with unsubmitted entries
- Sends reminders using configured template

---

## Permission System

### Custom Permission Queries

**Location**: `flexitime/flexitime/permissions.py`

**Registered in**: `hooks.py` → `permission_query_conditions`

#### Roll Call Entry

```python
def roll_call_entry_query(user):
    # HR Manager: see all
    if "HR Manager" in frappe.get_roles(user):
        return ""
    # All employees: see all (team visibility)
    return ""
```

**Result**: All employees can see all Roll Call entries (for team visibility).

#### Weekly Entry

```python
def weekly_entry_query(user):
    if "HR Manager" in frappe.get_roles(user):
        return ""
    employee = get_employee_for_user(user)
    return f"`tabWeekly Entry`.employee = {frappe.db.escape(employee)}"
```

**Result**: Employees only see their own Weekly Entries.

#### Employee Work Pattern

```python
def employee_work_pattern_query(user):
    if "HR Manager" in frappe.get_roles(user):
        return ""
    employee = get_employee_for_user(user)
    return f"`tabEmployee Work Pattern`.employee = {frappe.db.escape(employee)}"
```

**Result**: Employees only see their own Work Patterns.

### Document-Level Permissions

**Registered in**: `hooks.py` → `has_permission`

#### Roll Call Entry

```python
def has_roll_call_permission(doc, ptype, user):
    if "HR Manager" in frappe.get_roles(user):
        return True
    employee = get_employee_for_user(user)
    if ptype == "read":
        return True  # All can read
    if ptype in ("write", "create"):
        if doc.employee != employee:
            return False  # Can only write own
        if doc.is_locked and doc.source != "Leave":
            return False  # Cannot edit locked
        return True
    return False
```

#### Weekly Entry

```python
def has_weekly_entry_permission(doc, ptype, user):
    if "HR Manager" in frappe.get_roles(user):
        return True
    employee = get_employee_for_user(user)
    if doc.employee != employee:
        return False
    if ptype == "write":
        if doc.status != "Draft":
            return False  # Can only edit draft
    return True
```

---

## Balance Calculation Logic

### Expected Hours Calculation

**Function**: `calculate_weekly_expected_hours_with_holidays()`

**Location**: `flexitime/flexitime/utils.py`

**Formula**:
```python
# 1. Base weekly hours from Company
base_weekly_hours = Company.base_weekly_hours  # Default: 40

# 2. FTE weekly hours
fte_weekly_hours = base_weekly_hours × (fte_percentage / 100)

# 3. Work days per week (days with > 0 hours in pattern)
work_days = count(pattern.days where hours > 0)

# 4. Daily average
daily_average = fte_weekly_hours / work_days

# 5. Count holidays on work days
holidays_count = count(holidays where weekday is work day)

# 6. Count leave days where expect_work_hours=0 on work days
regular_leaves_count = count(leaves where weekday is work day and expect_work_hours=0)

# 7. Count half-day leaves
half_leaves_count = count(half_day_leaves where weekday is work day and expect_work_hours=0)

# 8. Expected hours
expected_hours = (
    fte_weekly_hours -
    (holidays_count × daily_average) -
    (regular_leaves_count × daily_average) -
    (half_leaves_count × daily_average / 2)
)
```

**Notes**:
- Flex Off (expect_work_hours=1) does NOT reduce expected hours
- Expected hours stay at Work Pattern value for Flex Off
- This allows balance deduction when employee works 0 hours on Flex Off day

### Weekly Delta Calculation

```python
weekly_delta = total_actual_hours - total_expected_hours
```

- Positive: Overtime (added to balance)
- Negative: Undertime (deducted from balance)

### Running Balance Chain

```python
# Week 1
previous_balance = 0
running_balance = previous_balance + weekly_delta_1

# Week 2
previous_balance = Week1.running_balance
running_balance = previous_balance + weekly_delta_2

# Week 3
previous_balance = Week2.running_balance
running_balance = previous_balance + weekly_delta_3
```

**Storage**:
- Each Weekly Entry stores `previous_balance` and `running_balance`
- Employee.custom_flexitime_balance stores current balance
- Updated on Weekly Entry submit

### Balance Recalculation

**Triggered by**:
- Weekly Entry cancel
- Weekly Entry amendment (update after submit)
- Scheduled task (Monday 01:00)

**Process**:
```python
def recalculate_future_balances(employee, from_week_start):
    # Get all submitted entries after from_week_start
    entries = get_submitted_entries(employee, week_start >= from_week_start)
    
    # Get previous week's balance
    prev_entry = get_previous_entry(employee, from_week_start)
    running_balance = prev_entry.running_balance if prev_entry else 0
    
    # Recalculate each entry
    for entry in entries:
        entry.previous_balance = running_balance
        entry.running_balance = running_balance + entry.weekly_delta
        running_balance = entry.running_balance
        save_entry(entry)
    
    # Update employee balance
    update_employee_balance(employee, running_balance)
```

---

## Leave Integration

### Event Handlers

**Location**: `flexitime/flexitime/events/leave_application.py`

**Registered in**: `hooks.py` → `doc_events`

#### `before_submit()`

**Purpose**: Validates no hours recorded for leave dates

**Implementation**:
```python
def before_submit(doc, method):
    # Check if hours recorded for leave dates
    for date in leave_date_range:
        weekly_entry = get_weekly_entry(employee, date)
        if weekly_entry and has_hours_recorded(date):
            frappe.throw("Cannot submit leave. Hours already recorded.")
```

#### `on_update()`

**Purpose**: Creates/updates Roll Call entries when leave is approved

**Implementation**:
```python
def on_update(doc, method):
    if doc.status == "Approved" and doc.docstatus == 1:
        # Create Roll Call entries for leave dates
        presence_type = get_presence_type_for_leave_type(doc.leave_type)
        for date in leave_date_range:
            create_or_update_roll_call_entry(
                employee=doc.employee,
                date=date,
                presence_type=presence_type,
                leave_application=doc.name,
                source="Leave"
            )
        # Sync to Weekly Entry
        sync_to_weekly_entry(doc.employee, leave_date_range)
    
    elif doc.status == "Cancelled":
        # Revert Roll Call entries
        revert_roll_call_entries(doc.employee, leave_date_range)
```

### Auto-Linking Leave Applications

**Function**: `validate_presence_type_for_roll_call()`

**Location**: `flexitime/api/roll_call.py`

**Process**:
1. Check if presence type is leave type
2. Look for matching Leave Application:
   - Employee matches
   - Date within from_date/to_date
   - Leave Type matches
   - Status is Open or Approved
3. Auto-link if found
4. Throw error if required but not found

### Calendar Sync

**Implementation**: In `on_update()` event handler

**Process**:
1. Check if calendar sync enabled in Flexitime Settings
2. Check calendar mode (Primary or Shared)
3. Create Google Calendar event:
   - Title: Leave type + employee name
   - Dates: Leave date range
   - Calendar: Employee's calendar or shared calendar
4. Store event ID and URL in Leave Application custom fields

---

## Customization Points

### Adding Custom Presence Types

1. Create Presence Type document
2. Set expect_work_hours (1 = expects work hours from pattern, 0 = 0 expected hours)
3. Configure settings (available_to_all, requires_leave_application, etc.)
4. Link to Leave Type if needed
5. Set icon and color

**No code changes required** - system automatically picks up new presence types.

### Customizing Email Templates

1. Navigate to **Setup > Email Template**
2. Find template (e.g., "Roll Call Reminder")
3. Edit Subject and Response fields
4. Use Jinja2 template syntax
5. Available variables documented in Admin Guide

### Extending API Endpoints

**Add new endpoint**:

```python
# In flexitime/flexitime/api.py or flexitime/api/roll_call.py

@frappe.whitelist()
def your_new_endpoint(param1, param2):
    """Your endpoint documentation"""
    # Permission check
    if "HR Manager" not in frappe.get_roles():
        frappe.throw("Permission denied")
    
    # Your logic
    result = do_something(param1, param2)
    
    return result
```

**Register in hooks** (if needed for scheduled access):
```python
# In hooks.py
scheduler_events = {
    "daily": [
        "flexitime.flexitime.api.your_new_endpoint"
    ]
}
```

### Custom Validations

**Add to DocType Python file**:

```python
class YourDocType(Document):
    def validate(self):
        # Your custom validation
        if self.some_field > self.other_field:
            frappe.throw("Validation error message")
        
        # Call parent validations
        super().validate()
```

### Client Scripts

**Location**: `flexitime/fixtures/client_script.json`

**Add custom client script**:
1. Create client script in Frappe
2. Set DocType and script type
3. Add to fixtures if needed
4. Or create manually in Frappe UI

---

## Testing

### Running Tests

```bash
# Run all Flexitime tests
bench --site <your-site> run-tests --app flexitime

# Run specific test file
bench --site <your-site> run-tests --doctype "Weekly Entry"

# Run with coverage
bench --site <your-site> run-tests --app flexitime --coverage
```

### Test File Locations

- `flexitime/tests/test_utils.py`: Utility function tests
- `flexitime/tests/test_roll_call_api.py`: Roll Call API tests
- `flexitime/tests/test_leave_integration.py`: Leave integration tests
- `flexitime/flexitime/doctype/weekly_entry/test_weekly_entry.py`: Weekly Entry tests
- `flexitime/flexitime/doctype/roll_call_entry/test_roll_call_entry.py`: Roll Call Entry tests
- `flexitime/flexitime/doctype/employee_work_pattern/test_employee_work_pattern.py`: Work Pattern tests

### Writing New Tests

**Example test structure**:

```python
import frappe
import unittest
from frappe.tests.utils import FrappeTestCase

class TestYourFeature(FrappeTestCase):
    def setUp(self):
        """Set up test data"""
        self.employee = create_test_employee()
        self.work_pattern = create_test_work_pattern(self.employee)
    
    def test_your_feature(self):
        """Test your feature"""
        # Arrange
        # Act
        result = your_function()
        # Assert
        self.assertEqual(result, expected_value)
    
    def tearDown(self):
        """Clean up test data"""
        frappe.db.rollback()
```

---

## Troubleshooting

### Common Errors

#### "Required Presence Type 'xxx' not found"

**Cause**: Installation setup didn't run or failed

**Solution**:
```bash
bench --site <your-site> execute flexitime.install.after_install
```

#### "Cannot submit Weekly Entry. Previous week must be submitted first"

**Cause**: Sequential submission validation

**Solution**: Submit previous week first, or HR Manager can bypass

#### Balance calculation wrong

**Debug steps**:
1. Check Work Pattern is submitted and valid for date
2. Verify expected hours calculation
3. Check previous week's balance
4. Review Weekly Entry calculations
5. Check for amendments that might have affected balance

**Fix**:
```python
# Manual recalculation
bench --site <your-site> execute flexitime.flexitime.doctype.weekly_entry.weekly_entry.recalculate_future_balances --employee "HR-EMP-00001" --from_week_start "2025-01-13"
```

### Debugging Balance Calculations

**Check expected hours**:
```python
from flexitime.flexitime.utils import calculate_weekly_expected_hours_with_holidays

expected = calculate_weekly_expected_hours_with_holidays(
    employee="HR-EMP-00001",
    week_start="2025-01-13"
)
print(f"Expected hours: {expected}")
```

**Check balance chain**:
```python
entries = frappe.get_all("Weekly Entry",
    filters={"employee": "HR-EMP-00001", "docstatus": 1},
    fields=["week_start", "previous_balance", "weekly_delta", "running_balance"],
    order_by="week_start"
)
for entry in entries:
    print(f"Week {entry.week_start}: prev={entry.previous_balance}, delta={entry.weekly_delta}, running={entry.running_balance}")
```

### Performance Optimization

**Batch operations**: Use batch queries instead of loops

**Example**:
```python
# Bad: N queries
for employee in employees:
    entry = frappe.get_doc("Roll Call Entry", {"employee": employee})

# Good: 1 query
entries = frappe.get_all("Roll Call Entry",
    filters={"employee": ["in", employee_list]},
    fields=["name", "employee", "date"]
)
```

**Indexes**: Ensure database indexes on:
- Roll Call Entry: (employee, date)
- Weekly Entry: (employee, week_start)
- Employee Work Pattern: (employee, valid_from, valid_to)

### Database Queries for Debugging

**Find employees with balance issues**:
```sql
SELECT 
    e.name,
    e.employee_name,
    e.custom_flexitime_balance,
    ewp.flexitime_limit_hours
FROM `tabEmployee` e
LEFT JOIN `tabEmployee Work Pattern` ewp ON ewp.employee = e.name
WHERE e.status = 'Active'
AND ABS(e.custom_flexitime_balance) > ewp.flexitime_limit_hours;
```

**Find missing Weekly Entries**:
```sql
SELECT 
    e.name,
    e.employee_name,
    DATE_ADD(CURDATE(), INTERVAL -WEEKDAY(CURDATE()) DAY) as week_start
FROM `tabEmployee` e
WHERE e.status = 'Active'
AND NOT EXISTS (
    SELECT 1 FROM `tabWeekly Entry` we
    WHERE we.employee = e.name
    AND we.week_start = DATE_ADD(CURDATE(), INTERVAL -WEEKDAY(CURDATE()) DAY)
);
```

---

## Development Workflow

### Code Style

**Python**: Uses `ruff` for linting
```bash
ruff check flexitime/
ruff format flexitime/
```

**JavaScript**: Uses `eslint` and `prettier`
```bash
cd flexitime
npm run lint
npm run format
```

**Pre-commit hooks**: Configured in `.pre-commit-config.yaml`

### Pre-commit Setup

```bash
cd apps/flexitime
pre-commit install
```

### Contributing Guidelines

1. Create feature branch
2. Make changes
3. Run tests: `bench --site <site> run-tests --app flexitime`
4. Run linters: `ruff check .` and `npm run lint`
5. Commit with descriptive message
6. Create pull request

### Building Assets

```bash
# Build JavaScript/CSS
bench build --app flexitime

# Watch mode (development)
bench watch --app flexitime
```

### Database Migrations

**Create patch**:
1. Create file in `flexitime/patches/v1_x/your_patch.py`
2. Add to `patches.txt`
3. Patch runs automatically on `bench migrate`

**Example patch**:
```python
import frappe

def execute():
    # Your migration code
    frappe.db.sql("""
        ALTER TABLE `tabRoll Call Entry`
        ADD COLUMN new_field VARCHAR(255)
    """)
```

---

## Additional Resources

- [Admin Guide](./admin-guide.md) - HR management documentation
- [End-User Guide](./end-user-guide.md) - Employee documentation
- [Flexitime Balance Guide](./flexitime_balance_guide.md) - Balance calculation details
- [Entity Documentation](./entities/) - DocType and module descriptions

For questions or issues, check the Error Log or contact the development team.
