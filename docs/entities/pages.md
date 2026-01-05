# Pages Documentation

This document contains structured descriptions for all Flexitime pages. These descriptions are designed to be copied into Fibery database entries.

---

## flexitime_dashboard

**Purpose:** HR dashboard for monitoring and management. Provides overview of today's presence, balance alerts, missing entries, and leave planning.

**Key Features:**
- Today's overview: Count of employees by presence type with chart visualization
- Balance alerts: Employees approaching or exceeding flexitime limits
- Missing Roll Call entries: Employees missing entries for next week
- Missing timesheets: Employees with unsubmitted Weekly Entries
- Leave planning summary: Tentative leaves, pending approvals, conflicts
- Reminder sending: Individual and bulk reminder functionality

**Components:**
- `flexitime_dashboard.js`: JavaScript for dashboard functionality
- `flexitime_dashboard.css`: Styling for dashboard layout
- `flexitime_dashboard.json`: Page metadata

**Relationships:**
- Uses API: flexitime.flexitime.api (get_today_overview, get_balance_alerts, get_missing_roll_call_next_week, get_missing_timesheets, send_reminder)
- Uses API: flexitime.api.roll_call (get_leave_planning_summary)
- Accessible by: HR Manager role only

**Notes:** HR Manager only. Displays real-time data from API endpoints. Refresh button reloads all data. Reminder buttons send emails using configured templates. Leave planning shows tentative entries (leave type without Leave Application) and pending approvals. Conflicts highlight days with 3+ people on leave.

---

## roll_call

**Purpose:** Roll Call grid interface for daily presence tracking. Available in both Desk and Portal versions.

**Key Features:**
- Week view grid: Employees as rows, days as columns
- Presence type selection: Dialog with categorized presence types
- Split AM/PM entries: Separate morning and afternoon presence
- Bulk operations: Select multiple cells and apply presence type
- Team visibility: See all employees' presence (read-only for others)
- Edit own entries: Employees can only edit their own row
- Week navigation: Navigate between weeks
- Filtering: Filter by department, company, branch
- Auto-population: Holidays and day_off entries auto-created

**Components:**
- `roll_call.js`: JavaScript for grid functionality and API calls
- `roll_call.json`: Page metadata
- Portal version: `/roll-call` (website route)

**Relationships:**
- Uses API: flexitime.api.roll_call (get_events, save_entry, save_split_entry, save_bulk_entries)
- Displays: Roll Call Entry data
- References: Presence Type (for selection), Employee (for rows)

**Notes:** Available in Desk (/app/roll-call) and Portal (/roll-call). Portal version allows access without VPN. Same functionality in both versions. Grid shows presence type icons and colors. Click cell to edit. Split day option for AM/PM. Bulk operations for HR efficiency. Auto-creates holiday and day_off entries on load. Changes sync to Weekly Entry.
