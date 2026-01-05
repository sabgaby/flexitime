# Flexitime Testing Guide

## Development Server

Your development server is running at:
- **URL**: http://localhost:8000 or http://site1.local:8000
- **Admin credentials**: Check your bench configuration

## How to Access the App

### Option 1: Desk App (Full ERPNext Interface)

1. **Login to ERPNext**:
   - Go to: http://localhost:8000
   - Login with your ERPNext credentials

2. **Access Flexitime pages**:
   - **Roll Call**: Click on "Flexitime" app or go to `/app/roll-call`
   - **Dashboard**: Flexitime > Dashboard
   - **Weekly Entry**: Flexitime > Weekly Entry
   - **Employee Work Pattern**: Flexitime > Employee Work Pattern
   - **Presence Type**: Setup > Presence Type
   - **Flexitime Settings**: Flexitime > Flexitime Settings

### Option 2: Portal Access (Website)

1. **Portal Roll Call**:
   - Go to: http://localhost:8000/roll-call
   - Requires login (redirects to login page if not logged in)
   - Only shows employee's own entries (with view of all employees)
   - Simpler interface for employees without desk access

## Prerequisites for Testing

Before you can fully test the app, you need:

### 1. Create an Employee Record

1. Go to **HR > Employee > New**
2. Fill in employee details
3. **Important**: Link the employee to a user account (set the `User ID` field)
4. Assign a **Holiday List** to the employee

### 2. Create an Employee Work Pattern

1. Go to **Flexitime > Employee Work Pattern > New**
2. Select the employee
3. Set **Valid From** date (start date of the pattern)
4. Enter daily expected hours (e.g., Monday: 8.4, Tuesday: 8.4, etc.)
5. Set **FTE Percentage** (e.g., 100 for full-time)
6. Set **Flexitime Limit Hours** (e.g., 20 hours)
7. Save and Submit

### 3. Create Presence Types (if not already created)

The installation should have created default presence types. Check:
- **Setup > Presence Type**
- You should see: office, home_office, vacation, sick_leave, holiday, day_off, etc.

If missing, run:
```bash
bench --site site1.local execute flexitime.install.after_install
```

### 4. Configure Flexitime Settings (Optional)

1. Go to **Flexitime > Flexitime Settings**
2. Configure settings as needed:
   - Roll Call Start Day
   - Display Name Format
   - Calendar settings (if using Google Calendar)
   - Auto-lock settings
   - Reminder settings

## Testing Checklist

### Basic Functionality

- [ ] **Roll Call Page loads**
  - Visit `/app/roll-call` or `/roll-call`
  - Should see grid with employees and dates

- [ ] **Create Roll Call Entry**
  - Click on a cell in the grid
  - Select a presence type
  - Entry should be saved and appear in grid

- [ ] **Edit Roll Call Entry**
  - Click on an existing entry
  - Change presence type
  - Verify update

- [ ] **Split AM/PM Entry**
  - Click on a cell
  - Use "Split AM/PM" option
  - Set different presence types for AM and PM
  - Verify both appear correctly

### Weekly Entry

- [ ] **Weekly Entry Created**
  - Go to Flexitime > Weekly Entry
  - Should see entries for current/past weeks
  - If missing, check if employee has a work pattern

- [ ] **Submit Weekly Entry**
  - Open a weekly entry
  - Review hours (expected vs actual)
  - Click Submit
  - Verify status changes to "Submitted"

- [ ] **Balance Calculation**
  - Submit multiple weekly entries
  - Verify running balance calculates correctly
  - Check Employee.custom_flexitime_balance field

### Leave Integration

- [ ] **Create Leave Application**
  - Go to HR > Leave Application > New
  - Select employee and leave type
  - Set dates
  - Submit

- [ ] **Verify Roll Call Updated**
  - Check Roll Call for leave dates
  - Should show leave presence type
  - Should be linked to leave application

- [ ] **Verify Weekly Entry Updated**
  - Check Weekly Entry for the week
  - Expected hours should be reduced for leave days
  - Daily entries should show leave type

### Permissions

- [ ] **Employee can edit own entries**
  - Login as employee user
  - Should be able to edit own Roll Call entries
  - Should NOT be able to edit other employees' entries

- [ ] **Employee can view all entries**
  - Should see all employees in Roll Call grid
  - Can only edit own entries

- [ ] **HR Manager full access**
  - Login as HR Manager
  - Should be able to edit all entries
  - Should have access to all features

## Quick Test Script

Run this to verify basic setup:

```bash
# 1. Verify installation
bench --site site1.local execute flexitime.verify_installation.check_installation

# 2. Check if server is running
curl http://localhost:8000

# 3. Run tests (optional)
bench --site site1.local run-tests --app flexitime
```

## Common Issues

### "No active employee record found"
- **Solution**: Create an Employee record and link it to your user account

### "Weekly Entry not created"
- **Solution**: Ensure employee has an active Employee Work Pattern

### "Roll Call grid is empty"
- **Solution**: 
  1. Check Employee Presence Settings - ensure `show_in_roll_call` is enabled
  2. Ensure employees exist and are active
  3. Check browser console for JavaScript errors

### "Presence types missing"
- **Solution**: Run `bench --site site1.local execute flexitime.install.after_install`

## Development Server Commands

```bash
# Start server (if not running)
cd ~/frappe-bench
bench --site site1.local serve

# Start with specific port
bench --site site1.local serve --port 8000

# Start in background
bench --site site1.local serve --port 8000 &

# Stop server
# Press Ctrl+C or kill the process
```

## Next Steps

1. **Start the server** (if not already running)
2. **Create test employee** with work pattern
3. **Test Roll Call** functionality
4. **Test Weekly Entry** creation and submission
5. **Test Leave Integration**
6. **Test Permissions** with different user roles

Happy testing! 🚀


