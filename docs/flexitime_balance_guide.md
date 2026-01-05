# Flexitime Balance: How It Works

This guide explains how your flexitime balance is calculated and what to expect in common scenarios.

---

## The Basic Formula

Your flexitime balance tracks the difference between hours worked and hours expected:

```
Balance = Actual Hours Worked − Expected Hours
```

- **Positive balance** (+): You've worked more than expected (overtime)
- **Negative balance** (−): You've worked less than expected (undertime)

Your balance accumulates week by week. Each week builds on the previous week's balance.

---

## Your Work Pattern

Your **Employee Work Pattern** defines your expected schedule. HR creates this when you join, and it determines how many hours you're expected to work each week.

### What's in Your Work Pattern

| Setting | What It Means |
|---------|---------------|
| Daily hours (Mon-Sun) | How many hours you're expected to work each day |
| FTE percentage | Your employment level (e.g., 80% = 32h/week, 100% = 40h/week) |
| Flexitime limit | Maximum balance you can accumulate (default: ±20h at 100% FTE) |
| Valid from / Valid to | When this pattern applies |

### Example Work Patterns

**100% FTE (Full-time):**
- Mon-Fri: 8 hours each
- Weekly expected: 40 hours
- Flexitime limit: ±20 hours

**80% FTE (4 days/week):**
- Mon-Thu: 8 hours each, Fri: 0 (day off)
- Weekly expected: 32 hours
- Flexitime limit: ±16 hours

**80% FTE (5 shorter days):**
- Mon-Fri: 6.4 hours each
- Weekly expected: 32 hours
- Flexitime limit: ±16 hours

### How Work Patterns Are Managed

- **HR creates your pattern** when you start - you don't need to do anything
- **Patterns must be submitted** to take effect (drafts are ignored)
- **Day-off entries are created automatically** when your pattern is submitted
- **You can view** your current pattern but cannot edit it

### When Your Schedule Changes

If your FTE or working days change (e.g., going from 100% to 80%), HR will:

1. End your current pattern by setting an end date
2. Create a new pattern with your new schedule
3. Submit the new pattern

**What this means for you:**
- Your past Weekly Entries stay as they were - they correctly reflect when you worked under the old schedule
- Future Weekly Entries will use your new expected hours
- Your balance carries forward - it doesn't reset when your pattern changes

### Multiple Patterns Over Time

You might have several Work Patterns during your employment:

| Pattern | Valid From | Valid To | FTE |
|---------|------------|----------|-----|
| Pattern 1 | 2024-01-01 | 2024-06-30 | 100% |
| Pattern 2 | 2024-07-01 | 2024-12-31 | 80% |
| Pattern 3 | 2025-01-01 | (current) | 80% |

The system automatically uses the correct pattern for each week based on the dates.

---

## How Different Days Affect Your Balance

### Regular Work Days (Office, Home Office, etc.)

| Expected | Actual | Impact |
|----------|--------|--------|
| 8h | 8h | Neutral (0) |
| 8h | 9h | +1h to balance |
| 8h | 7h | −1h from balance |

### Holidays

Holidays are **neutral** - they don't affect your balance.

- Expected hours: 0
- You don't work, balance unchanged

### Day Off (From Work Pattern)

If your pattern includes a day off (e.g., Friday = 0 hours), that day is **neutral**.

- Expected hours: 0
- You don't work, balance unchanged
- You can swap your day off to another day if needed

### Weekends

Weekend days (Saturday/Sunday) are empty by default.

- If you don't work: No impact (cell stays empty)
- If you do work: Record your hours, they count as overtime (+balance)

---

## Leave Types and Balance Impact

### Vacation, Sick Leave, and Regular Leave

Regular leave is **neutral** - it doesn't affect your balance.

| Scenario | Expected | Actual | Balance Impact |
|----------|----------|--------|----------------|
| Full day vacation | 0h | 0h | Neutral |
| Half-day vacation (morning) | 4h | 4h worked | Neutral |

**Half-day leave:** You're expected to work the other half of the day. Record your worked hours.

### Flex Off (Using Your Balance)

Flex Off **deducts from your balance** - this is how you "spend" accumulated overtime.

| Scenario | Expected | Actual | Balance Impact |
|----------|----------|--------|----------------|
| Full day Flex Off | 8h | 0h | −8h from balance |
| Half-day Flex Off | 4h | 0h | −4h from balance |

**When to use Flex Off:**
- You have positive balance (overtime) you want to use
- You want a day/half-day off without using vacation days

---

## Common Scenarios

### Scenario 1: Normal Week
- Pattern: 40h/week (Mon-Fri, 8h each)
- You work: 42 hours total
- **Result:** +2h added to balance

### Scenario 2: Week with Holiday
- Pattern: 40h/week
- Wednesday is a public holiday
- Expected: 32h (holiday reduces expected hours)
- You work: 32h (Mon, Tue, Thu, Fri)
- **Result:** Neutral (0)

### Scenario 3: Taking Vacation
- Pattern: 40h/week
- You take Monday off (vacation)
- Expected: 32h (vacation reduces expected hours)
- You work: 32h (Tue-Fri)
- **Result:** Neutral (0)

### Scenario 4: Using Flex Off
- Pattern: 40h/week
- Current balance: +10h
- You take Monday as Flex Off
- Expected: 40h (Flex Off does NOT reduce expected)
- You work: 32h (Tue-Fri)
- **Result:** −8h from balance → New balance: +2h

### Scenario 5: Working on Weekend
- Pattern: 40h/week (Mon-Fri)
- You work: 40h (Mon-Fri) + 4h Saturday
- **Result:** +4h added to balance

### Scenario 6: Swapping Your Day Off
- Pattern: 32h/week (Mon-Thu 8h, Fri = day off)
- You need to work Friday for a meeting
- Change Friday from "day_off" to "office" in Roll Call
- Change another day (e.g., Monday) to "day_off"
- **Result:** Still 32h expected, balance unchanged

---

## Half-Day Situations

### Half-Day Vacation
- Take morning off (vacation), work afternoon
- Expected hours: Your normal hours ÷ 2
- Record the hours you actually worked in the afternoon
- If you work your expected half-day: Neutral balance

### Half-Day Flex Off
- Take morning off (Flex Off), work afternoon
- Expected hours: Your normal hours ÷ 2
- This half-day is deducted from your balance
- Example: 8h day → 4h deducted from balance

---

## What You Need to Do

### Weekly Entry
1. Review your daily presence types (synced from Roll Call)
2. Enter your actual hours worked each day
3. Submit your Weekly Entry at the end of the week

### Before Taking Leave
1. Submit your Leave Application
2. Once approved, your Roll Call and Weekly Entry update automatically
3. For vacation/sick: Your expected hours reduce (neutral impact)
4. For Flex Off: Your expected hours stay the same (deducts from balance)

### If You Work on a Holiday or Weekend
1. Record your hours in the Weekly Entry
2. These hours count as overtime (added to balance)

---

## Understanding Your Balance Display

| Balance | Meaning | What to Do |
|---------|---------|------------|
| +15h | You have 15 hours of overtime | Consider using Flex Off |
| 0h | You're exactly on target | Keep it up! |
| −5h | You owe 5 hours | Work extra to catch up |
| Near limit (±20h) | Approaching maximum | HR may contact you |

---

## FAQ

**Q: I worked extra hours but my balance didn't change?**
A: Check that you recorded your actual hours in the Weekly Entry. The balance is calculated from actual − expected.

**Q: My vacation reduced my balance - is that a bug?**
A: If you took "Flex Off" instead of "Vacation", it deducts from balance. Check which leave type you selected.

**Q: Can I go negative on my balance?**
A: Yes, but you should work to bring it back to positive. HR monitors balances that exceed the limit.

**Q: What happens if I exceed the flexitime limit?**
A: HR will receive alerts. You may need to take Flex Off (if positive) or work extra (if negative).

**Q: I'm part-time (80%). How does that affect calculations?**
A: Everything scales proportionally - your expected hours, vacation days, and flexitime limit are all at 80%.

**Q: My schedule is changing next month. What happens to my balance?**
A: Your balance carries forward. HR will end your current Work Pattern and create a new one. Past weeks keep their original expected hours, future weeks use the new pattern. Your accumulated balance continues from where it was.

**Q: I see multiple Work Patterns in my history. Is that normal?**
A: Yes. Each time your schedule changes (FTE, working days, etc.), a new pattern is created. This keeps an accurate history of your expected hours over time.

**Q: I was on vacation and have multiple weeks to submit. Can I skip to the latest week?**
A: No. Weekly Entries must be submitted in order to maintain accurate balance tracking. If you have Week 10, 11, and 12 pending, you must submit Week 10 first, then Week 11, then Week 12. Even vacation weeks need to be submitted (with 0 actual hours on leave days) to keep the balance chain intact.

**Q: Why can't I submit this week's entry?**
A: You likely have an earlier week that hasn't been submitted yet. Check your Weekly Entry list for draft entries from previous weeks and submit them first.

---

## For HR Managers

### Correcting Entries
- You can unlock and amend submitted Weekly Entries
- Changes automatically cascade to recalculate future weeks' balances

### Monitoring Balances
- Alerts are sent when employees approach or exceed their limits
- The system sends summaries of employees with balance issues

### Setting Up New Employees
- Create an Employee Work Pattern before their start date
- Ensure they have the correct FTE percentage
- Day-off entries are auto-created when the pattern is submitted

### Changing Work Patterns

When an employee's FTE or schedule changes:

1. **End the current pattern**: Edit the submitted Work Pattern and set `valid_to` to the last day of the old schedule (this field can be edited after submit)
2. **Create new pattern**: Create a new Employee Work Pattern with the new settings
3. **Set valid_from**: Usually the first Monday of the new schedule
4. **Submit**: Day-off entries for the new pattern are auto-created

**Key points:**
- Past Weekly Entries remain unchanged - they correctly reflect the schedule that was active at that time
- Future Weekly Entries will use the new pattern automatically
- The system finds the correct pattern for each date based on `valid_from` and `valid_to`

---

# Technical Reference: Running Balance Chain

This section explains the internal mechanics for administrators and developers.

## How the Balance Accumulates

```
Week 1: running_balance = 0 + weekly_delta₁
Week 2: running_balance = Week1.running_balance + weekly_delta₂
Week 3: running_balance = Week2.running_balance + weekly_delta₃
...
```

Each Weekly Entry stores:
- `previous_balance`: Copied from previous week's `running_balance`
- `weekly_delta`: This week's actual − expected
- `running_balance`: previous_balance + weekly_delta

## Weekly Entry Lifecycle

### On Validate (every save)
1. Syncs presence types from Roll Call entries
2. Calculates expected hours per day based on presence type
3. Sums total actual and expected hours
4. Computes weekly_delta
5. Looks up previous week's running_balance
6. Calculates this week's running_balance

### On Submit
1. Records submission timestamp
2. Updates `Employee.custom_flexitime_balance` with running_balance

### On Cancel
1. Triggers recalculation of all future weeks' balances
2. Updates employee's current balance from latest submitted entry

### On Update After Submit (HR amendment)
1. Recalculates totals
2. Updates employee balance
3. Cascades recalculation to all future weeks

## Expected Hours Calculation

Expected hours come from two sources:

### Daily Level (for display)
Uses `calculate_expected_hours()`:
- System types (holiday): 0 hours
- Flex Off: pattern hours (to deduct from balance)
- Regular leave: 0 hours (neutral)
- Working days: pattern hours

### Weekly Level (for balance)
Uses `calculate_weekly_expected_hours_with_holidays()`:
```
FTE_weekly_hours = base_hours × (FTE% / 100)
daily_average = FTE_weekly_hours / work_days_per_week
expected = FTE_weekly - (holidays × daily_avg) - (leaves × daily_avg)
```

## Work Pattern Selection

`get_work_pattern(employee, date)` returns the active pattern where:
- `valid_from <= date`
- `valid_to >= date` OR `valid_to` is NULL
- `docstatus = 1` (submitted)

This means:
- Only submitted patterns are used
- Draft patterns have no effect
- Overlapping patterns are prevented by validation

## Balance Recalculation

`recalculate_future_balances(employee, from_week_start)`:
1. Gets all submitted Weekly Entries after the given week
2. For each, re-fetches previous week's balance
3. Recalculates running_balance
4. Updates employee's current balance from latest entry

This is called on:
- Weekly Entry cancel
- Weekly Entry amendment (update after submit)

## Employee Custom Field

`Employee.custom_flexitime_balance`:
- Stores the current running balance
- Updated on Weekly Entry submit
- Updated on balance recalculation
- Used for limit checking and display

## Weekly Scheduled Tasks

| Task | When | Purpose |
|------|------|---------|
| `create_weekly_entries` | Monday 06:00 | Creates Weekly Entry for all employees |
| `calculate_weekly_balances` | Monday 01:00 | Full recalculation for all employees |
| `check_balance_limits` | Monday 08:00 | Alerts for employees near/over limits |

## Edge Cases

### No Previous Week Entry
If `get_previous_weekly_entry()` returns None:
- `previous_balance` = 0
- Balance starts fresh from this week

### Sequential Submission Requirement
Weekly Entries must be submitted in chronological order:
- Cannot submit Week 12 if Week 11 is still draft
- Cannot skip weeks - each week must be submitted before the next
- HR Managers can bypass this validation if needed
- Error message includes a link to the week that needs to be submitted first

This ensures the running balance chain is always accurate.

### Mid-Period Pattern Change
When an employee's schedule changes:
1. HR sets `valid_to` on the current submitted Work Pattern
2. HR creates a new Work Pattern with the new schedule and `valid_from`
3. New pattern is submitted

Effects:
- Past Weekly Entries remain correct (they used the pattern valid at that time)
- Future Weekly Entries use the new pattern
- `get_work_pattern(employee, date)` automatically selects the correct pattern for each date

This is intentional - historical entries should reflect the schedule that was active at that time.

### Half-Day Leave
Half-day leave sets expected hours to `pattern_hours / 2`:
- Employee should work the other half
- Recording `actual_hours = expected_hours` = neutral
- Recording less = negative impact
- Recording more = positive impact
