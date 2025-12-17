# Flexitime

Swiss-compliant time tracking with flexitime balance management for ERPNext.

## Overview

Flexitime is a comprehensive time tracking application built on Frappe Framework, designed for Swiss labor law compliance. It provides organizations with a complete solution for tracking employee presence, managing flexitime balances, and ensuring accurate time accounting.

## Features

### Daily Time Tracking
- **Roll Call System**: Interactive grid-based interface for daily presence tracking
- **Presence Types**: Flexible categorization (Working, Scheduled, Leave) with customizable icons and colors
- **AM/PM Split Entries**: Support for half-day presence tracking
- **Team Visibility**: See everyone's presence, edit only your own

### Weekly Time Management
- **Weekly Entries**: Submit and review weekly time summaries
- **Expected vs Actual Hours**: Automatic calculation based on employee work patterns
- **Timesheet Integration**: Sync with ERPNext Timesheets for accurate hour tracking
- **Auto-Locking**: Automatic locking of past entries after configurable periods

### Flexitime Balance Management
- **Running Balance**: Automatic calculation (previous balance + weekly delta)
- **Balance Limits**: Configurable limits based on FTE percentage
- **Balance Alerts**: Automated warnings when balances approach or exceed limits
- **Flex Off Support**: Deduct flexitime balance for approved flex days off

### Leave Integration
- **ERPNext Integration**: Seamless integration with Leave Applications
- **Automatic Updates**: Leave applications automatically update Roll Call entries
- **Google Calendar Sync**: Optional calendar integration for team absences
- **Leave Types**: Support for vacation, sick, flex off, parental, military, etc.

### Portal Access
- **Website Roll Call**: Employees can access Roll Call from the website (no VPN required)
- **Login Required**: Secure access with ERPNext user credentials
- **View All, Edit Own**: See team presence, modify only your entries

## Installation

### Prerequisites
- Frappe Bench
- ERPNext (required)

### Install via Bench

```bash
cd ~/frappe-bench
bench get-app https://github.com/your-org/flexitime --branch main
bench --site your-site install-app flexitime
bench --site your-site migrate
bench build --app flexitime
```

### Post-Installation

The installer automatically creates:
- Required system Presence Types (holiday, weekend, day_off)
- Flex Off leave type
- Email templates for reminders and alerts
- Custom fields on Employee and Leave Application

## Configuration

### 1. Flexitime Settings

Navigate to **Flexitime Settings** to configure:

| Setting | Description |
|---------|-------------|
| Roll Call Start Day | Default view when opening Roll Call (Today or Start of Week) |
| Display Name Format | How to show employee names (Full Name, Nickname, etc.) |
| Calendar Display Name | Name format for calendar events |
| Enable Calendar Sync | Create Google Calendar events for approved leave |
| Calendar Manager | User account with Google Workspace authorization |
| Absences Calendar ID | Target calendar for leave events |
| Enable Auto-Lock | Automatically lock submitted Weekly Entries |
| Auto-Lock After (Days) | Days after submission before locking (default: 14) |
| Enable Submission Reminders | Send email reminders for unsubmitted entries |
| Reminder Day | Day of week to send reminders |

### 2. Presence Types

Navigate to **Setup > Presence Type** to customize:

- **Working**: Office, Home, Offsite, Customer site, Training, Conference
- **Scheduled**: Weekend, Holiday, Day off (system-managed)
- **Leave**: Vacation, Sick, Flex Off, Parental, Military, etc.

Each Presence Type has:
- **Icon**: Emoji displayed in the grid
- **Color**: Background color (blue, green, orange, yellow, red, purple, pink, cyan, gray)
- **Category**: Working, Scheduled, or Leave
- **Settings**: Available to all, requires leave application, etc.

> **Note**: The system types (holiday, weekend, day_off) are required and cannot be deleted.

### 3. Employee Work Patterns

For each employee, create an **Employee Work Pattern**:

1. Go to **Employee Work Pattern > New**
2. Select the employee
3. Set the **Valid From** date
4. Enter daily expected hours (e.g., Monday-Friday: 8.4 hours each)
5. Set **FTE Percentage** (e.g., 100% for full-time, 80% for 4-day week)
6. Set **Flexitime Limit Hours** (maximum allowed balance, e.g., 20 hours)

### 4. Holiday List

Ensure employees have a Holiday List assigned:

1. Go to **Employee > [Employee Name]**
2. Set the **Holiday List** field
3. Or set a default Holiday List on the Company

## Usage Guide

### For Employees

#### Daily Roll Call
1. Navigate to **Flexitime > Roll Call** (or `/roll-call` for portal)
2. Click on a cell to set your presence
3. Select a Presence Type from the dialog
4. For half-days, use the "Split AM/PM" option

#### Weekly Entry
1. Weekly Entries are auto-created each Monday
2. Review your hours at **Flexitime > Weekly Entry**
3. Actual hours come from Timesheets (if used) or manual entry
4. Click **Submit** when complete

#### Checking Balance
- View your current flexitime balance on your Weekly Entry
- Positive balance = overtime hours banked
- Negative balance = hours owed

### For HR Managers

#### Dashboard
Navigate to **Flexitime > Dashboard** to see:
- Today's presence overview
- Employees with balance alerts
- Missing Roll Call entries for next week
- Unsubmitted Weekly Entries

#### Sending Reminders
1. From the Dashboard, view missing entries
2. Click "Send Reminder" for individual employees
3. Or "Send All Reminders" for bulk notifications

#### Managing Patterns
1. Create/edit Employee Work Patterns as schedules change
2. Set appropriate flexitime limits based on company policy
3. Patterns are date-based, so historical data is preserved

## Scheduled Tasks

The app runs these automated tasks:

| Schedule | Task | Description |
|----------|------|-------------|
| Daily 00:05 | Lock Past Roll Call | Locks entries from previous weeks |
| Daily 00:10 | Auto-Create Entries | Creates weekend/holiday/day-off entries |
| Every 2 hours | Sync Timesheet Hours | Updates Weekly Entries with Timesheet data |
| Monday 01:00 | Calculate Balances | Recalculates running balances for all employees |
| Monday 08:00 | Check Balance Limits | Sends alerts for employees over limits |
| Monday 09:00 | Missing Timesheet Alerts | Notifies about unsubmitted entries |
| Friday 09:00 | Roll Call Reminders | Reminds to fill next week's Roll Call |
| Friday 14:00 | Timesheet Reminders | Reminds to submit Weekly Entry |

## Permissions

| Role | Roll Call | Weekly Entry | Work Pattern | Settings |
|------|-----------|--------------|--------------|----------|
| Employee | Read all, Write own | Read/Write own (Draft only) | Read own | - |
| HR Manager | Full access | Full access | Full access | Full access |

## Troubleshooting

### Missing Presence Types Error
If you see "Required Presence Type 'xxx' not found" in Error Log:

```bash
bench --site your-site execute flexitime.install.after_install
```

### Roll Call Not Loading
1. Clear browser cache
2. Run `bench build --app flexitime`
3. Check browser console for JavaScript errors

### Weekly Entry Not Created
1. Verify employee has an active Work Pattern
2. Check if Weekly Entry already exists for that week
3. Run manually: **Flexitime > Weekly Entry > New**

### Balance Calculation Wrong
1. Go to Weekly Entry
2. Click **Actions > Recalculate Balance**
3. Or wait for Monday 01:00 scheduled task

## API Reference

### Roll Call API

```python
# Get Roll Call data for a week
frappe.call({
    method: "flexitime.api.roll_call.get_events",
    args: {
        start_date: "2025-01-13",
        end_date: "2025-01-19"
    }
})

# Save a Roll Call entry
frappe.call({
    method: "flexitime.api.roll_call.save_entry",
    args: {
        employee: "HR-EMP-00001",
        date: "2025-01-15",
        presence_type: "office",
        is_half_day: false
    }
})
```

### Calendar Feed

Employees can subscribe to their absence calendar:

1. Go to **Employee > [Your Profile]**
2. Copy the **Calendar Feed URL**
3. Add to Google Calendar, Outlook, or any iCal-compatible app

## Development

### Pre-commit Setup

```bash
cd apps/flexitime
pre-commit install
```

### Running Tests

```bash
bench --site your-site run-tests --app flexitime
```

### Code Style

This app uses:
- **ruff** for Python linting
- **eslint** and **prettier** for JavaScript
- **pyupgrade** for Python syntax upgrades

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/your-org/flexitime/issues)
- **Documentation**: This README and inline code comments
