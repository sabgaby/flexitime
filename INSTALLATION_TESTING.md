# Flexitime Installation Testing Guide

## Current Status

Your flexitime app is already installed on `site1.local`. To test a **fresh installation**, you have two options:

## Option 1: Test on New Site (Recommended)

Create a new test site on the same bench:

```bash
cd ~/frappe-bench

# Create a new test site
bench new-site test-flexitime.local --admin-password admin

# Install flexitime
bench --site test-flexitime.local install-app flexitime

# Run migrations
bench --site test-flexitime.local migrate

# Build assets
bench build --app flexitime

# Verify installation
bench --site test-flexitime.local execute flexitime.verify_installation.check_installation
```

**Pros:**
- Tests the complete installation process from scratch
- Isolated environment - won't affect your main site
- Fast (reuses existing bench and apps)

**Cons:**
- Requires MariaDB permissions to create new site
- If you hit database permission errors, you might need to configure MariaDB user access

## Option 2: Verify Current Installation

If you just want to verify that your current installation is complete:

```bash
cd ~/frappe-bench

# Run verification script
bench --site site1.local execute flexitime.verify_installation.check_installation
```

This checks:
- ✓ Custom Fields (Employee, Leave Application)
- ✓ Client Scripts
- ✓ Leave Types (Flex Off)
- ✓ Presence Types (holiday, day_off)
- ✓ Email Templates (7 templates)
- ✓ Flexitime Settings

## Option 3: Simulate Fresh Install (Advanced)

If you want to test the installer without creating a new site:

1. Temporarily remove flexitime from your site:
   ```bash
   bench --site site1.local uninstall-app flexitime
   ```

2. Reinstall it:
   ```bash
   bench --site site1.local install-app flexitime
   bench --site site1.local migrate
   bench build --app flexitime
   ```

3. Verify:
   ```bash
   bench --site site1.local execute flexitime.verify_installation.check_installation
   ```

**⚠️ Warning:** This will remove flexitime data from your site. Only do this if you have backups or don't mind losing test data.

## What Gets Installed

When you run `bench install-app flexitime`, the `after_install` hook automatically:

1. **Custom Fields**: Adds fields to Employee and Leave Application
2. **Client Scripts**: Adds form customizations
3. **Leave Types**: Creates "Flex Off" leave type
4. **Presence Types**: Creates required types (holiday, day_off) and optional types from fixtures
5. **Email Templates**: Creates 7 templates for reminders and alerts
6. **Settings**: Configures default Flexitime Settings
7. **Palette Groups**: Creates default palette group

## Installation Verification

The verification script (`flexitime.verify_installation.check_installation`) checks all of the above components and reports any missing items.

## Recommendation

**For testing installation readiness:**

1. **First**, run the verification script on your current site to ensure everything is set up correctly
2. **Then**, if you want to test a fresh install, try Option 1 (new site) or Option 3 (simulate) depending on your needs

Based on your current verification results, your installation appears to be **complete and ready**! ✅

