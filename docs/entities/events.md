# Events Documentation

This document contains structured descriptions for all Flexitime event handlers. These descriptions are designed to be copied into Fibery database entries.

---

## leave_application.py

**Purpose:** Leave Application event handlers that integrate Flexitime with ERPNext Leave Applications. Validates leave, creates/updates Roll Call entries, and syncs to Google Calendar.

**Functions:**
- `before_submit()`: Validates that no hours are recorded for leave dates, prevents submission if hours exist
- `on_update()`: Creates or updates Roll Call entries when leave is approved, reverts entries when leave is cancelled

**Event Hooks:**
- `before_submit`: Called before Leave Application is submitted
- `on_update`: Called when Leave Application is updated (including submit, cancel, approval)

**Relationships:**
- Part of: flexitime.flexitime.events
- Handles: ERPNext Leave Application DocType
- Creates/Updates: Roll Call Entry
- Updates: Weekly Entry (via Roll Call sync)
- Syncs: Google Calendar (if enabled in Flexitime Settings)

**Notes:** Validates no hours recorded before allowing leave submission. On approval, creates Roll Call entries with matching Presence Type (based on leave_type → Presence Type mapping). Links Leave Application to Roll Call Entry. On cancel, reverts Roll Call entries. Syncs to Google Calendar if enabled (creates events in employee's calendar or shared calendar). Handles half-day leave correctly. Updates Weekly Entry expected hours automatically.
