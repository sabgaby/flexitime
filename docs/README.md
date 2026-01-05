# Flexitime Documentation

Welcome to the Flexitime documentation. This directory contains comprehensive guides and entity documentation for the Flexitime application.

## Documentation Structure

Flexitime documentation is organized in two layers:

1. **Entity-Level Documentation** - Short descriptions for Fibery database entries
2. **Comprehensive Guides** - Full user guides for different roles

---

## Comprehensive Guides

### [Admin Guide](./admin-guide.md)
**For**: HR Managers and administrators

Complete guide for configuring and managing the Flexitime system:
- Initial setup and configuration
- Presence Types management
- Employee Work Patterns
- Weekly Entry management
- Roll Call management
- Leave integration
- Dashboard usage
- Email templates
- Monitoring and alerts
- Troubleshooting

### [Developer Guide](./developer-guide.md)
**For**: Developers extending and troubleshooting

Technical documentation for developers:
- Architecture overview
- Core DocTypes reference
- API reference
- Scheduled tasks
- Permission system
- Balance calculation logic
- Leave integration
- Customization points
- Testing
- Troubleshooting
- Development workflow

### [End-User Guide](./end-user-guide.md)
**For**: Employees using Flexitime

User guide for employees:
- Getting started
- Daily Roll Call
- Presence Types explained
- Weekly Entry
- Flexitime Balance
- Leave Applications
- Work Pattern
- Common tasks
- Troubleshooting
- Tips & best practices

### [Flexitime Balance Guide](./flexitime_balance_guide.md)
**For**: All users (detailed balance mechanics)

In-depth explanation of how flexitime balance works:
- Basic formula
- Work Pattern impact
- How different days affect balance
- Leave types and balance impact
- Common scenarios
- Half-day situations
- Balance display
- FAQ
- Technical reference

---

## Entity Documentation

Entity-level documentation designed to be copied into Fibery database entries. Each file contains structured descriptions following a consistent format.

### [DocTypes](./entities/doctypes.md)
Documentation for all Flexitime DocTypes:
- Roll Call Entry
- Weekly Entry
- Daily Entry (Child Table)
- Employee Work Pattern
- Presence Type
- Flexitime Settings
- Employee Presence Permission
- Employee Presence Settings

### [Modules](./entities/modules.md)
Documentation for all modules/packages:
- flexitime (App Root)
- flexitime.flexitime (Main Module)
- flexitime.api
- flexitime.install

### [Pages](./entities/pages.md)
Documentation for all pages:
- flexitime_dashboard
- roll_call

### [Tasks](./entities/tasks.md)
Documentation for scheduled tasks:
- daily.py
- weekly.py

### [Events](./entities/events.md)
Documentation for event handlers:
- leave_application.py

### [Utilities](./entities/utils.md)
Documentation for utility modules:
- permissions.py
- utils.py

### [API Modules](./entities/api.md)
Documentation for API modules:
- flexitime.flexitime.api
- flexitime.api.roll_call

---

## Quick Links

### For HR Managers
- Start with: [Admin Guide](./admin-guide.md)
- Reference: [Flexitime Balance Guide](./flexitime_balance_guide.md)
- Entity docs: [DocTypes](./entities/doctypes.md), [Pages](./entities/pages.md)

### For Developers
- Start with: [Developer Guide](./developer-guide.md)
- Reference: [API Modules](./entities/api.md), [Tasks](./entities/tasks.md)
- Entity docs: All entity documentation files

### For Employees
- Start with: [End-User Guide](./end-user-guide.md)
- Reference: [Flexitime Balance Guide](./flexitime_balance_guide.md)
- Quick help: [Common Tasks](./end-user-guide.md#common-tasks), [Troubleshooting](./end-user-guide.md#troubleshooting)

---

## Documentation Format

### Entity Documentation Format

Entity descriptions follow this structure:

```
**Purpose:** [One sentence describing what this entity does]

**Key Fields/Components:**
- [Field/Component 1]: [Brief description]
- [Field/Component 2]: [Brief description]

**Relationships:**
- Links to: [Related entities]
- Used by: [Entities that use this]

**Notes:** [Important behaviors, constraints, or usage patterns]
```

These descriptions are designed to be copied directly into Fibery database entry Description fields.

### Guide Format

Comprehensive guides include:
- Table of contents
- Clear section headers
- Step-by-step instructions
- Examples and scenarios
- Troubleshooting sections
- Cross-references to related documentation

---

## Contributing to Documentation

When updating documentation:

1. **Entity Documentation**: Update the relevant entity file in `entities/`
2. **Guides**: Update the relevant guide file
3. **This README**: Update links and structure if needed

### Documentation Standards

- Use clear, concise language
- Include examples where helpful
- Cross-reference related topics
- Keep entity descriptions brief (1-3 paragraphs)
- Keep guides comprehensive but organized

---

## Additional Resources

- **Application README**: See [README.md](../README.md) in the app root
- **Code Documentation**: See inline docstrings in source code
- **Frappe Framework Docs**: [https://frappeframework.com/docs](https://frappeframework.com/docs)
- **ERPNext Docs**: [https://docs.erpnext.com](https://docs.erpnext.com)

---

## Support

For questions or issues:
- **HR/Admin Questions**: See [Admin Guide](./admin-guide.md) Troubleshooting section
- **Technical Questions**: See [Developer Guide](./developer-guide.md) Troubleshooting section
- **User Questions**: See [End-User Guide](./end-user-guide.md) Troubleshooting section
- **Balance Questions**: See [Flexitime Balance Guide](./flexitime_balance_guide.md) FAQ section

---

*Last Updated: 2025-01-15*
