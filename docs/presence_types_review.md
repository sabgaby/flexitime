# Presence Types Review

Edit this file to mark which presence types to keep, remove, or modify.

## Instructions
- Mark with `[x]` to KEEP
- Mark with `[ ]` to REMOVE
- Edit the Label or Icon columns as needed
- Add comments in the Notes column

---

## Working Presence Types (Expect Work Hours)

These types count toward expected hours - the employee is working.

| Keep? | Name | Label | Icon | Available to All? | Notes |
|-------|------|-------|------|-------------------|-------|
| [x] | office | Office | 🏢 | Yes | General office work |
| [ ] | office_dog | Office (with dog) | 🐶 | No | Permission needed |
| [x] | home | Home | 🏠 | No | Remote work |
| [x] | offsite | Offsite | ✈️ | Yes | Travel, external meetings |
| [ ] | customer | Customer site | 🤝 | No | At customer location |
| [ ] | training | Training | 📚 | No | Training courses |
| [ ] | conference | Conference | 🎤 | No | Events, conferences |

---

## Non-Working Presence Types (No Work Hours Expected)

These types don't count toward expected hours.

### System Types (REQUIRED - cannot remove)

| Name | Label | Icon | Notes |
|------|-------|------|-------|
| day_off | Day off | 😶‍🌫️ | Scheduled off days from work pattern |
| holiday | Holiday | 🥳 | Public holidays from Holiday List |

### Leave Types (Require Leave Application)

| Keep? | Name | Label | Icon | Available to All? | Notes |
|-------|------|-------|------|-------------------|-------|
| [x] | vacation | Vacation | 😎 | Yes | Paid annual leave |
| [x] | sick | Sick | 🤒 | Yes | Sick leave |
| [ ] | care | Care | 😷 | No | Caring for sick family |
| [x] | flex_off | Flex Off | 😴 | Yes | Uses flexitime balance |
| [ ] | military | Military | 🫡 | No | Swiss military service |
| [ ] | parental | Parental | 🥰 | No | Parental leave |
| [x] | other_leave | Other | 🫥 | No | Catch-all leave |

---

## Summary of Your Changes

After editing, list your changes here:

### Types to Remove:
- (none yet)

### Labels to Change:
- (none yet)

### Icons to Change:
- (none yet)

### Availability Changes:
- (none yet)

---

## Quick Reference: Available to All vs Permission

- **Available to All = Yes**: Every employee can select this in Roll Call
- **Available to All = No**: Only employees with explicit permission can select this
  - Permissions are set in Employee Presence Settings > Presence Permissions table
