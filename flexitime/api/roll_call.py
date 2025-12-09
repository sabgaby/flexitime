import frappe
from frappe import _


def get_current_employee():
	"""Get the Employee record for the current user."""
	user = frappe.session.user
	if user == "Guest":
		return None
	return frappe.db.get_value("Employee", {"user_id": user}, "name")


def is_hr_department_member():
	"""Check if current user has HR Manager role."""
	return "HR Manager" in frappe.get_roles()


def is_line_manager_of(employee: str) -> bool:
	"""Check if current user is the line manager (reports_to) of an employee."""
	current_emp = get_current_employee()
	if not current_emp:
		return False
	reports_to = frappe.db.get_value("Employee", employee, "reports_to")
	return reports_to == current_emp


def can_view_draft_status(viewer_employee: str | None, entry_employee: str) -> bool:
	"""Determine if viewer can see draft leave application status for an entry.

	Draft status is visible to:
	- The employee themselves
	- Their line manager (reports_to)
	- HR department members

	Everyone else sees draft as tentative (no stripes distinction).
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
def get_default_company():
	"""Get user's default company."""
	return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)


def check_missing_work_patterns(employee_names: list, reference_date: str) -> list:
	"""Check which employees are missing work patterns for a given date.

	Args:
		employee_names: List of employee IDs to check
		reference_date: Date to check patterns for (YYYY-MM-DD)

	Returns:
		list: List of dicts with employee info for those missing patterns
	"""
	from frappe.utils import getdate
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	reference_date = getdate(reference_date)
	missing = []

	for emp_name in employee_names:
		pattern = get_work_pattern(emp_name, reference_date)
		if not pattern:
			# Get employee name for display
			emp_full_name = frappe.db.get_value("Employee", emp_name, "employee_name")
			missing.append({
				"employee": emp_name,
				"employee_name": emp_full_name or emp_name
			})

	return missing


def ensure_holiday_entries(employee: str, from_date: str, to_date: str):
	"""Auto-create Roll Call entries for holidays from HRMS Holiday List.

	This lazily creates holiday entries when viewing Roll Call, ensuring
	employees see company holidays pre-populated. Holidays take precedence
	over weekends (if Christmas is on Saturday, show holiday not weekend).

	Args:
		employee: Employee ID
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	try:
		from hrms.hr.utils import get_holidays_for_employee
	except ImportError:
		# HRMS not installed or function not available
		return

	# Check if holiday presence type exists
	if not frappe.db.exists("Presence Type", "holiday"):
		return

	# Get holiday presence type info
	holiday_pt = frappe.db.get_value("Presence Type", "holiday", ["icon", "label"], as_dict=True)
	if not holiday_pt:
		return

	# Get holidays for employee (includes holidays on weekends)
	try:
		holidays = get_holidays_for_employee(
			employee,
			from_date,
			to_date,
			raise_exception=False,
			only_non_weekly=False  # Include ALL holidays, even on weekends
		)
	except Exception:
		# If holiday list not configured for employee, skip
		return

	if not holidays:
		return

	entries_to_create = []
	for holiday in holidays:
		holiday_date = holiday.get("holiday_date")
		description = holiday.get("description", "")

		# Check if entry already exists for this date
		existing = frappe.db.exists("Roll Call Entry", {
			"employee": employee,
			"date": holiday_date
		})

		if not existing:
			entries_to_create.append({
				"doctype": "Roll Call Entry",
				"employee": employee,
				"date": holiday_date,
				"presence_type": "holiday",
				"presence_type_icon": holiday_pt.icon,
				"presence_type_label": holiday_pt.label,
				"source": "System",
				"is_half_day": 0,
				"notes": description,  # Store holiday name like "Christmas Day"
			})

	# Bulk insert new entries
	for entry_dict in entries_to_create:
		doc = frappe.get_doc(entry_dict)
		doc.flags.ignore_permissions = True
		doc.insert()

	if entries_to_create:
		frappe.db.commit()


def ensure_day_off_entries(employee: str, from_date: str, to_date: str):
	"""Auto-create Roll Call entries for scheduled days off from Work Pattern.

	This lazily creates day_off entries when viewing Roll Call, ensuring
	employees see their scheduled days off pre-populated.

	Args:
		employee: Employee ID
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	from frappe.utils import getdate, add_days
	from flexitime.flexitime.doctype.employee_work_pattern.employee_work_pattern import get_work_pattern

	from_date = getdate(from_date)
	to_date = getdate(to_date)

	# Check if day_off presence type exists
	if not frappe.db.exists("Presence Type", "day_off"):
		return

	# Get day_off presence type info
	day_off_pt = frappe.db.get_value("Presence Type", "day_off", ["icon", "label"], as_dict=True)
	if not day_off_pt:
		return

	# Get employee's work pattern
	# Note: Work pattern could change during the date range, but we'll use the
	# pattern valid at each specific date
	current_date = from_date
	entries_to_create = []

	while current_date <= to_date:
		pattern = get_work_pattern(employee, current_date)

		if pattern and pattern.is_day_off(current_date):
			# Check if entry already exists for this date
			existing = frappe.db.exists("Roll Call Entry", {
				"employee": employee,
				"date": current_date
			})

			if not existing:
				entries_to_create.append({
					"doctype": "Roll Call Entry",
					"employee": employee,
					"date": current_date,
					"presence_type": "day_off",
					"presence_type_icon": day_off_pt.icon,
					"presence_type_label": day_off_pt.label,
					"source": "System",
					"is_half_day": 0,
				})

		current_date = add_days(current_date, 1)

	# Bulk insert new entries
	for entry_dict in entries_to_create:
		doc = frappe.get_doc(entry_dict)
		doc.flags.ignore_permissions = True
		doc.insert()

	if entries_to_create:
		frappe.db.commit()


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

	# Build employee filters
	emp_filters = {"status": "Active"}
	if employee_filters:
		if employee_filters.get("company"):
			emp_filters["company"] = employee_filters["company"]
		if employee_filters.get("department"):
			emp_filters["department"] = employee_filters["department"]
		if employee_filters.get("branch"):
			emp_filters["branch"] = employee_filters["branch"]

	# Get employees
	employees = frappe.get_all(
		"Employee",
		filters=emp_filters,
		fields=["name"],
		limit_page_length=0,
	)

	employee_names = [e.name for e in employees]
	if not employee_names:
		return {"entries": {}, "current_employee": current_employee}

	# Auto-populate system entries for all employees
	# Order matters: holidays first (take precedence), then day_off
	for emp_name in employee_names:
		try:
			# Holidays from HRMS Holiday List (takes precedence over weekends)
			ensure_holiday_entries(emp_name, month_start, month_end)
		except Exception:
			# Don't fail if holiday list not configured
			pass

		try:
			# Days off from Work Pattern
			ensure_day_off_entries(emp_name, month_start, month_end)
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
		# Fallback to category-based detection if field doesn't exist (migration not run)
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"category": "Leave"},
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
				if can_view_draft_status(current_employee, entry_employee):
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

	# Check for employees without work patterns (for warning display)
	employees_without_patterns = check_missing_work_patterns(employee_names, month_start)

	return {
		"entries": result,
		"current_employee": current_employee,
		"warnings": {
			"missing_work_patterns": employees_without_patterns
		} if employees_without_patterns else {}
	}


@frappe.whitelist()
def save_entry(employee: str, date: str, presence_type: str, is_half_day: bool = False):
	"""Save or update a Roll Call entry (full day).

	Args:
	    employee: Employee ID
	    date: Date in YYYY-MM-DD format
	    presence_type: Presence Type name
	    is_half_day: Whether it's a half day (legacy, use save_split_entry for AM/PM)

	Returns:
	    dict: The saved entry
	"""
	if isinstance(is_half_day, str):
		is_half_day = is_half_day.lower() in ("true", "1", "yes")

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
		})
		entry.insert()

	frappe.db.commit()
	return entry.as_dict()


@frappe.whitelist()
def save_split_entry(employee: str, date: str, am_presence_type: str, pm_presence_type: str):
	"""Save or update a Roll Call entry with split AM/PM presence types.

	Args:
	    employee: Employee ID
	    date: Date in YYYY-MM-DD format
	    am_presence_type: Morning presence type
	    pm_presence_type: Afternoon presence type

	Returns:
	    dict: The saved entry
	"""
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
		})
		entry.insert()

	frappe.db.commit()
	return entry.as_dict()


@frappe.whitelist()
def save_bulk_entries(entries: list | str, presence_type: str, day_part: str = "full"):
	"""Save multiple Roll Call entries at once using bulk operations.

	Args:
	    entries: List of {employee, date} dicts
	    presence_type: Presence Type to apply
	    day_part: "full", "am", or "pm"

	Returns:
	    dict: Count of saved entries
	"""
	import json
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		return {"saved": 0, "total": 0}

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

	# Execute bulk updates
	for name, vals in to_update:
		frappe.db.set_value("Roll Call Entry", name, vals, update_modified=False)

	# Execute bulk inserts
	for entry_dict in to_insert:
		doc = frappe.get_doc(entry_dict)
		doc.flags.ignore_permissions = True
		doc.insert()

	frappe.db.commit()
	return {"saved": saved_count, "total": len(entries)}


@frappe.whitelist()
def save_bulk_split_entries(entries: list | str, am_presence_type: str, pm_presence_type: str):
	"""Save multiple Roll Call entries as split AM/PM entries.

	Args:
	    entries: List of {employee, date} dicts
	    am_presence_type: Morning presence type
	    pm_presence_type: Afternoon presence type

	Returns:
	    dict: Count of saved entries
	"""
	import json
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		return {"saved": 0, "total": 0}

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

	saved_count = 0

	for employee, date in keys:
		existing = existing_map.get((employee, date))

		if existing:
			if existing.is_locked:
				continue  # Skip locked entries

			frappe.db.set_value("Roll Call Entry", existing.name, {
				"is_half_day": 1,
				"presence_type": am_presence_type,
				"am_presence_type": am_presence_type,
				"pm_presence_type": pm_presence_type,
				"am_presence_icon": am_icon,
				"pm_presence_icon": pm_icon,
				"source": "Manual",
			}, update_modified=True)
			saved_count += 1
		else:
			doc = frappe.get_doc({
				"doctype": "Roll Call Entry",
				"employee": employee,
				"date": date,
				"presence_type": am_presence_type,
				"is_half_day": 1,
				"am_presence_type": am_presence_type,
				"pm_presence_type": pm_presence_type,
				"am_presence_icon": am_icon,
				"pm_presence_icon": pm_icon,
				"source": "Manual",
			})
			doc.flags.ignore_permissions = True
			doc.insert()
			saved_count += 1

	frappe.db.commit()
	return {"saved": saved_count, "total": len(entries)}
