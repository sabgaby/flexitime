# Flexitime End-User Guide

This guide is for employees using Flexitime to track their daily presence and submit weekly time summaries.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Daily Roll Call](#daily-roll-call)
3. [Presence Types Explained](#presence-types-explained)
4. [Weekly Entry](#weekly-entry)
5. [Flexitime Balance](#flexitime-balance)
6. [Leave Applications](#leave-applications)
7. [Work Pattern](#work-pattern)
8. [Common Tasks](#common-tasks)
9. [Troubleshooting](#troubleshooting)
10. [Tips & Best Practices](#tips--best-practices)

---

## Getting Started

### Accessing Roll Call

**Desk Version** (ERPNext Desktop):
1. Log in to ERPNext
2. Navigate to **Flexitime > Roll Call**
3. You'll see a grid with employees as rows and days as columns

**Portal Version** (Website - No VPN Required):
1. Go to your company's website
2. Navigate to `/roll-call` or click the Roll Call link
3. Log in with your ERPNext credentials
4. Same functionality as Desk version

### Understanding the Interface

**Grid Layout**:
- **Rows**: Employees (you'll see your team)
- **Columns**: Days of the week (Monday through Sunday)
- **Your Row**: Highlighted or marked so you can easily find it
- **Cells**: Show presence type icons and colors

**Navigation**:
- Use arrow buttons to navigate between weeks
- Click on a date header to jump to a specific week
- Filter by department if you have access

### Your First Entry

1. Find your row in the grid
2. Click on today's cell (or any day you want to record)
3. A dialog opens showing available presence types
4. Select your presence type (e.g., "Office" or "Home Office")
5. Click **Save**
6. The cell updates with the icon and color for your presence type

---

## Daily Roll Call

### Understanding the Grid View

**What You See**:
- All employees in your team/department
- Their presence for the current week
- Icons and colors representing presence types
- Locked entries (past weeks) are grayed out

**What You Can Do**:
- Edit your own entries (click your row's cells)
- View others' entries (read-only)
- Navigate between weeks
- See team presence at a glance

### Setting Your Presence (Full Day)

1. Click on a cell in your row
2. Select a presence type from the dialog
3. Click **Save**
4. The cell updates immediately

**Available Presence Types**:
- Working types: Office, Home Office, Working Offsite, etc.
- Leave types: Vacation, Sick Leave, Flex Off, etc.
- Scheduled types: Day Off (if in your work pattern)

### Split AM/PM Entries

For days when you work part of the day:

1. Click on a cell
2. Select **Split AM/PM** option
3. Choose morning presence type (e.g., "Office")
4. Choose afternoon presence type (e.g., "Vacation")
5. Click **Save**
6. The cell shows both icons (AM on left, PM on right)

**Common Use Cases**:
- Half-day vacation: Morning = Vacation, Afternoon = Office
- Doctor appointment: Morning = Office, Afternoon = Sick Leave
- Flex Off morning: Morning = Flex Off, Afternoon = Office

### Selecting Presence Types

**Quick Dialog**:
- Most common presence types appear in the main dialog
- Click to select immediately

**Show More**:
- Less common types are under "Show more"
- Click to expand and see all options

**Categories**:
- **Working**: Regular work presence
- **Leave**: Vacation, sick, etc.
- **Scheduled**: Day off, holiday

### Understanding Presence Type Colors and Icons

**Colors**:
- Each presence type has a background color
- Helps you quickly see patterns in the grid
- Colors adapt to light/dark mode

**Icons**:
- Emojis or icons represent each type
- Office: 🏢
- Home Office: 🏠
- Vacation: 🏖️
- Sick Leave: 🤒
- Day Off: 😶‍🌫️

### Viewing Team Presence (Read-Only)

**What You Can See**:
- All employees' presence for the week
- Helps with team planning
- See who's in office, working from home, or on leave

**What You Cannot Do**:
- Edit other employees' entries
- Only HR Managers can edit others' entries

### Editing Your Entries

**When You Can Edit**:
- Your own entries
- Current week and future weeks
- Entries that aren't locked

**When You Cannot Edit**:
- Other employees' entries
- Locked entries (past weeks)
- Entries with approved leave (must cancel leave first)

**To Edit**:
1. Click on your cell
2. Select a different presence type
3. Click **Save**

### Notes Field Usage

Some presence types allow notes:
1. When selecting presence type, a notes field may appear
2. Enter additional information (e.g., "Customer site visit", "Training session")
3. Notes are visible to HR and yourself

---

## Presence Types Explained

### Working Types

**Office** 🏢
- You're working at the office
- Expected hours: Your normal work day hours
- Use when: You're physically at the office

**Home Office** 🏠
- You're working from home
- Expected hours: Your normal work day hours
- Use when: Remote work day

**Working Offsite** 🌍
- You're working at a customer site, conference, training, etc.
- Expected hours: Your normal work day hours
- Use when: Working away from office/home

**Other Working Types**:
- Your company may have additional working types
- Check with HR for specific types available

### Leave Types

**Vacation** 🏖️
- Paid vacation leave
- Expected hours: 0 (reduces expected hours)
- Requires: Leave Application (approved)
- Balance impact: Neutral (doesn't affect balance)

**Sick Leave** 🤒
- Sick leave
- Expected hours: 0 (reduces expected hours)
- Requires: Leave Application (approved)
- Balance impact: Neutral

**Flex Off** 😎
- Using your flexitime balance for a day off
- Expected hours: Your normal hours (NOT reduced)
- Requires: Leave Application (approved)
- Balance impact: Deducts from your balance
- Use when: You have positive balance and want a day off

**Other Leave Types**:
- Parental Leave, Military Leave, etc.
- Check with HR for available leave types

### Scheduled Types

**Holiday** 🥳
- Public holiday
- Auto-created by system
- Expected hours: 0
- Cannot edit (system-managed)

**Day Off** 😶‍🌫️
- Scheduled day off from your work pattern
- Auto-created when pattern has 0 hours for that day
- Expected hours: 0
- Can swap to another day if needed

**Weekend**
- Saturday/Sunday
- Usually empty (no entry)
- Can record work if you work weekends
- Expected hours: 0 (unless you work)

### When to Use Each Type

**Regular Work Day**: Office, Home Office, or Working Offsite

**Taking Leave**: 
1. Submit Leave Application first
2. Once approved, Roll Call updates automatically
3. Or manually select leave presence type (if Leave Application exists)

**Using Flex Off**:
1. Check your balance is positive
2. Submit Leave Application with "Flex Off" leave type
3. Once approved, Roll Call updates automatically
4. Balance deducts accordingly

**Swapping Day Off**:
1. Change your scheduled day off to a working day
2. Change another day to "Day Off"
3. Expected hours stay the same

---

## Weekly Entry

### Understanding Weekly Entry

**What It Is**:
- Weekly summary of your time
- Shows actual vs expected hours
- Calculates your flexitime balance
- Must be submitted each week

**When It's Created**:
- Automatically created every Monday morning
- Or manually by HR if needed

**What It Contains**:
- Daily entries (one row per day)
- Presence types (synced from Roll Call)
- Actual hours worked
- Expected hours (from Work Pattern)
- Weekly delta (difference)
- Running balance

### Reviewing Your Week

1. Navigate to **Flexitime > Weekly Entry**
2. Find your entry for the current week
3. Review daily entries:
   - **Date**: The day
   - **Presence Type**: What you selected in Roll Call
   - **Expected Hours**: From your Work Pattern
   - **Actual Hours**: Hours you worked (to enter)

### Entering Actual Hours

**For Each Day**:
1. Find the day in the Daily Entries table
2. Enter **Actual Hours** in the field
3. Hours can come from:
   - Your timesheet (if using ERPNext Timesheets)
   - Manual entry
   - Auto-synced from Timesheets (every 2 hours)

**Timesheet Integration**:
- If your company uses ERPNext Timesheets
- Hours auto-sync every 2 hours
- You can still manually adjust if needed

**Half-Day Leave**:
- If you took half-day leave
- Enter hours for the half you worked
- Expected hours already adjusted for half-day

### Expected vs Actual Hours

**Expected Hours**:
- Calculated from your Work Pattern
- Adjusted for holidays and regular leaves
- NOT adjusted for Flex Off (stays at pattern value)

**Actual Hours**:
- Hours you actually worked
- Enter manually or from Timesheets

**Weekly Delta**:
- Actual - Expected
- Positive: Overtime (added to balance)
- Negative: Undertime (deducted from balance)

### Weekly Delta Explanation

**Example**:
- Expected: 40 hours
- Actual: 42 hours
- Delta: +2 hours (added to balance)

**Another Example**:
- Expected: 40 hours
- Actual: 38 hours
- Delta: -2 hours (deducted from balance)

**With Flex Off**:
- Expected: 40 hours (NOT reduced)
- Actual: 32 hours (didn't work Flex Off day)
- Delta: -8 hours (deducts 8 hours from balance)

### Submitting Your Entry

**When to Submit**:
- At the end of the week (Friday or Monday)
- After entering all actual hours
- Before the deadline (check with HR)

**How to Submit**:
1. Review all daily entries
2. Verify actual hours are correct
3. Check totals look right
4. Click **Submit** button
5. Confirm submission

**After Submission**:
- Entry status changes to "Submitted"
- Balance updates automatically
- Entry becomes read-only (can be unlocked by HR if needed)

### Why Sequential Submission is Required

**The Rule**:
- You must submit weeks in order
- Cannot submit Week 12 if Week 11 is still draft
- Ensures balance calculations are accurate

**Why**:
- Balance builds week by week
- Each week's balance depends on the previous week
- Skipping weeks would break the balance chain

**If You Have Multiple Weeks Pending**:
1. Submit the earliest week first
2. Then submit the next week
3. Continue in order
4. Even vacation weeks need to be submitted (with 0 actual hours)

**Exception**:
- HR Managers can bypass this validation
- Contact HR if you need help

---

## Flexitime Balance

### Understanding Your Balance

**What It Is**:
- Running total of overtime/undertime
- Accumulates week by week
- Shown on your Weekly Entry

**Positive Balance (+)**:
- You've worked more than expected
- Overtime hours banked
- Can use for Flex Off

**Negative Balance (-)**:
- You've worked less than expected
- Undertime hours owed
- Should work extra to bring back to positive

**Zero Balance (0)**:
- You're exactly on target
- Perfect balance!

### How Balance is Calculated

**Formula**:
```
Balance = Actual Hours - Expected Hours
```

**Weekly**:
- Each week: Weekly Delta = Actual - Expected
- Running Balance = Previous Balance + Weekly Delta

**Example**:
- Week 1: Worked 42h, Expected 40h → Delta +2h → Balance +2h
- Week 2: Worked 38h, Expected 40h → Delta -2h → Balance 0h
- Week 3: Worked 40h, Expected 40h → Delta 0h → Balance 0h

### Positive vs Negative Balance

**Positive Balance**:
- Good! You have overtime banked
- Can use for Flex Off days
- Try to keep within limit

**Negative Balance**:
- You owe hours
- Work extra to catch up
- Try to bring back to positive

**Near Zero**:
- Ideal! You're on target
- Keep it up!

### Balance Limits

**Your Limit**:
- Set in your Work Pattern
- Typically: 20 hours × FTE%
- Example: 100% FTE = ±20 hours limit

**What Happens at Limit**:
- System sends alerts when approaching limit (80%)
- System sends alerts when over limit
- HR may contact you

**Staying Within Limit**:
- Use Flex Off if balance is high
- Work extra if balance is low
- Monitor regularly

### Using Flex Off

**When to Use**:
- You have positive balance
- You want a day off without using vacation
- You want to reduce your balance

**How to Use**:
1. Check your balance is positive
2. Submit Leave Application with "Flex Off" leave type
3. Once approved, Roll Call updates automatically
4. Balance deducts by your daily hours (e.g., 8 hours)

**Example**:
- Current balance: +15 hours
- Take Flex Off (8 hours)
- New balance: +7 hours

**Important**:
- Flex Off deducts from balance
- Vacation does NOT affect balance
- Choose the right leave type!

### Balance Alerts

**Warning Alert** (80% of limit):
- Email sent when balance approaches limit
- Example: Limit is 20h, warning at 16h
- Time to plan Flex Off or extra work

**Over Limit Alert**:
- Email sent when balance exceeds limit
- HR also receives summary
- May need to take action

**What to Do**:
- Review your balance history
- Plan Flex Off if positive
- Plan extra work if negative
- Contact HR if needed

---

## Leave Applications

### Creating Leave Applications

**Standard Process**:
1. Navigate to **HR > Leave Application**
2. Click **New**
3. Select **Leave Type** (Vacation, Sick, Flex Off, etc.)
4. Enter **From Date** and **To Date**
5. Select **Half Day** if applicable
6. Add **Reason** (optional)
7. Click **Submit**

**After Submission**:
- Goes to your manager for approval
- Shows as "Open" status
- Appears in Roll Call as tentative (striped pattern)

### How Leave Syncs to Roll Call

**When Approved**:
1. System automatically creates Roll Call entries
2. Links Leave Application to entries
3. Updates Weekly Entry expected hours
4. Syncs to Google Calendar (if enabled)

**What You See**:
- Roll Call entries show leave presence type
- Linked to your Leave Application
- Expected hours adjusted automatically

**You Don't Need To**:
- Manually create Roll Call entries for approved leave
- System does it automatically!

### Approved vs Draft Leave

**Draft Leave** (Not Submitted):
- Not visible in Roll Call
- Submit Leave Application first

**Open Leave** (Pending Approval):
- Shows in Roll Call as tentative (striped pattern)
- You and your manager can see draft status
- Others see as tentative

**Approved Leave**:
- Shows in Roll Call normally (solid pattern)
- Roll Call entries created automatically
- Cannot modify Roll Call entries directly
- Must cancel Leave Application to change

### Half-Day Leave

**How It Works**:
1. Submit Leave Application with "Half Day" checked
2. Select which half (AM or PM)
3. Once approved:
   - AM leave: Morning = Leave, Afternoon = Work
   - PM leave: Morning = Work, Afternoon = Leave
4. Expected hours adjusted to half day
5. Enter actual hours for the half you worked

**Example**:
- Full day expected: 8 hours
- Half-day leave: Expected 4 hours
- Work 4 hours: Balance neutral
- Work 3 hours: Balance -1 hour

### Flex Off vs Vacation

**Vacation**:
- Paid vacation leave
- Expected hours: 0 (reduces expected)
- Balance impact: Neutral
- Uses vacation days

**Flex Off**:
- Unpaid day off using balance
- Expected hours: Your normal hours (NOT reduced)
- Balance impact: Deducts from balance
- Uses flexitime balance instead of vacation

**When to Use Each**:
- **Vacation**: Regular vacation, want to use vacation days
- **Flex Off**: Have overtime balance, want day off without using vacation

---

## Work Pattern

### Viewing Your Work Pattern

1. Navigate to **Flexitime > Employee Work Pattern**
2. Find your current pattern (valid_to is empty or future date)
3. View your schedule:
   - Daily hours (Mon-Sun)
   - FTE percentage
   - Flexitime limit
   - Weekly expected hours

**Note**: You can view but not edit your work pattern. Contact HR for changes.

### Understanding FTE Percentage

**FTE = Full-Time Equivalent**

**100% FTE**:
- Full-time employee
- Typically 40 hours/week
- Flexitime limit: ±20 hours

**80% FTE**:
- Part-time (4 days/week or shorter days)
- Typically 32 hours/week
- Flexitime limit: ±16 hours

**60% FTE**:
- Part-time
- Typically 24 hours/week
- Flexitime limit: ±12 hours

**What It Affects**:
- Expected weekly hours
- Flexitime limit
- Everything scales proportionally

### Understanding Expected Hours

**How It's Calculated**:
- Base hours × FTE% = Your expected hours
- Example: 40h × 100% = 40h/week
- Example: 40h × 80% = 32h/week

**Per Day**:
- Set in your Work Pattern
- Monday: 8 hours
- Tuesday: 8 hours
- Wednesday: 8 hours
- etc.

**Adjusted For**:
- Holidays: Expected hours reduced
- Regular leave: Expected hours reduced
- Flex Off: Expected hours NOT reduced (to deduct from balance)

### Day-Off Days

**In Your Pattern**:
- Days with 0 hours = Day Off
- Example: Friday = 0 hours (4-day work week)
- System auto-creates "Day Off" Roll Call entries

**You Can**:
- Swap your day off to another day
- Change Friday from "Day Off" to "Office"
- Change another day to "Day Off"
- Expected hours stay the same

**You Cannot**:
- Edit your Work Pattern (HR only)
- Change your FTE percentage (HR only)

---

## Common Tasks

### Recording a Normal Work Day

1. Open Roll Call
2. Click on today's cell (your row)
3. Select "Office" or "Home Office"
4. Click Save
5. Done!

**Later**:
- Open Weekly Entry
- Enter actual hours worked (e.g., 8.0)
- Submit at end of week

### Recording a Half-Day

**Option 1: Split AM/PM**
1. Click on the cell
2. Select "Split AM/PM"
3. Choose morning type (e.g., "Office")
4. Choose afternoon type (e.g., "Vacation")
5. Click Save

**Option 2: Half-Day Leave**
1. Submit Leave Application with "Half Day" checked
2. Once approved, Roll Call updates automatically
3. Enter actual hours for the half you worked

### Taking Vacation

1. **Submit Leave Application**:
   - Leave Type: Vacation
   - Dates: Your vacation dates
   - Submit for approval

2. **Once Approved**:
   - Roll Call updates automatically
   - Weekly Entry expected hours adjusted
   - No need to manually update Roll Call

3. **In Weekly Entry**:
   - Actual hours: 0 (you're on vacation)
   - Expected hours: Already reduced
   - Balance: Neutral (doesn't affect balance)

### Using Flex Off

1. **Check Your Balance**:
   - Open Weekly Entry
   - Check running balance
   - Ensure it's positive

2. **Submit Leave Application**:
   - Leave Type: Flex Off
   - Dates: Day(s) you want off
   - Submit for approval

3. **Once Approved**:
   - Roll Call updates automatically
   - Weekly Entry expected hours NOT reduced
   - Balance deducts by your daily hours

4. **In Weekly Entry**:
   - Actual hours: 0 (you're on Flex Off)
   - Expected hours: Your normal hours (NOT reduced)
   - Balance: Deducts from balance

### Working on Weekends/Holidays

**If You Work**:
1. Click on weekend/holiday cell
2. Select working presence type (e.g., "Office")
3. Click Save
4. In Weekly Entry, enter actual hours worked
5. These hours count as overtime (added to balance)

**If You Don't Work**:
- Leave cell empty (for weekends)
- Or cell shows "Holiday" (auto-created, cannot edit)

**Balance Impact**:
- Weekend/holiday work = Overtime
- Added to your balance
- Example: Work 4h Saturday → +4h to balance

### Swapping Your Day Off

**Example**: Your pattern has Friday as day off, but you need to work Friday

1. **Change Friday**:
   - Click Friday cell
   - Change from "Day Off" to "Office"
   - Click Save

2. **Change Another Day**:
   - Click another day (e.g., Monday)
   - Change from "Office" to "Day Off"
   - Click Save

**Result**:
- Expected hours stay the same (still your weekly total)
- Balance unchanged
- You've swapped your day off

---

## Troubleshooting

### Can't Edit an Entry (Locked)

**Problem**: Cell is grayed out or shows "Locked"

**Cause**: Entry is from a past week (auto-locked)

**Solution**: 
- Past entries cannot be edited
- Contact HR if correction needed
- HR can unlock and amend

### Can't Submit Weekly Entry (Previous Week Not Submitted)

**Problem**: Error message says "Previous week must be submitted first"

**Cause**: Sequential submission requirement

**Solution**:
1. Find your previous week's Weekly Entry
2. Enter actual hours if needed
3. Submit previous week first
4. Then submit current week

**If Multiple Weeks Pending**:
- Submit earliest week first
- Then next week
- Continue in order

**Need Help?**: Contact HR - they can assist or bypass validation if needed

### Balance Seems Wrong

**Check**:
1. Verify actual hours are entered correctly
2. Check expected hours match your Work Pattern
3. Review previous week's balance
4. Check for amendments that might have affected balance

**Fix**:
- Contact HR to review
- HR can recalculate balance if needed
- Or wait for Monday 01:00 automatic recalculation

### Leave Not Showing in Roll Call

**Check**:
1. Is Leave Application submitted?
2. Is Leave Application approved?
3. Is Presence Type linked to Leave Type?
4. Are dates correct?

**Fix**:
1. Submit Leave Application if draft
2. Wait for approval
3. Roll Call should update automatically
4. If not, contact HR

### Missing Presence Type

**Problem**: Presence type you need is not available

**Cause**: 
- Not available to all employees
- Requires pattern match (day off)
- System type (not selectable)

**Solution**:
- Contact HR to add presence type
- Or request permission for specific type
- Check if it's under "Show more"

### Weekly Entry Not Created

**Problem**: Can't find Weekly Entry for this week

**Cause**:
- Not created yet (created Monday mornings)
- Employee status inactive
- Missing Work Pattern

**Solution**:
- Wait for Monday 06:00 creation
- Or contact HR to create manually
- Verify you have active Work Pattern

### Timesheet Hours Not Syncing

**Problem**: Actual hours not updating from Timesheets

**Check**:
1. Are you using ERPNext Timesheets?
2. Are Timesheets submitted?
3. Wait 2 hours (sync runs every 2 hours)

**Fix**:
- Enter hours manually if needed
- Or wait for next sync cycle
- Contact IT if sync not working

---

## Tips & Best Practices

### Fill Roll Call Daily

**Why**:
- Easier to remember what you did
- Avoids backlog at end of week
- Helps with team planning

**When**:
- End of each work day
- Or start of next day
- Takes 30 seconds

### Submit Weekly Entry on Time

**Why**:
- Required for compliance
- Keeps balance accurate
- Avoids reminders

**When**:
- End of week (Friday)
- Or start of next week (Monday)
- Before deadline (check with HR)

### Check Balance Regularly

**Why**:
- Know where you stand
- Plan Flex Off if balance is high
- Plan extra work if balance is low
- Avoid exceeding limits

**When**:
- After submitting Weekly Entry
- Before planning leave
- Monthly review

### Plan Leave in Advance

**Why**:
- Better approval chances
- Helps team planning
- Avoids conflicts

**How**:
1. Submit Leave Application early
2. Once approved, Roll Call updates automatically
3. No need to manually update Roll Call

### Use Flex Off Wisely

**When to Use**:
- Balance is positive
- Want day off without using vacation
- Want to reduce balance

**When Not to Use**:
- Balance is negative (would make it worse)
- Want to save vacation days
- Prefer to keep overtime balance

### Keep Actual Hours Accurate

**Why**:
- Balance depends on accurate hours
- Compliance requirement
- Helps with planning

**How**:
- Enter hours daily or weekly
- Use Timesheets if available
- Double-check before submitting

### Understand Your Work Pattern

**Know**:
- Your expected hours per day
- Your weekly expected hours
- Your flexitime limit
- Your day-off days

**Why**:
- Helps understand expected hours
- Knows when you can swap days
- Understands balance calculations

---

## Additional Resources

- [Admin Guide](./admin-guide.md) - HR documentation (if you have HR access)
- [Flexitime Balance Guide](./flexitime_balance_guide.md) - Detailed balance explanation
- [Developer Guide](./developer-guide.md) - Technical documentation (for reference)

For questions or issues, contact your HR Manager or system administrator.
