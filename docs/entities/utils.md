# Utilities Documentation

This document contains structured descriptions for utility modules in Flexitime. These descriptions are designed to be copied into Fibery database entries.

---

## permissions.py

**Purpose:** Custom permission handlers implementing row-level permissions for Flexitime DocTypes. Ensures employees can only access and modify appropriate data.

**Functions:**
- `get_employee_for_user()`: Get employee ID for a user
- `roll_call_entry_query()`: List filter for Roll Call Entry (all employees see all entries)
- `has_roll_call_permission()`: Document-level check (employees edit own, HR edit all)
- `weekly_entry_query()`: List filter for Weekly Entry (employees see only own)
- `has_weekly_entry_permission()`: Document-level check (employees edit own draft only)
- `employee_work_pattern_query()`: List filter for Work Pattern (employees see only own)
- `has_work_pattern_permission()`: Document-level check (employees read-only own)

**Permission Model:**
- Roll Call Entry: All employees can read all (team visibility), but only edit own (unless HR)
- Weekly Entry: Employees can only see/edit own entries (draft only)
- Employee Work Pattern: Employees can only read own patterns (no edit)

**Relationships:**
- Part of: flexitime.flexitime
- Registered in: hooks.py (permission_query_conditions, has_permission)
- Used by: Frappe Framework for permission checks

**Notes:** Implements row-level permissions. HR Manager role bypasses all restrictions. Employees can see team Roll Call (read-only) but only edit own. Weekly Entry and Work Pattern are private to each employee. Locked entries cannot be edited (except by system for Leave updates). Permission queries use SQL for list filtering. Document-level checks prevent unauthorized access.

---

## utils.py

**Purpose:** Shared utility functions used throughout the Flexitime application for date calculations, employee lookups, email sending, and flexitime balance calculations.

**Functions:**
- `get_monday()`: Get the Monday of a week containing a date
- `is_holiday()`: Check if a date is a holiday (from Holiday List)
- `format_date()`: Format date for display
- `get_active_employees()`: Get list of active employees
- `is_timesheet_user()`: Check if employee uses Timesheets
- `get_users_with_role()`: Get list of user IDs with a specific role
- `send_email_template()`: Send email using a template with context variables
- `get_base_weekly_hours()`: Get base weekly hours from Company settings
- `get_leave_days_in_week()`: Get leave days in a week with properties
- `calculate_weekly_expected_hours_with_holidays()`: Calculate expected hours accounting for FTE, holidays, and leaves

**Relationships:**
- Part of: flexitime.flexitime
- Used by: All modules (tasks, API, DocTypes)
- Reads: Employee, Company, Holiday List, Leave Application

**Notes:** Common helpers used across the app. Date utilities handle week calculations. Employee utilities filter active employees. Email utilities use Frappe's email template system. Balance calculation utilities handle complex FTE, holiday, and leave calculations. All functions handle edge cases and errors gracefully.
