# Copyright (c) 2025, Smartest and contributors
# For license information, please see license.txt

"""Leave Allocation event handlers for Flexitime.

This module overrides ERPNext's validation to allow 0-leave allocations
for leave types that have 'Allow Zero Allocation' enabled.

This enables clean tracking for leave types like sick leave and military leave
that don't require pre-allocation but need to appear in the dropdown.

How it works:
    1. A custom field 'allow_zero_allocation' is added to Leave Type
    2. When creating a Leave Allocation with 0 leaves, we check if the
       Leave Type allows zero allocation
    3. If allowed, we bypass ERPNext's validation that requires total > 0

Usage:
    1. Go to Leave Type (e.g., "Sick Leave", "Military Leave")
    2. Check "Allow Zero Allocation"
    3. Create Leave Allocation with new_leaves_allocated = 0
    4. Submit - the balance will go negative when employees apply for leave
"""

import frappe
from frappe import _


def _leave_type_allows_zero_allocation(leave_type: str) -> bool:
    """Check if leave type allows zero allocation.

    Args:
        leave_type: Name of the Leave Type

    Returns:
        bool: True if zero allocation is allowed
    """
    if not leave_type:
        return False

    try:
        return bool(frappe.db.get_value("Leave Type", leave_type, "allow_zero_allocation"))
    except Exception:
        return False


def _patch_leave_allocation():
    """Patch Leave Allocation class to allow zero allocations.

    This monkey-patches the set_total_leaves_allocated method to skip
    ERPNext's validation when zero allocation is allowed.
    """
    try:
        from hrms.hr.doctype.leave_allocation.leave_allocation import LeaveAllocation

        # Store original method
        original_set_total_leaves_allocated = LeaveAllocation.set_total_leaves_allocated

        def patched_set_total_leaves_allocated(self):
            """Patched version that allows 0 leaves when leave type permits."""
            # Check if we should allow zero allocation
            if (hasattr(self, "flags") and
                getattr(self.flags, "allow_zero_allocation", False)):
                # Set totals to 0 and skip original validation
                self.unused_leaves = 0
                self.total_leaves_allocated = 0
                return

            # Check via leave type setting
            if (self.new_leaves_allocated == 0 and
                self.leave_type and
                _leave_type_allows_zero_allocation(self.leave_type)):
                self.unused_leaves = 0
                self.total_leaves_allocated = 0
                return

            # For all other cases, call original method
            return original_set_total_leaves_allocated(self)

        # Apply the patch
        LeaveAllocation.set_total_leaves_allocated = patched_set_total_leaves_allocated

    except ImportError:
        # HRMS module not available
        pass
    except Exception as e:
        frappe.log_error(
            f"Error patching Leave Allocation: {str(e)}",
            "Leave Allocation Patch Error"
        )


# Apply patch on module load
_patch_leave_allocation()


def before_validate(doc, method):
    """Set flags before validation to allow zero allocation.

    This runs before ERPNext's validate() method.

    Args:
        doc: Leave Allocation document
        method: Method name (unused, required by Frappe)
    """
    if doc.new_leaves_allocated != 0:
        return

    if not doc.leave_type:
        return

    if _leave_type_allows_zero_allocation(doc.leave_type):
        # Set flag for the patched method
        doc.flags.allow_zero_allocation = True
        # Pre-set values
        doc.total_leaves_allocated = 0


def validate(doc, method):
    """Additional validation after ERPNext's validate.

    Args:
        doc: Leave Allocation document
        method: Method name (unused, required by Frappe)
    """
    # Ensure total stays 0 if we allowed zero allocation
    if (hasattr(doc, "flags") and
        getattr(doc.flags, "allow_zero_allocation", False) and
        doc.new_leaves_allocated == 0):
        doc.total_leaves_allocated = 0
