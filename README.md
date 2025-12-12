### Flexitime

Swiss-compliant time tracking with flexitime balance management

Flexitime is a comprehensive time tracking application built on the Frappe Framework, designed specifically for Swiss labor law compliance. It provides organizations with a complete solution for tracking employee presence, managing flexitime balances, and ensuring accurate time accounting.

#### Key Features

**Daily Time Tracking**
- **Roll Call System**: Interactive grid-based interface for daily presence tracking
- **Presence Types**: Flexible categorization (Working, Scheduled, Leave) with customizable icons and colors
- **AM/PM Split Entries**: Support for half-day presence tracking
- **Mobile-Friendly**: Progressive Web App (PWA) for mobile time tracking

**Weekly Time Management**
- **Weekly Entries**: Submit and review weekly time summaries
- **Expected vs Actual Hours**: Automatic calculation based on employee work patterns
- **Timesheet Integration**: Sync with ERPNext Timesheets for accurate hour tracking
- **Auto-Locking**: Automatic locking of past entries after configurable periods

**Flexitime Balance Management**
- **Running Balance**: Automatic calculation of flexitime balance (previous balance + weekly delta)
- **Balance Limits**: Configurable limits based on FTE percentage (default: 20 hours × FTE%)
- **Balance Alerts**: Automated warnings when balances approach or exceed limits
- **Flex Off Support**: Deduct flexitime balance for approved flex days off

**Employee Work Patterns**
- **Flexible Schedules**: Define weekly work patterns per employee
- **FTE Support**: Full-time equivalent percentage tracking
- **Validity Periods**: Time-bound work patterns for schedule changes
- **Holiday Recognition**: Automatic handling of holidays and weekends

**Leave Integration**
- **ERPNext Integration**: Seamless integration with ERPNext Leave Applications
- **Automatic Updates**: Leave applications automatically update roll call entries
- **Calendar Sync**: Optional Google Calendar integration for absences
- **Leave Types**: Support for various leave types (vacation, sick, flex off, etc.)

**Automation & Workflows**
- **Scheduled Tasks**: Automated weekly entry creation, balance calculations, and locking
- **Email Reminders**: Configurable reminders for submission deadlines and missing entries
- **Balance Monitoring**: Weekly balance limit checks with HR alerts
- **Missing Entry Alerts**: Notifications for incomplete roll call or timesheet entries

**HR Dashboard**
- **Overview Dashboard**: Centralized view of employee balances and alerts
- **Balance Monitoring**: Track employees approaching or exceeding balance limits
- **Submission Tracking**: Monitor weekly entry submission status
- **Reporting**: Export and analyze time tracking data

**Swiss Compliance**
- **Labor Law Alignment**: Designed to meet Swiss time tracking requirements
- **Audit Trail**: Complete change tracking and history
- **Data Integrity**: Locked entries prevent unauthorized modifications
- **Comprehensive Reporting**: Export capabilities for compliance documentation

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch main
bench install-app flexitime
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/flexitime
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
