# Copyright (c) 2025, Gaby and contributors
# For license information, please see license.txt

"""Roll Call API endpoints for Flexitime.

This module provides the main API endpoints for the Roll Call functionality,
used by both the Desk page (/app/roll-call) and the Portal page (/roll-call).
All endpoints require authentication.

API Endpoints (whitelisted):
    get_current_user_info: Get current user info for the SPA
    get_default_company: Get user's default company
    get_events: Get Roll Call entries for a date range (main data endpoint)
    save_entry: Save/update a single Roll Call entry (full day)
    save_split_entry: Save/update a split AM/PM Roll Call entry
    save_bulk_entries: Save multiple entries in bulk
    save_bulk_split_entries: Save multiple split entries in bulk
    delete_bulk_entries: Delete multiple entries in bulk
    get_leave_planning_summary: Get aggregated leave planning data
    get_pending_review_count: Get count of leave applications awaiting approval

Permission Model:
    - All endpoints require login (not allow_guest)
    - Employees can only edit their own entries (enforced by can_edit_employee_entry)
    - HR Managers can edit anyone's entries
    - Entries are synced to Weekly Entry on save

Helper Functions:
    get_current_employee: Get employee ID for current user
    can_edit_employee_entry: Check if user can edit an employee's entry
    is_hr_department_member: Check if user has HR Manager role
    get_managed_employees_batch: Get employees managed by a manager
    can_view_draft_status_batch: Check if user can see draft leave status
    validate_presence_type_for_roll_call: Validate presence type before save
    sync_roll_call_to_weekly_entry: Sync changes to Weekly Entry

Dependencies:
    - frappe
    - flexitime.flexitime.doctype.weekly_entry.weekly_entry
    - flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern
"""

import frappe
from frappe import _
from frappe.utils import getdate, add_days


def get_current_employee():
	"""Get the Employee record for the current user."""
	user = frappe.session.user
	if user == "Guest":
		return None
	return frappe.db.get_value("Employee", {"user_id": user}, "name")


def can_edit_employee_entry(target_employee: str) -> bool:
	"""Check if current user can edit entries for the target employee.

	Permission rules:
	- HR Manager and HR User can edit anyone's entries
	- Leave Approver (line manager) can edit their direct reports' entries
	- Employees can only edit their own entries

	Args:
		target_employee: The employee whose entry is being edited

	Returns:
		bool: True if user has permission to edit
	"""
	if not target_employee:
		return False

	# HR Managers and HR Users can edit anyone
	if is_hr_department_member():
		return True

	current_emp = get_current_employee()
	if not current_emp:
		return False

	# Own entries - always allowed
	if current_emp == target_employee:
		return True

	# Line manager (Leave Approver) can edit direct reports
	if is_leave_approver():
		if is_line_manager_of(target_employee):
			return True

	return False


def is_leave_approver():
	"""Check if current user has Leave Approver role."""
	return "Leave Approver" in frappe.get_roles()


def is_hr_department_member():
	"""Check if current user has HR Manager or HR User role."""
	roles = frappe.get_roles()
	return "HR Manager" in roles or "HR User" in roles


def is_line_manager_of(employee: str) -> bool:
	"""Check if current user is the line manager (reports_to) of an employee."""
	current_emp = get_current_employee()
	if not current_emp:
		return False
	reports_to = frappe.db.get_value("Employee", employee, "reports_to")
	return reports_to == current_emp


def get_managed_employees_batch(manager_employee: str | None, employee_list: list) -> set:
	"""Get set of employee IDs that report to the given manager.

	This is the optimized batch version that queries once for all employees
	instead of per-employee checks.

	Args:
		manager_employee: The manager's employee ID
		employee_list: List of employee IDs to check

	Returns:
		set: Employee IDs that report to the manager
	"""
	if not manager_employee or not employee_list:
		return set()

	managed = frappe.db.sql("""
		SELECT name FROM `tabEmployee`
		WHERE name IN %(employees)s AND reports_to = %(manager)s
	""", {
		'employees': employee_list,
		'manager': manager_employee
	}, as_dict=True)

	return {e.name for e in managed}


def can_view_draft_status(viewer_employee: str | None, entry_employee: str) -> bool:
	"""Determine if viewer can see draft leave application status for an entry.

	Draft status is visible to:
	- The employee themselves
	- Their line manager (reports_to)
	- HR department members

	Everyone else sees draft as tentative (no stripes distinction).

	NOTE: For batch operations, use can_view_draft_status_batch() instead.
	"""
	# HR can see everything
	if is_hr_department_member():
		return True

	# Own entries
	if viewer_employee and viewer_employee == entry_employee:
		return True

	# Line manager
	if viewer_employee and is_line_manager_of(entry_employee):
		return True

	return False


def can_view_draft_status_batch(
	viewer_employee: str | None,
	entry_employee: str,
	is_hr: bool,
	managed_employees: set
) -> bool:
	"""Batch-optimized version of can_view_draft_status.

	Uses pre-computed values instead of database queries.

	Args:
		viewer_employee: The viewer's employee ID
		entry_employee: The entry owner's employee ID
		is_hr: Pre-computed HR status
		managed_employees: Pre-computed set of employees managed by viewer

	Returns:
		bool: True if viewer can see draft status
	"""
	# HR can see everything
	if is_hr:
		return True

	# Own entries
	if viewer_employee and viewer_employee == entry_employee:
		return True

	# Line manager (O(1) lookup instead of query)
	if entry_employee in managed_employees:
		return True

	return False


@frappe.whitelist()
def get_current_user_info():
	"""Get current user info for the Roll Call SPA."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please login to access Roll Call"), frappe.AuthenticationError)

	user_doc = frappe.get_doc("User", user)
	roles = [r.role for r in user_doc.roles]

	return {
		"name": user,
		"first_name": user_doc.first_name or "",
		"full_name": user_doc.full_name or "",
		"user_image": user_doc.user_image or "",
		"roles": roles,
	}


@frappe.whitelist()
def get_editable_employees():
	"""Get list of employee IDs that the current user can edit.

	Returns:
		dict: {
			can_edit_all: bool - True if user can edit anyone (HR)
			editable_employees: list - Employee IDs user can edit (if not can_edit_all)
		}
	"""
	# HR Manager and HR User can edit anyone
	if is_hr_department_member():
		return {"can_edit_all": True, "editable_employees": []}

	current_emp = get_current_employee()
	if not current_emp:
		return {"can_edit_all": False, "editable_employees": []}

	editable = [current_emp]  # Can always edit own entries

	# Leave Approver can edit direct reports
	if is_leave_approver():
		direct_reports = frappe.db.sql_list("""
			SELECT name FROM `tabEmployee`
			WHERE reports_to = %s AND status = 'Active'
		""", current_emp)
		editable.extend(direct_reports)

	return {"can_edit_all": False, "editable_employees": editable}


@frappe.whitelist()
def get_default_company():
	"""Get user's default company."""
	return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)


def check_missing_work_patterns(employee_names: list, reference_date: str) -> list:
	"""Check which employees are missing work patterns for a given date.

	Uses batch SQL query instead of N individual lookups.

	Args:
		employee_names: List of employee IDs to check
		reference_date: Date to check patterns for (YYYY-MM-DD)

	Returns:
		list: List of dicts with employee info for those missing patterns
	"""
	if not employee_names:
		return []

	reference_date = getdate(reference_date)

	# Get all employees who HAVE valid work patterns for this date (1 query)
	employees_with_patterns = frappe.db.sql("""
		SELECT DISTINCT employee
		FROM `tabEmployee Work Pattern`
		WHERE employee IN %(employees)s
		AND valid_from <= %(ref_date)s
		AND (valid_to >= %(ref_date)s OR valid_to IS NULL)
		AND docstatus = 1
	""", {
		'employees': employee_names,
		'ref_date': str(reference_date)
	}, as_list=True)

	employees_with_patterns_set = {e[0] for e in employees_with_patterns}

	# Find employees WITHOUT patterns
	missing_employees = [e for e in employee_names if e not in employees_with_patterns_set]

	if not missing_employees:
		return []

	# Get employee names for display (1 query for all missing)
	emp_names = frappe.get_all("Employee",
		filters={"name": ["in", missing_employees]},
		fields=["name", "employee_name"]
	)

	return [{"employee": e.name, "employee_name": e.employee_name or e.name} for e in emp_names]


def ensure_holiday_entries_batch(employee_names: list, from_date: str, to_date: str, existing_entries: set = None):
	"""Batch auto-create Roll Call entries for holidays from HRMS Holiday List.

	This is the optimized batch version that creates holiday entries for ALL
	employees in a single operation using efficient SQL joins.

	Args:
		employee_names: List of Employee IDs
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
		existing_entries: Optional set of existing entry keys (employee|date) to avoid duplicate query
	"""
	if not employee_names:
		return

	# Check if holiday presence type exists (1 query)
	holiday_pt = frappe.db.get_value("Presence Type", "holiday", ["icon", "label"], as_dict=True)
	if not holiday_pt:
		return

	# Use provided existing entries or query them
	if existing_entries is None:
		existing = frappe.db.sql("""
			SELECT CONCAT(employee, '|', date) as entry_key
			FROM `tabRoll Call Entry`
			WHERE employee IN %(employees)s
			AND date BETWEEN %(from_date)s AND %(to_date)s
		""", {
			'employees': employee_names,
			'from_date': from_date,
			'to_date': to_date
		}, as_dict=True)
		existing_entries = {e.entry_key for e in existing}

	# Get employees with their holiday lists (1 query)
	# Join with Company to get default holiday list as fallback
	emp_holiday_lists = frappe.db.sql("""
		SELECT e.name as employee,
			   COALESCE(e.holiday_list, c.default_holiday_list) as holiday_list
		FROM `tabEmployee` e
		LEFT JOIN `tabCompany` c ON e.company = c.name
		WHERE e.name IN %(employees)s
	""", {'employees': employee_names}, as_dict=True)

	# Build employee -> holiday_list mapping
	emp_to_holiday_list = {e.employee: e.holiday_list for e in emp_holiday_lists if e.holiday_list}

	if not emp_to_holiday_list:
		return  # No employees have holiday lists configured

	# Get all unique holiday lists
	unique_holiday_lists = list(set(emp_to_holiday_list.values()))

	# Get all holidays for all holiday lists in date range (1 query)
	# This replaces N calls to get_holidays_for_employee
	holidays = frappe.db.sql("""
		SELECT parent as holiday_list, holiday_date, description
		FROM `tabHoliday`
		WHERE parent IN %(holiday_lists)s
		AND holiday_date BETWEEN %(from_date)s AND %(to_date)s
		AND weekly_off = 0
	""", {
		'holiday_lists': unique_holiday_lists,
		'from_date': from_date,
		'to_date': to_date
	}, as_dict=True)

	# Build holiday_list -> [dates] mapping
	holidays_by_list = {}
	for h in holidays:
		if h.holiday_list not in holidays_by_list:
			holidays_by_list[h.holiday_list] = []
		holidays_by_list[h.holiday_list].append(h)

	# Collect all entries to create
	entries_to_create = []
	for emp_name, holiday_list in emp_to_holiday_list.items():
		emp_holidays = holidays_by_list.get(holiday_list, [])
		for holiday in emp_holidays:
			holiday_date = str(holiday.holiday_date)
			key = f"{emp_name}|{holiday_date}"

			if key not in existing_entries:
				entries_to_create.append({
					"doctype": "Roll Call Entry",
					"name": f"{emp_name}-{holiday_date}",
					"employee": emp_name,
					"date": holiday_date,
					"presence_type": "holiday",
					"presence_type_icon": holiday_pt.icon,
					"presence_type_label": holiday_pt.label,
					"source": "System",
					"is_half_day": 0,
					"notes": holiday.description or "",
					"owner": frappe.session.user,
					"creation": frappe.utils.now(),
					"modified": frappe.utils.now(),
					"modified_by": frappe.session.user,
				})
				existing_entries.add(key)  # Prevent duplicates within same batch

	# Bulk insert (1 query for all entries)
	if entries_to_create:
		try:
			frappe.db.bulk_insert("Roll Call Entry", entries_to_create, ignore_duplicates=True)
		except Exception:
			# Fall back to individual inserts if bulk fails
			for entry_dict in entries_to_create:
				try:
					doc = frappe.get_doc(entry_dict)
					doc.flags.ignore_permissions = True
					doc.insert(ignore_if_duplicate=True)
				except Exception:
					pass


def ensure_holiday_entries(employee: str, from_date: str, to_date: str):
	"""Auto-create Roll Call entries for holidays from HRMS Holiday List.

	DEPRECATED: Use ensure_holiday_entries_batch() for better performance.
	This function is kept for backwards compatibility.

	Args:
		employee: Employee ID
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	ensure_holiday_entries_batch([employee], from_date, to_date)


def ensure_day_off_entries_batch(employee_names: list, from_date: str, to_date: str, existing_entries: set = None):
	"""Batch auto-create Roll Call entries for scheduled days off from Work Pattern.

	This is the optimized batch version that creates day-off entries for ALL
	employees in a single operation instead of per-employee, per-day loops.

	Args:
		employee_names: List of Employee IDs
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
		existing_entries: Optional set of existing entry keys (employee|date) to avoid duplicate query
	"""
	if not employee_names:
		return

	from_date = getdate(from_date)
	to_date = getdate(to_date)

	# Get day off presence type from Flexitime Settings
	try:
		settings = frappe.get_cached_doc("Flexitime Settings")
		day_off_presence_type = settings.day_off_presence_type
	except Exception:
		# Fallback to default if settings not available
		day_off_presence_type = "day_off" if frappe.db.exists("Presence Type", "day_off") else None

	if not day_off_presence_type:
		return

	# Get day_off presence type details
	day_off_pt = frappe.db.get_value("Presence Type", day_off_presence_type, ["icon", "label"], as_dict=True)
	if not day_off_pt:
		return

	# Use provided existing entries or query them
	if existing_entries is None:
		existing = frappe.db.sql("""
			SELECT CONCAT(employee, '|', date) as entry_key
			FROM `tabRoll Call Entry`
			WHERE employee IN %(employees)s
			AND date BETWEEN %(from_date)s AND %(to_date)s
		""", {
			'employees': employee_names,
			'from_date': str(from_date),
			'to_date': str(to_date)
		}, as_dict=True)
		existing_entries = {e.entry_key for e in existing}

	# Get ALL work patterns for all employees covering the date range (1 query)
	# A pattern is valid if it overlaps with our date range
	patterns = frappe.db.sql("""
		SELECT name, employee, valid_from, valid_to,
			   monday_hours, tuesday_hours, wednesday_hours,
			   thursday_hours, friday_hours, saturday_hours, sunday_hours
		FROM `tabEmployee Work Pattern`
		WHERE employee IN %(employees)s
		AND valid_from <= %(to_date)s
		AND (valid_to >= %(from_date)s OR valid_to IS NULL)
		AND docstatus = 1
		ORDER BY employee, valid_from DESC
	""", {
		'employees': employee_names,
		'from_date': str(from_date),
		'to_date': str(to_date)
	}, as_dict=True)

	# Build pattern lookup: employee -> list of patterns (sorted by valid_from desc)
	patterns_by_employee = {}
	for p in patterns:
		if p.employee not in patterns_by_employee:
			patterns_by_employee[p.employee] = []
		patterns_by_employee[p.employee].append(p)

	# Helper to get hours for a weekday from a pattern dict
	def get_hours_for_weekday(pattern, weekday):
		hours_map = {
			0: pattern.monday_hours,
			1: pattern.tuesday_hours,
			2: pattern.wednesday_hours,
			3: pattern.thursday_hours,
			4: pattern.friday_hours,
			5: pattern.saturday_hours,
			6: pattern.sunday_hours
		}
		return hours_map.get(weekday, 0) or 0

	# Helper to check if date is day off based on pattern
	def is_day_off(pattern, date):
		weekday = date.weekday()
		# Weekends are not day_off (handled separately)
		if weekday >= 5:
			return False
		return get_hours_for_weekday(pattern, weekday) == 0

	# Helper to find the valid pattern for an employee on a specific date
	def get_pattern_for_date(emp, date):
		emp_patterns = patterns_by_employee.get(emp, [])
		for p in emp_patterns:
			valid_from = getdate(p.valid_from)
			valid_to = getdate(p.valid_to) if p.valid_to else None
			if valid_from <= date and (valid_to is None or valid_to >= date):
				return p
		return None

	# Calculate day-offs for all employees in memory (no queries)
	entries_to_create = []
	current_date = from_date

	while current_date <= to_date:
		weekday = current_date.weekday()
		# Skip weekends - they're not day_off entries
		if weekday >= 5:
			current_date = add_days(current_date, 1)
			continue

		for emp_name in employee_names:
			key = f"{emp_name}|{current_date}"

			# Skip if entry already exists
			if key in existing_entries:
				continue

			# Get pattern for this employee on this date
			pattern = get_pattern_for_date(emp_name, current_date)
			if pattern and is_day_off(pattern, current_date):
				entries_to_create.append({
					"doctype": "Roll Call Entry",
					"name": f"{emp_name}-{current_date}",
					"employee": emp_name,
					"date": str(current_date),
					"presence_type": day_off_presence_type,
					"presence_type_icon": day_off_pt.icon,
					"presence_type_label": day_off_pt.label,
					"source": "System",
					"is_half_day": 0,
					"owner": frappe.session.user,
					"creation": frappe.utils.now(),
					"modified": frappe.utils.now(),
					"modified_by": frappe.session.user,
				})
				existing_entries.add(key)  # Prevent duplicates

		current_date = add_days(current_date, 1)

	# Bulk insert (1 query for all entries)
	if entries_to_create:
		try:
			frappe.db.bulk_insert("Roll Call Entry", entries_to_create, ignore_duplicates=True)
		except Exception:
			# Fall back to individual inserts if bulk fails
			for entry_dict in entries_to_create:
				try:
					doc = frappe.get_doc(entry_dict)
					doc.flags.ignore_permissions = True
					doc.insert(ignore_if_duplicate=True)
				except Exception:
					pass


def ensure_day_off_entries(employee: str, from_date: str, to_date: str):
	"""Auto-create Roll Call entries for scheduled days off from Work Pattern.

	DEPRECATED: Use ensure_day_off_entries_batch() for better performance.
	This function is kept for backwards compatibility.

	Args:
		employee: Employee ID
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	ensure_day_off_entries_batch([employee], from_date, to_date)


@frappe.whitelist()
def get_events(month_start: str, month_end: str, employee_filters: str | dict | None = None):
	"""Get Roll Call entries for the given month with leave application status.

	Args:
	    month_start: Start date in YYYY-MM-DD format
	    month_end: End date in YYYY-MM-DD format
	    employee_filters: Optional filters for employees (company, department, branch)
	        Can be a JSON string or dict

	Returns:
	    dict with:
	    - entries: Employee name -> list of roll call entries
	    - current_employee: Current user's employee ID (for frontend logic)
	"""
	if isinstance(employee_filters, str):
		import json
		employee_filters = json.loads(employee_filters) if employee_filters else {}
	elif employee_filters is None:
		employee_filters = {}

	# Get current user's employee for visibility checks
	current_employee = get_current_employee()

	# Get employees who show in roll call from Employee Presence Settings
	from flexitime.flexitime.utils import get_employees_showing_in_roll_call
	roll_call_employees = get_employees_showing_in_roll_call()
	employee_names = [e.name for e in roll_call_employees]

	# Apply additional filters if provided
	emp_filters = {"status": "Active"}
	if employee_names:
		emp_filters["name"] = ["in", employee_names]
	if employee_filters.get("company"):
		emp_filters["company"] = employee_filters["company"]
	if employee_filters.get("department"):
		emp_filters["department"] = employee_filters["department"]
	if employee_filters.get("branch"):
		emp_filters["branch"] = employee_filters["branch"]

	# Get full employee data for the frontend (avoids separate API call)
	employees_data = frappe.get_all(
		"Employee",
		filters=emp_filters,
		fields=["name", "employee_name", "image", "nickname", "company", "department"],
		order_by="employee_name asc",
		limit_page_length=0,
		ignore_permissions=True
	)
	employee_names = [e.name for e in employees_data]

	if not employee_names:
		return {"entries": {}, "employees": [], "current_employee": current_employee}

	# Auto-populate system entries for all employees (BATCHED for performance)
	# Query existing entries ONCE and share between both batch functions
	existing = frappe.db.sql("""
		SELECT CONCAT(employee, '|', date) as entry_key
		FROM `tabRoll Call Entry`
		WHERE employee IN %(employees)s
		AND date BETWEEN %(from_date)s AND %(to_date)s
	""", {
		'employees': employee_names,
		'from_date': month_start,
		'to_date': month_end
	}, as_dict=True)
	existing_entries = {e.entry_key for e in existing}

	# Order matters: holidays first (take precedence), then day_off
	try:
		# Holidays from HRMS Holiday List (takes precedence over weekends)
		ensure_holiday_entries_batch(employee_names, month_start, month_end, existing_entries)
	except Exception:
		# Don't fail if holiday list not configured
		pass

	try:
		# Days off from Work Pattern
		ensure_day_off_entries_batch(employee_names, month_start, month_end, existing_entries)
	except Exception:
		# Don't fail the whole request if day off creation fails
		pass

	# Get roll call entries with leave_application field
	entries = frappe.get_all(
		"Roll Call Entry",
		filters={
			"employee": ["in", employee_names],
			"date": ["between", [month_start, month_end]],
		},
		fields=[
			"name",
			"employee",
			"date",
			"presence_type",
			"presence_type_icon",
			"presence_type_label",
			"is_half_day",
			"is_locked",
			"leave_application",
			"am_presence_type",
			"pm_presence_type",
			"am_presence_icon",
			"pm_presence_icon",
		],
		limit_page_length=0,
	)

	# Get presence types that require leave applications
	# These are the types that show striped patterns when not approved
	try:
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"requires_leave_application": 1},
			fields=["name"],
		)
	except Exception:
		# Get presence types that require leave applications
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"requires_leave_application": 1},
			fields=["name"],
		)
	leave_presence_types = [pt.name for pt in leave_presence_types_list]

	# Get leave application statuses for entries that have them
	leave_app_names = [e.leave_application for e in entries if e.leave_application]
	leave_app_status = {}
	if leave_app_names:
		leave_apps = frappe.get_all(
			"Leave Application",
			filters={"name": ["in", leave_app_names]},
			fields=["name", "status"],
		)
		leave_app_status = {la.name: la.status for la in leave_apps}

	# Pre-compute permission data ONCE for batch operations (instead of per-entry queries)
	is_hr = is_hr_department_member()
	managed_employees = get_managed_employees_batch(current_employee, employee_names)

	# Helper function to determine leave status for a presence type
	def get_leave_status_for_presence(presence_type, leave_application, entry_employee):
		"""Get leave status for a specific presence type."""
		if presence_type not in leave_presence_types:
			return "none"
		elif leave_application:
			la_status = leave_app_status.get(leave_application, "Draft")
			if la_status == "Approved":
				return "approved"
			else:
				# Use batch-optimized permission check (O(1) instead of database query)
				if can_view_draft_status_batch(current_employee, entry_employee, is_hr, managed_employees):
					return "draft"
				else:
					return "tentative"
		else:
			return "tentative"

	# Process entries with leave status
	for entry in entries:
		# Check if this is a split day entry
		if entry.is_half_day and entry.am_presence_type and entry.pm_presence_type:
			# Split day - calculate leave status for AM and PM separately
			entry["am_leave_status"] = get_leave_status_for_presence(
				entry.am_presence_type, entry.leave_application, entry.employee
			)
			entry["pm_leave_status"] = get_leave_status_for_presence(
				entry.pm_presence_type, entry.leave_application, entry.employee
			)
			# Main leave_status is the "worst" status (tentative > draft > approved > none)
			status_priority = {"tentative": 3, "draft": 2, "approved": 1, "none": 0}
			am_priority = status_priority.get(entry["am_leave_status"], 0)
			pm_priority = status_priority.get(entry["pm_leave_status"], 0)
			if am_priority >= pm_priority:
				entry["leave_status"] = entry["am_leave_status"]
			else:
				entry["leave_status"] = entry["pm_leave_status"]
		else:
			# Full day entry - single leave status
			entry["leave_status"] = get_leave_status_for_presence(
				entry.presence_type, entry.leave_application, entry.employee
			)
			entry["am_leave_status"] = None
			entry["pm_leave_status"] = None

	# Group by employee
	result = {emp: [] for emp in employee_names}
	for entry in entries:
		if entry.employee in result:
			result[entry.employee].append(entry)

	# Query open/draft leave applications that don't have Roll Call entries yet
	# These are leaves that have been submitted but not yet approved
	open_leave_apps = frappe.get_all("Leave Application", filters={
		"employee": ["in", employee_names],
		"from_date": ["<=", month_end],
		"to_date": [">=", month_start],
		"status": ["in", ["Open"]],  # Only open (pending approval)
		"docstatus": ["<", 2]  # Not cancelled
	}, fields=["name", "employee", "from_date", "to_date", "leave_type", "status", "half_day", "half_day_date"])

	# Pre-fetch ALL presence types with leave_type mapping (1 query instead of N)
	presence_types_with_leave = frappe.db.sql("""
		SELECT name, leave_type, icon, label, color
		FROM `tabPresence Type`
		WHERE leave_type IS NOT NULL
	""", as_dict=True)
	presence_type_by_leave = {pt.leave_type: pt for pt in presence_types_with_leave}

	# Build a lookup: employee -> [list of pending leave entries by date]
	# Group by employee for efficient lookup
	pending_leaves_by_employee = {emp: {} for emp in employee_names}
	for la in open_leave_apps:
		# O(1) lookup instead of database query per leave app
		presence_type_info = presence_type_by_leave.get(la.leave_type)

		current_date = getdate(la.from_date)
		end_date = getdate(la.to_date)
		while current_date <= end_date:
			# Only include if within our date range
			if getdate(month_start) <= current_date <= getdate(month_end):
				date_str = str(current_date)
				is_half = la.half_day and la.half_day_date and getdate(la.half_day_date) == current_date

				leave_info = {
					"name": la.name,
					"leave_type": la.leave_type,
					"status": la.status,
					"is_half_day": is_half,
					"presence_type": presence_type_info.name if presence_type_info else None,
					"icon": presence_type_info.icon if presence_type_info else "📋",
					"label": presence_type_info.label if presence_type_info else la.leave_type,
					"color": presence_type_info.color if presence_type_info else "#fef3c7"
				}

				# Store under employee -> date
				if date_str not in pending_leaves_by_employee[la.employee]:
					pending_leaves_by_employee[la.employee][date_str] = []
				pending_leaves_by_employee[la.employee][date_str].append(leave_info)

			current_date = add_days(current_date, 1)

	# Check for employees without work patterns (for warning display)
	employees_without_patterns = check_missing_work_patterns(employee_names, month_start)

	return {
		"entries": result,
		"employees": employees_data,  # Include employee data to avoid separate API call
		"pending_leaves": pending_leaves_by_employee,
		"current_employee": current_employee,
		"warnings": {
			"missing_work_patterns": employees_without_patterns
		} if employees_without_patterns else {}
	}


def calculate_leave_status_for_entry(entry_dict, cache=None):
	"""Calculate and add leave_status fields to an entry dict.

	This replicates the logic from get_roll_call_entries() for single-entry updates.

	Args:
		entry_dict: Entry data as dict (from as_dict())
		cache: Optional dict with pre-fetched data for batch operations:
			- leave_presence_types: set of presence type names requiring leave
			- leave_app_statuses: dict of leave_application -> status
			- current_employee: current user's employee ID
			- is_hr: bool
			- managed_employees: set of employee IDs

	Returns:
		dict: Entry with leave_status, am_leave_status, pm_leave_status added
	"""
	# Use cache if provided, otherwise fetch (for single-entry calls)
	if cache:
		leave_presence_types = cache.get("leave_presence_types", set())
		current_employee = cache.get("current_employee")
		is_hr = cache.get("is_hr", False)
		managed_employees = cache.get("managed_employees", set())
		leave_app_status = cache.get("leave_app_statuses", {}).get(entry_dict.get("leave_application"))
	else:
		# Fallback for single-entry calls (not batch)
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"requires_leave_application": 1},
			pluck="name"
		)
		leave_presence_types = set(leave_presence_types_list)
		current_employee = get_current_employee()
		is_hr = is_hr_department_member()
		managed_employees = set()
		leave_app_status = None
		if entry_dict.get("leave_application"):
			leave_app_status = frappe.db.get_value(
				"Leave Application", entry_dict["leave_application"], "status"
			)

	def get_leave_status_for_presence(presence_type, leave_application):
		"""Get leave status for a specific presence type."""
		if presence_type not in leave_presence_types:
			return "none"
		elif leave_application:
			la_status = leave_app_status or "Draft"
			if la_status == "Approved":
				return "approved"
			else:
				if can_view_draft_status_batch(current_employee, entry_dict["employee"], is_hr, managed_employees):
					return "draft"
				else:
					return "tentative"
		else:
			return "tentative"

	# Check if this is a split day entry
	if entry_dict.get("is_half_day") and entry_dict.get("am_presence_type") and entry_dict.get("pm_presence_type"):
		# Split day - calculate leave status for AM and PM separately
		entry_dict["am_leave_status"] = get_leave_status_for_presence(
			entry_dict["am_presence_type"], entry_dict.get("leave_application")
		)
		entry_dict["pm_leave_status"] = get_leave_status_for_presence(
			entry_dict["pm_presence_type"], entry_dict.get("leave_application")
		)
		# Main leave_status is the "worst" status (tentative > draft > approved > none)
		status_priority = {"tentative": 3, "draft": 2, "approved": 1, "none": 0}
		am_priority = status_priority.get(entry_dict["am_leave_status"], 0)
		pm_priority = status_priority.get(entry_dict["pm_leave_status"], 0)
		if am_priority >= pm_priority:
			entry_dict["leave_status"] = entry_dict["am_leave_status"]
		else:
			entry_dict["leave_status"] = entry_dict["pm_leave_status"]
	else:
		# Full day entry - single leave status
		entry_dict["leave_status"] = get_leave_status_for_presence(
			entry_dict.get("presence_type"), entry_dict.get("leave_application")
		)
		entry_dict["am_leave_status"] = None
		entry_dict["pm_leave_status"] = None

	return entry_dict


def build_leave_status_cache(entries):
	"""Build a cache for batch leave status calculation.

	Args:
		entries: List of entry dicts

	Returns:
		dict: Cache with pre-fetched data
	"""
	# Get presence types that require leave applications (1 query)
	leave_presence_types = set(frappe.get_all(
		"Presence Type",
		filters={"requires_leave_application": 1},
		pluck="name"
	))

	# Get current employee and permission data
	current_employee = get_current_employee()
	is_hr = is_hr_department_member()

	# Get managed employees for line manager check
	managed_employees = set()
	if current_employee and not is_hr:
		managed = frappe.get_all(
			"Employee",
			filters={"reports_to": current_employee, "status": "Active"},
			pluck="name"
		)
		managed_employees = set(managed)

	# Get leave application statuses (1 query for all)
	leave_app_names = [e.get("leave_application") for e in entries if e.get("leave_application")]
	leave_app_statuses = {}
	if leave_app_names:
		leave_apps = frappe.get_all(
			"Leave Application",
			filters={"name": ["in", leave_app_names]},
			fields=["name", "status"]
		)
		leave_app_statuses = {la.name: la.status for la in leave_apps}

	return {
		"leave_presence_types": leave_presence_types,
		"current_employee": current_employee,
		"is_hr": is_hr,
		"managed_employees": managed_employees,
		"leave_app_statuses": leave_app_statuses,
	}


def validate_presence_type_for_roll_call(employee: str, date: str, presence_type: str):
	"""Validate a presence type before saving to Roll Call.

	Checks:
	1. If leave-type presence, check for matching Leave Application
	2. If leave-type presence, block if hours already recorded
	3. Block edit if approved leave already exists

	Args:
		employee: Employee ID
		date: Date string (YYYY-MM-DD)
		presence_type: Presence Type name

	Returns:
		str | None: Leave Application name if auto-linked, None otherwise

	Raises:
		frappe.ValidationError: If validation fails
	"""
	if not presence_type:
		return None

	# Get presence type properties
	pt = frappe.db.get_value("Presence Type", presence_type,
		["leave_type", "requires_leave_application"], as_dict=True)

	if not pt:
		return None

	leave_application = None

	# Check if this is a leave-type presence
	if pt.requires_leave_application and pt.leave_type:
		# First check: Is there already an approved leave for this date?
		existing_entry = frappe.db.get_value("Roll Call Entry",
			{"employee": employee, "date": date},
			["name", "leave_application", "source"],
			as_dict=True
		)

		if existing_entry and existing_entry.leave_application:
			# Check if leave is approved
			leave_status = frappe.db.get_value("Leave Application",
				existing_entry.leave_application, ["status", "docstatus"], as_dict=True)

			if leave_status and leave_status.status == "Approved" and leave_status.docstatus == 1:
				frappe.throw(
					_("Cannot modify entry for {0}. An approved Leave Application exists.<br>"
					  "Cancel the leave first if you need to change presence.").format(date),
					title=_("Approved Leave Exists")
				)

		# Second check: Are there hours already recorded?
		weekly_entry = frappe.db.get_value("Weekly Entry", {
			"employee": employee,
			"week_start": ["<=", date],
			"week_end": [">=", date],
		}, "name")

		if weekly_entry:
			doc = frappe.get_doc("Weekly Entry", weekly_entry)
			for daily in doc.daily_entries:
				if str(daily.date) == str(date) and daily.actual_hours and daily.actual_hours > 0:
					frappe.throw(
						_("Cannot set leave for {0}. You have already recorded {1} hours.<br>"
						  "Please clear the hours in your Weekly Entry first.").format(
							date, daily.actual_hours),
						title=_("Hours Already Recorded")
					)

		# Third check: Look for open/approved Leave Application to auto-link
		leave_application = frappe.db.get_value("Leave Application", {
			"employee": employee,
			"from_date": ["<=", date],
			"to_date": [">=", date],
			"leave_type": pt.leave_type,
			"status": ["in", ["Open", "Approved"]],
			"docstatus": ["<", 2]
		}, "name")

		if not leave_application and pt.requires_leave_application:
			frappe.throw(
				_("Cannot set '{0}' without a Leave Application.<br>"
				  "Please create a Leave Application for {1} first.").format(
					presence_type, date),
				title=_("Leave Application Required")
			)

	return leave_application


def sync_roll_call_to_weekly_entry(employee: str, date: str, roll_call_entry):
	"""Sync Roll Call changes to Weekly Entry's Daily Entry.

	Updates the corresponding Daily Entry in the Weekly Entry to match
	the Roll Call Entry, keeping both in sync.

	Args:
		employee: Employee ID
		date: Date string
		roll_call_entry: Roll Call Entry document
	"""
	from flexitime.flexitime.doctype.weekly_entry.weekly_entry import calculate_expected_hours

	weekly_entry_name = frappe.db.get_value("Weekly Entry", {
		"employee": employee,
		"week_start": ["<=", date],
		"week_end": [">=", date],
		"docstatus": 0  # Only draft Weekly Entries
	}, "name")

	if not weekly_entry_name:
		return

	doc = frappe.get_doc("Weekly Entry", weekly_entry_name)
	changed = False

	for daily in doc.daily_entries:
		if str(daily.date) == str(date):
			daily.presence_type = roll_call_entry.presence_type
			daily.leave_application = roll_call_entry.leave_application

			# Fetch icon and label
			if roll_call_entry.presence_type:
				pt = frappe.db.get_value("Presence Type", roll_call_entry.presence_type,
					["icon", "label"], as_dict=True)
				if pt:
					daily.presence_type_icon = pt.icon
					daily.presence_type_label = pt.label
			else:
				daily.presence_type_icon = None
				daily.presence_type_label = None

			# Recalculate expected hours (approved leaves reduce to 0)
			has_approved_leave = bool(roll_call_entry.leave_application)
			daily.expected_hours = calculate_expected_hours(
				employee, date, has_approved_leave, roll_call_entry.is_half_day
			)
			changed = True
			break

	if changed:
		doc.flags.ignore_permissions = True
		doc.save()


@frappe.whitelist()
def save_entry(employee: str, date: str, presence_type: str, is_half_day: bool = False):
	"""Save or update a Roll Call entry (full day).

	Args:
	    employee: Employee ID
	    date: Date in YYYY-MM-DD format
	    presence_type: Presence Type name
	    is_half_day: Whether it's a half day (legacy, use save_split_entry for AM/PM)

	Returns:
	    dict: The saved entry with leave_status calculated

	Raises:
	    frappe.PermissionError: If user doesn't have permission to edit this employee's entry
	"""
	# Permission check: users can only edit their own entries (HR can edit anyone)
	if not can_edit_employee_entry(employee):
		frappe.throw(
			_("You can only edit your own Roll Call entries"),
			frappe.PermissionError
		)

	if isinstance(is_half_day, str):
		is_half_day = is_half_day.lower() in ("true", "1", "yes")

	# Validate presence type and get any auto-linked leave application
	leave_application = validate_presence_type_for_roll_call(employee, date, presence_type)

	# Check if entry already exists
	existing = frappe.db.exists("Roll Call Entry", {"employee": employee, "date": date})

	if existing:
		# Update existing entry
		entry = frappe.get_doc("Roll Call Entry", existing)
		if entry.is_locked:
			frappe.throw(_("This entry is locked and cannot be modified"))
		entry.presence_type = presence_type
		entry.is_half_day = is_half_day
		# Clear split fields when setting full day
		entry.am_presence_type = None
		entry.pm_presence_type = None
		entry.am_presence_icon = None
		entry.pm_presence_icon = None
		entry.source = "Manual"
		# Auto-link leave application if found
		if leave_application:
			entry.leave_application = leave_application
		entry.save()
	else:
		# Create new entry
		entry = frappe.get_doc({
			"doctype": "Roll Call Entry",
			"employee": employee,
			"date": date,
			"presence_type": presence_type,
			"is_half_day": is_half_day,
			"source": "Manual",
			"leave_application": leave_application,  # Auto-link if found
		})
		entry.insert()

	frappe.db.commit()

	# Sync changes to Weekly Entry
	sync_roll_call_to_weekly_entry(employee, date, entry)

	# Return entry with calculated leave_status
	return calculate_leave_status_for_entry(entry.as_dict())


@frappe.whitelist()
def save_split_entry(employee: str, date: str, am_presence_type: str, pm_presence_type: str):
	"""Save or update a Roll Call entry with split AM/PM presence types.

	Args:
	    employee: Employee ID
	    date: Date in YYYY-MM-DD format
	    am_presence_type: Morning presence type
	    pm_presence_type: Afternoon presence type

	Returns:
	    dict: The saved entry with leave_status calculated

	Raises:
	    frappe.PermissionError: If user doesn't have permission to edit this employee's entry
	"""
	# Permission check: users can only edit their own entries (HR can edit anyone)
	if not can_edit_employee_entry(employee):
		frappe.throw(
			_("You can only edit your own Roll Call entries"),
			frappe.PermissionError
		)

	# Validate both presence types (AM first as primary)
	am_leave_application = validate_presence_type_for_roll_call(employee, date, am_presence_type)
	pm_leave_application = validate_presence_type_for_roll_call(employee, date, pm_presence_type)
	# Use whichever leave application was found
	leave_application = am_leave_application or pm_leave_application

	# Get icons for presence types
	am_icon = frappe.db.get_value("Presence Type", am_presence_type, "icon") or ""
	pm_icon = frappe.db.get_value("Presence Type", pm_presence_type, "icon") or ""

	# Check if entry already exists
	existing = frappe.db.exists("Roll Call Entry", {"employee": employee, "date": date})

	if existing:
		entry = frappe.get_doc("Roll Call Entry", existing)
		if entry.is_locked:
			frappe.throw(_("This entry is locked and cannot be modified"))
		entry.is_half_day = True
		entry.am_presence_type = am_presence_type
		entry.pm_presence_type = pm_presence_type
		entry.am_presence_icon = am_icon
		entry.pm_presence_icon = pm_icon
		# Set main presence_type to AM for consistency
		entry.presence_type = am_presence_type
		entry.source = "Manual"
		# Auto-link leave application if found
		if leave_application:
			entry.leave_application = leave_application
		entry.save()
	else:
		entry = frappe.get_doc({
			"doctype": "Roll Call Entry",
			"employee": employee,
			"date": date,
			"presence_type": am_presence_type,
			"is_half_day": True,
			"am_presence_type": am_presence_type,
			"pm_presence_type": pm_presence_type,
			"am_presence_icon": am_icon,
			"pm_presence_icon": pm_icon,
			"source": "Manual",
			"leave_application": leave_application,  # Auto-link if found
		})
		entry.insert()

	frappe.db.commit()

	# Sync changes to Weekly Entry
	sync_roll_call_to_weekly_entry(employee, date, entry)

	# Return entry with calculated leave_status
	return calculate_leave_status_for_entry(entry.as_dict())


@frappe.whitelist()
def save_bulk_entries(entries: list | str, presence_type: str, day_part: str = "full"):
	"""Save multiple Roll Call entries at once using bulk operations.

	Args:
	    entries: List of {employee, date} dicts
	    presence_type: Presence Type to apply
	    day_part: "full", "am", or "pm"

	Returns:
	    dict: Count of saved entries

	Raises:
	    frappe.PermissionError: If user tries to edit another employee's entry
	"""
	import json
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		return {"saved": 0, "total": 0}

	# Permission check: verify user can edit all employees in the list
	is_hr = is_hr_department_member()
	if not is_hr:
		current_emp = get_current_employee()
		if not current_emp:
			frappe.throw(
				_("Your user account is not linked to an Employee record. Please contact HR."),
				frappe.PermissionError
			)
		for entry in entries:
			entry_employee = entry.get("employee")
			if not entry_employee or entry_employee != current_emp:
				frappe.throw(
					_("You can only edit your own Roll Call entries. Attempted to edit: {0}").format(entry_employee or "unknown"),
					frappe.PermissionError
				)

	# Validate presence type exists
	if not presence_type or not frappe.db.exists("Presence Type", presence_type):
		frappe.throw(_("Presence Type '{0}' not found").format(presence_type or ""))

	# Get presence type info once
	pt_info = frappe.db.get_value("Presence Type", presence_type, ["icon", "label"], as_dict=True) or {}
	icon = pt_info.get("icon") or ""

	# Collect all employee/date pairs
	keys = [(e.get("employee"), e.get("date")) for e in entries if e.get("employee") and e.get("date")]
	if not keys:
		return {"saved": 0, "total": 0}

	# Batch check existing entries
	conditions = " OR ".join([f"(employee = %s AND date = %s)" for _ in keys])
	params = [val for pair in keys for val in pair]

	existing_entries = frappe.db.sql(f"""
		SELECT name, employee, date, is_locked, presence_type, presence_type_icon,
		       am_presence_type, pm_presence_type
		FROM `tabRoll Call Entry`
		WHERE {conditions}
	""", params, as_dict=True)

	existing_map = {(e.employee, str(e.date)): e for e in existing_entries}

	# Prepare bulk updates and inserts
	to_update = []
	to_insert = []
	saved_count = 0

	for employee, date in keys:
		existing = existing_map.get((employee, date))

		if existing:
			if existing.is_locked:
				continue  # Skip locked entries

			update_vals = {"source": "Manual", "modified": frappe.utils.now()}

			if day_part == "full":
				update_vals.update({
					"presence_type": presence_type,
					"is_half_day": 0,
					"am_presence_type": None,
					"pm_presence_type": None,
					"am_presence_icon": None,
					"pm_presence_icon": None,
				})
			elif day_part == "am":
				pm_type = existing.pm_presence_type or existing.presence_type
				pm_icon = existing.get("pm_presence_icon") or existing.get("presence_type_icon") or ""
				update_vals.update({
					"is_half_day": 1,
					"presence_type": presence_type,
					"am_presence_type": presence_type,
					"am_presence_icon": icon,
					"pm_presence_type": pm_type,
					"pm_presence_icon": pm_icon,
				})
			elif day_part == "pm":
				am_type = existing.am_presence_type or existing.presence_type
				am_icon = existing.get("am_presence_icon") or existing.get("presence_type_icon") or ""
				update_vals.update({
					"is_half_day": 1,
					"pm_presence_type": presence_type,
					"pm_presence_icon": icon,
					"am_presence_type": am_type,
					"am_presence_icon": am_icon,
				})

			to_update.append((existing.name, update_vals))
			saved_count += 1
		else:
			# New entry
			entry_dict = {
				"doctype": "Roll Call Entry",
				"employee": employee,
				"date": date,
				"presence_type": presence_type,
				"source": "Manual",
				"is_half_day": 0 if day_part == "full" else 1,
			}

			if day_part in ("am", "pm"):
				entry_dict.update({
					"am_presence_type": presence_type,
					"am_presence_icon": icon,
					"pm_presence_type": presence_type,
					"pm_presence_icon": icon,
				})

			to_insert.append(entry_dict)
			saved_count += 1

	# Execute bulk updates - use direct SQL for better concurrency handling
	if to_update:
		for name, vals in to_update:
			try:
				# Use direct SQL update to avoid timestamp conflicts
				# This is safe for Roll Call entries as they don't have complex validation
				set_clause = ", ".join([f"`{k}` = %s" for k in vals.keys()])
				values = list(vals.values())
				# Parameters: vals... + modified_by + name (for WHERE clause)
				frappe.db.sql(f"""
					UPDATE `tabRoll Call Entry`
					SET {set_clause}, `modified` = NOW(), `modified_by` = %s
					WHERE name = %s
				""", values + [frappe.session.user, name])
			except Exception:
				# If update fails, skip silently - entry may have been deleted or locked
				pass

	# Execute bulk inserts using frappe.db.bulk_insert
	if to_insert:
		# Add required fields for bulk insert
		for entry_dict in to_insert:
			entry_dict["name"] = f"{entry_dict['employee']}-{entry_dict['date']}"
			entry_dict["owner"] = frappe.session.user
			entry_dict["creation"] = frappe.utils.now()
			entry_dict["modified"] = frappe.utils.now()
			entry_dict["modified_by"] = frappe.session.user
			entry_dict["docstatus"] = 0

		try:
			frappe.db.bulk_insert("Roll Call Entry", to_insert, ignore_duplicates=True)
		except Exception:
			# Fall back to individual inserts if bulk fails
			for entry_dict in to_insert:
				try:
					doc = frappe.get_doc(entry_dict)
					doc.flags.ignore_permissions = True
					doc.insert(ignore_if_duplicate=True)
				except Exception:
					pass

	frappe.db.commit()

	# Fetch and return all saved entries for client-side update (BATCHED)
	saved_entries = []
	if (to_update or to_insert) and keys:
		# Pre-fetch all presence type info (1 query instead of N)
		all_presence_types = frappe.db.sql("""
			SELECT name, icon, label FROM `tabPresence Type`
		""", as_dict=True)
		pt_map = {pt.name: pt for pt in all_presence_types}

		# Batch fetch all saved entries (1 query instead of N)
		conditions = " OR ".join([f"(employee = %s AND date = %s)" for _ in keys])
		params = [val for pair in keys for val in pair]
		fetched_entries = frappe.db.sql(f"""
			SELECT name, employee, date, presence_type, is_half_day,
				   am_presence_type, pm_presence_type, am_presence_icon,
				   pm_presence_icon, is_locked, leave_application
			FROM `tabRoll Call Entry`
			WHERE {conditions}
		""", params, as_dict=True)

		# Build cache once for all entries (instead of N queries per entry)
		leave_status_cache = build_leave_status_cache(fetched_entries)

		for entry in fetched_entries:
			entry_dict = dict(entry)
			entry_dict = calculate_leave_status_for_entry(entry_dict, cache=leave_status_cache)
			# Add presence type info using pre-fetched map (O(1) lookup)
			pt_info = pt_map.get(entry_dict.get("presence_type")) or {}
			entry_dict["presence_type_icon"] = pt_info.get("icon") or ""
			entry_dict["presence_type_label"] = pt_info.get("label") or entry_dict.get("presence_type")
			saved_entries.append(entry_dict)

	return {"saved": saved_count, "total": len(entries), "entries": saved_entries}


@frappe.whitelist()
def save_bulk_split_entries(entries: list | str, am_presence_type: str, pm_presence_type: str):
	"""Save multiple Roll Call entries as split AM/PM entries.

	Args:
	    entries: List of {employee, date} dicts
	    am_presence_type: Morning presence type
	    pm_presence_type: Afternoon presence type

	Returns:
	    dict: Count of saved entries

	Raises:
	    frappe.PermissionError: If user tries to edit another employee's entry
	"""
	import json
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		return {"saved": 0, "total": 0}

	# Permission check: verify user can edit all employees in the list
	is_hr = is_hr_department_member()
	if not is_hr:
		current_emp = get_current_employee()
		if not current_emp:
			frappe.throw(
				_("Your user account is not linked to an Employee record. Please contact HR."),
				frappe.PermissionError
			)
		for entry in entries:
			entry_employee = entry.get("employee")
			if not entry_employee or entry_employee != current_emp:
				frappe.throw(
					_("You can only edit your own Roll Call entries. Attempted to edit: {0}").format(entry_employee or "unknown"),
					frappe.PermissionError
				)

	# Get icons for presence types
	am_icon = frappe.db.get_value("Presence Type", am_presence_type, "icon") or ""
	pm_icon = frappe.db.get_value("Presence Type", pm_presence_type, "icon") or ""

	# Collect all employee/date pairs
	keys = [(e.get("employee"), e.get("date")) for e in entries if e.get("employee") and e.get("date")]
	if not keys:
		return {"saved": 0, "total": 0}

	# Batch check existing entries
	conditions = " OR ".join([f"(employee = %s AND date = %s)" for _ in keys])
	params = [val for pair in keys for val in pair]

	existing_entries = frappe.db.sql(f"""
		SELECT name, employee, date, is_locked
		FROM `tabRoll Call Entry`
		WHERE {conditions}
	""", params, as_dict=True)

	existing_map = {(e.employee, str(e.date)): e for e in existing_entries}

	# Collect updates and inserts
	to_update = []
	to_insert = []
	saved_count = 0

	for employee, date in keys:
		existing = existing_map.get((employee, date))

		if existing:
			if existing.is_locked:
				continue  # Skip locked entries

			to_update.append((existing.name, {
				"is_half_day": 1,
				"presence_type": am_presence_type,
				"am_presence_type": am_presence_type,
				"pm_presence_type": pm_presence_type,
				"am_presence_icon": am_icon,
				"pm_presence_icon": pm_icon,
				"source": "Manual",
			}))
			saved_count += 1
		else:
			to_insert.append({
				"doctype": "Roll Call Entry",
				"name": f"{employee}-{date}",
				"employee": employee,
				"date": date,
				"presence_type": am_presence_type,
				"is_half_day": 1,
				"am_presence_type": am_presence_type,
				"pm_presence_type": pm_presence_type,
				"am_presence_icon": am_icon,
				"pm_presence_icon": pm_icon,
				"source": "Manual",
				"owner": frappe.session.user,
				"creation": frappe.utils.now(),
				"modified": frappe.utils.now(),
				"modified_by": frappe.session.user,
				"docstatus": 0,
			})
			saved_count += 1

	# Execute bulk updates - use direct SQL for better concurrency handling
	if to_update:
		for name, vals in to_update:
			try:
				# Use direct SQL update to avoid timestamp conflicts
				# This is safe for Roll Call entries as they don't have complex validation
				set_clause = ", ".join([f"`{k}` = %s" for k in vals.keys()])
				values = list(vals.values())
				# Parameters: vals... + modified_by + name (for WHERE clause)
				frappe.db.sql(f"""
					UPDATE `tabRoll Call Entry`
					SET {set_clause}, `modified` = NOW(), `modified_by` = %s
					WHERE name = %s
				""", values + [frappe.session.user, name])
			except Exception:
				# If update fails, skip silently - entry may have been deleted or locked
				pass

	# Execute bulk inserts
	if to_insert:
		try:
			frappe.db.bulk_insert("Roll Call Entry", to_insert, ignore_duplicates=True)
		except Exception:
			# Fall back to individual inserts if bulk fails
			for entry_dict in to_insert:
				try:
					doc = frappe.get_doc(entry_dict)
					doc.flags.ignore_permissions = True
					doc.insert(ignore_if_duplicate=True)
				except Exception:
					pass

	frappe.db.commit()

	# Fetch and return all saved entries for client-side update (BATCHED)
	saved_entries = []
	if keys:
		# Pre-fetch all presence type info (1 query instead of N*3)
		all_presence_types = frappe.db.sql("""
			SELECT name, icon, label FROM `tabPresence Type`
		""", as_dict=True)
		pt_map = {pt.name: pt for pt in all_presence_types}

		# Batch fetch all saved entries (1 query instead of N)
		conditions = " OR ".join([f"(employee = %s AND date = %s)" for _ in keys])
		params = [val for pair in keys for val in pair]
		fetched_entries = frappe.db.sql(f"""
			SELECT name, employee, date, presence_type, is_half_day,
				   am_presence_type, pm_presence_type, am_presence_icon,
				   pm_presence_icon, is_locked, leave_application
			FROM `tabRoll Call Entry`
			WHERE {conditions}
		""", params, as_dict=True)

		# Build cache once for all entries (instead of N queries per entry)
		leave_status_cache = build_leave_status_cache(fetched_entries)

		for entry in fetched_entries:
			entry_dict = dict(entry)
			entry_dict = calculate_leave_status_for_entry(entry_dict, cache=leave_status_cache)

			# Add presence type info using pre-fetched map (O(1) lookups)
			am_pt = pt_map.get(entry_dict.get("am_presence_type")) or {}
			pm_pt = pt_map.get(entry_dict.get("pm_presence_type")) or {}
			main_pt = pt_map.get(entry_dict.get("presence_type")) or {}

			entry_dict["am_presence_type_label"] = am_pt.get("label") or entry_dict.get("am_presence_type")
			entry_dict["pm_presence_type_label"] = pm_pt.get("label") or entry_dict.get("pm_presence_type")
			entry_dict["presence_type_icon"] = main_pt.get("icon") or ""
			entry_dict["presence_type_label"] = main_pt.get("label") or entry_dict.get("presence_type")
			saved_entries.append(entry_dict)

	return {"saved": saved_count, "total": len(entries), "entries": saved_entries}


@frappe.whitelist()
def delete_bulk_entries(entries: list | str):
	"""Delete multiple Roll Call entries in bulk.

	Args:
	    entries: List of {employee, date} dicts

	Returns:
	    dict: Count of deleted entries

	Raises:
	    frappe.PermissionError: If user tries to delete another employee's entry
	"""
	import json
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		return {"deleted": 0, "total": 0}

	# Collect all employee/date pairs
	keys = [(e.get("employee"), e.get("date")) for e in entries if e.get("employee") and e.get("date")]
	if not keys:
		return {"deleted": 0, "total": 0}

	# Permission check: verify user can edit all employees in the list
	is_hr = is_hr_department_member()
	if not is_hr:
		current_emp = get_current_employee()
		for employee, _ in keys:
			if employee != current_emp:
				frappe.throw(
					_("You can only delete your own Roll Call entries"),
					frappe.PermissionError
				)

	# Batch find existing entries
	conditions = " OR ".join([f"(employee = %s AND date = %s)" for _ in keys])
	params = [val for pair in keys for val in pair]

	existing_entries = frappe.db.sql(f"""
		SELECT name, employee, date, is_locked
		FROM `tabRoll Call Entry`
		WHERE {conditions}
	""", params, as_dict=True)

	deleted_count = 0
	deleted_keys = []
	failed_entries = []

	# Delete entries with retry logic to handle database locks
	import time
	max_retries = 3
	retry_delay = 0.1  # 100ms
	batch_size = 10  # Commit every N deletions to balance performance and lock release

	for i, entry in enumerate(existing_entries):
		if entry.is_locked:
			failed_entries.append({"employee": entry.employee, "date": str(entry.date), "reason": "locked"})
			continue  # Skip locked entries

		retries = 0
		success = False
		while retries < max_retries:
			try:
				frappe.delete_doc("Roll Call Entry", entry.name, ignore_permissions=True, force=True)
				deleted_count += 1
				deleted_keys.append({"employee": entry.employee, "date": str(entry.date)})
				success = True
				break  # Success, exit retry loop
			except Exception as e:
				# Check if it's a lock timeout or deadlock error
				error_str = str(e).lower()
				if "lock wait timeout" in error_str or "deadlock" in error_str or "querytimeout" in error_str:
					retries += 1
					if retries < max_retries:
						time.sleep(retry_delay * retries)  # Exponential backoff
						frappe.db.rollback()  # Rollback the failed transaction
						continue
					# Max retries reached, mark as failed
					failed_entries.append({
						"employee": entry.employee,
						"date": str(entry.date),
						"reason": "lock_timeout"
					})
				else:
					# If not a lock error, re-raise immediately
					raise

		# Commit in batches to release locks periodically
		if success and (deleted_count % batch_size == 0):
			try:
				frappe.db.commit()
			except Exception:
				frappe.db.rollback()

	# Final commit for any remaining changes
	try:
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()

	return {
		"deleted": deleted_count,
		"total": len(entries),
		"entries": deleted_keys,
		"failed": len(failed_entries),
		"failed_entries": failed_entries
	}


@frappe.whitelist()
def get_leave_planning_summary(year: str = None, employee_filter: str = None):
	"""Get aggregated leave planning summary - lightweight for dashboards.

	This endpoint returns summarized data about tentative leave entries and
	pending leave applications without loading all individual entries.

	Args:
		year: Year to summarize (default: current year)
		employee_filter: Optional - 'managed' to show only direct reports,
						 'all' for HR view, or specific employee ID

	Returns:
		dict: {
			tentative: {
				total_days: int,
				by_employee: [{employee, employee_name, days, date_ranges: [{from, to, presence_type, label}]}]
			},
			pending_approval: {
				count: int,
				applications: [{name, employee_name, leave_type, from_date, to_date, days}]
			},
			conflicts: [{date, employees: [{name, employee_name}], count}]
		}
	"""
	from datetime import datetime
	from collections import defaultdict

	# Determine year range
	if not year:
		year = str(datetime.now().year)

	year_start = f"{year}-01-01"
	year_end = f"{year}-12-31"

	current_employee = get_current_employee()
	is_hr = is_hr_department_member()

	# Determine which employees to include
	employee_names = []

	if employee_filter == "managed" and current_employee:
		# Direct reports only
		employee_names = frappe.db.sql_list("""
			SELECT name FROM `tabEmployee`
			WHERE reports_to = %s AND status = 'Active'
		""", current_employee)
	elif is_hr or employee_filter == "all":
		# All active employees
		employee_names = frappe.db.sql_list("""
			SELECT name FROM `tabEmployee` WHERE status = 'Active'
		""")
	elif employee_filter:
		# Specific employee
		employee_names = [employee_filter]
	else:
		# Default: current employee + direct reports
		employee_names = [current_employee] if current_employee else []
		if current_employee:
			direct_reports = frappe.db.sql_list("""
				SELECT name FROM `tabEmployee`
				WHERE reports_to = %s AND status = 'Active'
			""", current_employee)
			employee_names.extend(direct_reports)

	if not employee_names:
		return {
			"tentative": {"total_days": 0, "by_employee": []},
			"pending_approval": {"count": 0, "applications": []},
			"conflicts": []
		}

	# Get employee names for display
	employee_info = {e.name: e for e in frappe.db.sql("""
		SELECT name, employee_name FROM `tabEmployee` WHERE name IN %s
	""", [employee_names], as_dict=True)}

	# ============================================
	# 1. TENTATIVE ENTRIES (Leave type, no Leave Application)
	# ============================================
	# Get presence types that require leave applications
	leave_presence_types = frappe.db.sql("""
		SELECT name, label, icon FROM `tabPresence Type`
		WHERE requires_leave_application = 1
	""", as_dict=True)
	leave_pt_names = [pt.name for pt in leave_presence_types]
	leave_pt_info = {pt.name: pt for pt in leave_presence_types}

	tentative_entries = []
	if leave_pt_names:
		tentative_entries = frappe.db.sql("""
			SELECT employee, date, presence_type
			FROM `tabRoll Call Entry`
			WHERE employee IN %s
			AND date BETWEEN %s AND %s
			AND presence_type IN %s
			AND (leave_application IS NULL OR leave_application = '')
			AND is_locked = 0
			ORDER BY employee, date
		""", [employee_names, year_start, year_end, leave_pt_names], as_dict=True)

	# Group tentative entries by employee and find consecutive ranges
	tentative_by_employee = defaultdict(list)
	for entry in tentative_entries:
		tentative_by_employee[entry.employee].append(entry)

	tentative_summary = []
	total_tentative_days = 0

	for emp, entries in tentative_by_employee.items():
		if not entries:
			continue

		# Find consecutive date ranges
		date_ranges = []
		current_range = None

		for entry in sorted(entries, key=lambda x: x.date):
			entry_date = getdate(entry.date)
			pt = entry.presence_type

			if current_range is None:
				current_range = {
					"from_date": str(entry_date),
					"to_date": str(entry_date),
					"presence_type": pt,
					"label": leave_pt_info.get(pt, {}).get("label", pt),
					"icon": leave_pt_info.get(pt, {}).get("icon", ""),
					"days": 1
				}
			elif (
				getdate(current_range["to_date"]) == add_days(entry_date, -1)
				and current_range["presence_type"] == pt
			):
				# Consecutive day, same type - extend range
				current_range["to_date"] = str(entry_date)
				current_range["days"] += 1
			else:
				# Gap or different type - start new range
				date_ranges.append(current_range)
				current_range = {
					"from_date": str(entry_date),
					"to_date": str(entry_date),
					"presence_type": pt,
					"label": leave_pt_info.get(pt, {}).get("label", pt),
					"icon": leave_pt_info.get(pt, {}).get("icon", ""),
					"days": 1
				}

		if current_range:
			date_ranges.append(current_range)

		emp_info = employee_info.get(emp, {})
		emp_days = len(entries)
		total_tentative_days += emp_days

		tentative_summary.append({
			"employee": emp,
			"employee_name": emp_info.get("employee_name", emp),
			"days": emp_days,
			"date_ranges": date_ranges
		})

	# Sort by days descending
	tentative_summary.sort(key=lambda x: x["days"], reverse=True)

	# ============================================
	# 2. PENDING APPROVAL (Open Leave Applications)
	# ============================================
	pending_apps = frappe.db.sql("""
		SELECT
			la.name, la.employee, la.employee_name, la.leave_type,
			la.from_date, la.to_date, la.total_leave_days, la.status
		FROM `tabLeave Application` la
		WHERE la.employee IN %s
		AND la.status = 'Open'
		AND la.docstatus = 0
		AND la.to_date >= %s
		ORDER BY la.from_date
	""", [employee_names, year_start], as_dict=True)

	pending_summary = [{
		"name": app.name,
		"employee": app.employee,
		"employee_name": app.employee_name,
		"leave_type": app.leave_type,
		"from_date": str(app.from_date),
		"to_date": str(app.to_date),
		"days": app.total_leave_days
	} for app in pending_apps]

	# ============================================
	# 3. CONFLICTS (3+ people on same day)
	# ============================================
	# Count leave entries per day (both tentative and with leave apps)
	conflict_threshold = 3

	if leave_pt_names:
		daily_counts = frappe.db.sql("""
			SELECT date, COUNT(DISTINCT employee) as emp_count,
				   GROUP_CONCAT(DISTINCT employee) as employees
			FROM `tabRoll Call Entry`
			WHERE employee IN %s
			AND date BETWEEN %s AND %s
			AND presence_type IN %s
			GROUP BY date
			HAVING emp_count >= %s
			ORDER BY date
		""", [employee_names, year_start, year_end, leave_pt_names, conflict_threshold], as_dict=True)
	else:
		daily_counts = []

	conflicts = []
	for row in daily_counts:
		emp_list = row.employees.split(",") if row.employees else []
		conflict_employees = [
			{"employee": e, "employee_name": employee_info.get(e, {}).get("employee_name", e)}
			for e in emp_list
		]
		conflicts.append({
			"date": str(row.date),
			"count": row.emp_count,
			"employees": conflict_employees
		})

	return {
		"year": year,
		"tentative": {
			"total_days": total_tentative_days,
			"employee_count": len(tentative_summary),
			"by_employee": tentative_summary
		},
		"pending_approval": {
			"count": len(pending_summary),
			"applications": pending_summary
		},
		"conflicts": conflicts
	}


@frappe.whitelist()
def get_pending_review_count():
	"""Get count of leave applications awaiting current user's approval.

	This endpoint is used by Roll Call and Dashboard to show a badge
	indicating how many leave applications need the current user's review.

	Permission rules:
	- HR Manager/HR User: sees count of ALL pending leave applications
	- Leave Approver: sees count only for employees they can approve

	Returns:
		dict: {count: int, can_approve: bool}
	"""
	from flexitime.flexitime.permissions import get_employees_for_leave_approver

	user = frappe.session.user
	roles = frappe.get_roles(user)

	# HR sees all pending
	if "HR Manager" in roles or "HR User" in roles:
		count = frappe.db.count("Leave Application", {
			"status": "Open",
			"docstatus": 0
		})
		return {"count": count, "can_approve": True}

	# Leave Approver sees their assigned employees
	if "Leave Approver" in roles:
		employees = get_employees_for_leave_approver(user)
		if employees:
			count = frappe.db.count("Leave Application", {
				"employee": ["in", employees],
				"status": "Open",
				"docstatus": 0
			})
			return {"count": count, "can_approve": True}

	return {"count": 0, "can_approve": False}
