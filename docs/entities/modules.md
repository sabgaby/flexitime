# Modules Documentation

This document contains structured descriptions for all Flexitime modules/packages. These descriptions are designed to be copied into Fibery database entries.

---

## flexitime (App Root)

**Purpose:** Main application package. Entry point for Frappe app defining app metadata, dependencies, and fixtures.

**Key Components:**
- `hooks.py`: Application hooks configuration (scheduled tasks, document events, permissions, fixtures)
- `install.py`: Post-installation setup (creates presence types, email templates, custom fields)
- `modules.txt`: Module definition (Flexitime)
- `patches.txt`: Database migration patches
- `patches/`: Patch files for version migrations

**Relationships:**
- Contains: flexitime.flexitime (main module), flexitime.api
- Depends on: ERPNext (required_apps)

**Notes:** Entry point for Frappe app. Defines app metadata (name, title, publisher, license). Configures scheduled tasks, document events (Leave Application hooks), permission queries, and fixtures. After install hook creates default data. Patches handle database migrations between versions.

---

## flexitime.flexitime (Main Module)

**Purpose:** Core business logic module containing all DocTypes, API endpoints, scheduled tasks, event handlers, and pages.

**Key Components:**
- `api.py`: Dashboard and general API endpoints
- `utils.py`: Shared utility functions
- `permissions.py`: Custom permission handlers
- `doctype/`: All DocType definitions (Roll Call Entry, Weekly Entry, Employee Work Pattern, etc.)
- `events/`: Document event handlers (leave_application.py)
- `tasks/`: Scheduled task modules (daily.py, weekly.py)
- `page/`: Page definitions (flexitime_dashboard, roll_call)
- `fixtures/`: Default data fixtures (presence_type.json, email_template.json, client_script.json)

**Relationships:**
- Part of: flexitime (app root)
- Contains: All DocTypes, API endpoints, tasks, events
- Uses: flexitime.api for Roll Call API

**Notes:** Main module containing all business logic. DocTypes define data models. API endpoints provide backend functionality. Tasks handle scheduled automation. Events handle Leave Application integration. Pages provide UI interfaces.

---

## flexitime.api

**Purpose:** API endpoints package for Roll Call functionality. Used by both Desk and Portal Roll Call pages.

**Key Components:**
- `roll_call.py`: Roll Call API endpoints
  - `get_events()`: Fetch roll call data for date range
  - `save_entry()`: Save single full-day entry
  - `save_split_entry()`: Save AM/PM split entry
  - `save_bulk_entries()`: Bulk save multiple entries
  - `save_bulk_split_entries()`: Bulk save split entries
  - `delete_bulk_entries()`: Bulk delete entries
  - `get_leave_planning_summary()`: Aggregated leave planning data
  - Helper functions: permission checks, validation, holiday/day_off auto-creation

**Relationships:**
- Part of: flexitime (app root)
- Used by: Roll Call page (Desk and Portal)
- Uses: flexitime.flexitime.doctype.roll_call_entry, flexitime.flexitime.doctype.weekly_entry

**Notes:** Used by both Desk (/app/roll-call) and Portal (/roll-call) pages. Handles permission checks (employees edit own, HR edit all). Auto-creates holiday and day_off entries. Validates presence types and leave applications. Syncs changes to Weekly Entry.

---

## flexitime.install

**Purpose:** Post-installation setup module. Creates default data and custom fields required for app to function.

**Key Functions:**
- `after_install()`: Main entry point called on app install
- `create_custom_fields()`: Adds custom fields to Employee, Leave Application
- `create_client_scripts()`: Adds form customizations
- `create_leave_types()`: Creates "Flex Off" leave type
- `create_presence_types()`: Creates default presence types (office, home_office, vacation, etc.)
- `create_email_templates()`: Creates reminder and alert email templates

**Relationships:**
- Part of: flexitime (app root)
- Called by: hooks.py (after_install hook)
- Creates: Custom Fields, Client Scripts, Leave Types, Presence Types, Email Templates

**Notes:** Runs automatically on `bench install-app flexitime`. Can be re-run manually: `bench --site <site> execute flexitime.install.after_install`. Creates required system presence types (holiday, day_off). Creates default working and leave presence types. Sets up email templates for reminders and alerts.
