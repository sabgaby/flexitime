import frappe
from frappe import _
from frappe.utils import getdate, add_days


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


def ensure_holiday_entries_batch(employee_names: list, from_date: str, to_date: str):
	"""Batch auto-create Roll Call entries for holidays from HRMS Holiday List.

	This is the optimized batch version that creates holiday entries for ALL
	employees in a single operation instead of per-employee loops.

	Args:
		employee_names: List of Employee IDs
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	if not employee_names:
		return

	try:
		from hrms.hr.utils import get_holidays_for_employee
	except ImportError:
		return

	# Check if holiday presence type exists (1 query)
	holiday_pt = frappe.db.get_value("Presence Type", "holiday", ["icon", "label"], as_dict=True)
	if not holiday_pt:
		return

	# Get ALL existing entries for all employees in date range (1 query)
	existing_entries = set()
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

	# Collect all entries to create
	entries_to_create = []
	for emp_name in employee_names:
		try:
			holidays = get_holidays_for_employee(
				emp_name,
				from_date,
				to_date,
				raise_exception=False,
				only_non_weekly=False
			)
		except Exception:
			continue

		if not holidays:
			continue

		for holiday in holidays:
			holiday_date = holiday.get("holiday_date")
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
					"notes": holiday.get("description", ""),
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


def ensure_day_off_entries_batch(employee_names: list, from_date: str, to_date: str):
	"""Batch auto-create Roll Call entries for scheduled days off from Work Pattern.

	This is the optimized batch version that creates day-off entries for ALL
	employees in a single operation instead of per-employee, per-day loops.

	Args:
		employee_names: List of Employee IDs
		from_date: Start date in YYYY-MM-DD format
		to_date: End date in YYYY-MM-DD format
	"""
	if not employee_names:
		return

	from_date = getdate(from_date)
	to_date = getdate(to_date)

	# Check if day_off presence type exists (1 query)
	day_off_pt = frappe.db.get_value("Presence Type", "day_off", ["icon", "label"], as_dict=True)
	if not day_off_pt:
		return

	# Get ALL existing entries for all employees in date range (1 query)
	# Reuse the same query as holidays if possible
	existing_entries = set()
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
					"presence_type": "day_off",
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

	# Auto-populate system entries for all employees (BATCHED for performance)
	# Order matters: holidays first (take precedence), then day_off
	try:
		# Holidays from HRMS Holiday List (takes precedence over weekends)
		ensure_holiday_entries_batch(employee_names, month_start, month_end)
	except Exception:
		# Don't fail if holiday list not configured
		pass

	try:
		# Days off from Work Pattern
		ensure_day_off_entries_batch(employee_names, month_start, month_end)
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
		"pending_leaves": pending_leaves_by_employee,
		"current_employee": current_employee,
		"warnings": {
			"missing_work_patterns": employees_without_patterns
		} if employees_without_patterns else {}
	}


def calculate_leave_status_for_entry(entry_dict):
	"""Calculate and add leave_status fields to an entry dict.

	This replicates the logic from get_roll_call_entries() for single-entry updates.

	Args:
		entry_dict: Entry data as dict (from as_dict())

	Returns:
		dict: Entry with leave_status, am_leave_status, pm_leave_status added
	"""
	# Get presence types that require leave applications
	try:
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"requires_leave_application": 1},
			fields=["name"],
		)
	except Exception:
		leave_presence_types_list = frappe.get_all(
			"Presence Type",
			filters={"category": "Leave"},
			fields=["name"],
		)
	leave_presence_types = [pt.name for pt in leave_presence_types_list]

	# Get current employee for permission check
	current_employee = get_current_employee()

	# Get leave application status if linked
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
				if can_view_draft_status(current_employee, entry_dict["employee"]):
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
		["is_leave", "leave_type", "requires_leave_application"], as_dict=True)

	if not pt:
		return None

	leave_application = None

	# Check if this is a leave-type presence
	if pt.is_leave:
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

			# Recalculate expected hours
			daily.expected_hours = calculate_expected_hours(
				employee, date, roll_call_entry.presence_type, roll_call_entry.is_half_day
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
	"""
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
	"""
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

	# Execute bulk updates using SQL for better performance
	if to_update:
		for name, vals in to_update:
			frappe.db.set_value("Roll Call Entry", name, vals, update_modified=False)

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

		for entry in fetched_entries:
			entry_dict = dict(entry)
			entry_dict = calculate_leave_status_for_entry(entry_dict)
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

	# Execute bulk updates
	if to_update:
		for name, vals in to_update:
			frappe.db.set_value("Roll Call Entry", name, vals, update_modified=True)

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

		for entry in fetched_entries:
			entry_dict = dict(entry)
			entry_dict = calculate_leave_status_for_entry(entry_dict)

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

	for entry in existing_entries:
		if entry.is_locked:
			continue  # Skip locked entries

		frappe.delete_doc("Roll Call Entry", entry.name, ignore_permissions=True, force=True)
		deleted_count += 1
		deleted_keys.append({"employee": entry.employee, "date": str(entry.date)})

	frappe.db.commit()

	return {"deleted": deleted_count, "total": len(entries), "entries": deleted_keys}


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
