"use server";

import { revalidatePath } from "next/cache";
import { hashPassword, requireIdentity } from "@/lib/waybook/auth";
import { controlDb, tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { defaultStaffCalendarColor, staffCalendarColorValues } from "@/lib/waybook/staff-calendar-colors";
import { staffLifecycleAvailable } from "@/lib/waybook/staff-lifecycle";
import { canManageTimeOff, staffPermissionContext, staffWorkspacePermissionsAvailable } from "@/lib/waybook/staff-permissions";

async function editableStaffTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage staff.");
  await requireFeature(tenant.id, "team");
  return tenant;
}

async function ownerStaffTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") throw new Error("Only an owner can manage staff access.");
  await requireFeature(tenant.id, "team");
  return tenant;
}

async function validStaffMember(tenant: TenantRecord, memberId: string) {
  const db = tenantDb(tenant);
  const [member] = await db<{ id: string }[]>`SELECT id FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (!member) throw new Error("Staff member is unavailable.");
  return db;
}

async function editableStaffTimeOffTenant(memberId: string) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "team");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!canManageTimeOff(permissions, memberId)) {
    throw new Error("You do not have permission to manage this staff member's time off.");
  }
  return tenant;
}

const optionalText = (formData: FormData, field: string, limit = 500) => {
  const value = String(formData.get(field) ?? "").trim();
  if (value.length > limit) throw new Error(`${field} is too long.`);
  return value || null;
};

function revalidateStaff() {
  revalidatePath("/app");
  revalidatePath("/app/team");
  revalidatePath("/app/services");
  revalidatePath("/app/calendars");
  revalidatePath("/book");
}

function localDatesInRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function saveTeamMember(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage staff.");
  await requireFeature(tenant.id, "team");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff");
  const memberId = String(formData.get("memberId") ?? "");
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  const isActive = String(formData.get("isActive") ?? "") === "on";
  const phone = optionalText(formData, "phone", 80);
  const jobTitle = optionalText(formData, "jobTitle", 120);
  const specialty = optionalText(formData, "specialty", 160);
  const workLocation = optionalText(formData, "workLocation", 160);
  const staffCode = optionalText(formData, "staffCode", 80);
  const internalNotes = optionalText(formData, "internalNotes", 2_000);
  const calendarColor = String(formData.get("calendarColor") ?? defaultStaffCalendarColor).trim();
  const assignmentsOnly = Boolean(memberId) && !name && !email;
  if (!assignmentsOnly && (!name || name.length > 160 || !email.includes("@") || !["manager", "staff", "read-only"].includes(role))) throw new Error("Enter a name, valid email, and role.");
  if (!assignmentsOnly && memberId) {
    const [existing] = await tenantDb(tenant)<{ role: string }[]>`SELECT role FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
    if (existing?.role === "owner") throw new Error("The workspace owner profile cannot be changed here.");
    if (membership.role !== "owner" && (role === "manager" || existing?.role === "manager")) {
      throw new Error("Only an owner can create or change a manager profile.");
    }
  } else if (!assignmentsOnly && membership.role !== "owner" && role === "manager") {
    throw new Error("Only an owner can create or change a manager profile.");
  }
  if (!assignmentsOnly && !staffCalendarColorValues.has(calendarColor)) throw new Error("Choose one of the available calendar colours.");
  const db = tenantDb(tenant);
  const validServices = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id = ${tenant.id} AND id = ANY(${serviceIds})`;
  if (validServices.length !== serviceIds.length) throw new Error("A selected service is unavailable.");
  const validLocations = await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenant.id} AND id = ANY(${locationIds}) AND is_active = TRUE`;
  if (validLocations.length !== locationIds.length) throw new Error("A selected location is unavailable.");
  const [member] = assignmentsOnly
    ? await db<{ id: string }[]>`SELECT id FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`
    : memberId
    ? await db<{ id: string }[]>`UPDATE team_members SET name = ${name}, email = ${email}, role = ${role}, is_active = ${isActive}, phone = ${phone}, job_title = ${jobTitle}, specialty = ${specialty}, work_location = ${workLocation}, staff_code = ${staffCode}, internal_notes = ${internalNotes}, calendar_color = ${calendarColor}, updated_at = now() WHERE id = ${memberId} AND tenant_id = ${tenant.id} RETURNING id`
    : await db<{ id: string }[]>`INSERT INTO team_members (tenant_id, role, name, email, is_active, phone, job_title, specialty, work_location, staff_code, internal_notes, calendar_color) VALUES (${tenant.id}, ${role}, ${name}, ${email}, ${isActive}, ${phone}, ${jobTitle}, ${specialty}, ${workLocation}, ${staffCode}, ${internalNotes}, ${calendarColor}) ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_active = EXCLUDED.is_active, phone = EXCLUDED.phone, job_title = EXCLUDED.job_title, specialty = EXCLUDED.specialty, work_location = EXCLUDED.work_location, staff_code = EXCLUDED.staff_code, internal_notes = EXCLUDED.internal_notes, calendar_color = EXCLUDED.calendar_color, updated_at = now() RETURNING id`;
  if (!member) throw new Error("Staff member is unavailable.");
  // A staff profile may predate its login. Once linked, the Control-plane role
  // is the authorization source of truth and must follow profile role changes.
  if (!assignmentsOnly) {
    const [linked] = await db<{ identityId: string | null }[]>`SELECT identity_id AS "identityId" FROM team_members WHERE id = ${member.id} AND tenant_id = ${tenant.id}`;
    if (linked?.identityId) await controlDb`
      INSERT INTO tenant_memberships (tenant_id, identity_id, role)
      VALUES (${tenant.id}, ${linked.identityId}, ${role})
      ON CONFLICT (tenant_id, identity_id) DO UPDATE SET role = EXCLUDED.role
    `;
  }
  await db`DELETE FROM service_team_members WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id}`;
  for (const service of validServices) await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenant.id}, ${service.id}, ${member.id})`;
  await db`DELETE FROM team_member_locations WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id}`;
  for (const location of validLocations) await db`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenant.id}, ${member.id}, ${location.id})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${memberId ? "staff.updated" : "staff.created"}, 'team_member', ${member.id}, ${JSON.stringify({ fields: ["name", "email", "role", "isActive", "phone", "jobTitle", "specialty", "workLocation", "staffCode", "internalNotes", "calendarColor", "serviceIds", "locationIds"] })}::jsonb)`;
  revalidateStaff();
}

export async function provisionStaffLogin(formData: FormData) {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  const memberId = String(formData.get("memberId") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  if (password.length < 12) throw new Error("Choose a temporary password with at least 12 characters.");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  const db = await validStaffMember(tenant, memberId);
  const [member] = await db<{ id: string; email: string; name: string; role: "manager" | "staff" | "read-only"; identityId: string | null }[]>`
    SELECT id, email, name, role, identity_id AS "identityId" FROM team_members
    WHERE id = ${memberId} AND tenant_id = ${tenant.id}
  `;
  if (!member) throw new Error("Staff member is unavailable.");
  if (member.identityId) throw new Error("This staff member already has a login. Use Change password instead.");
  const [existingIdentity] = await controlDb<{ id: string }[]>`SELECT id FROM identities WHERE email = ${member.email} LIMIT 1`;
  if (existingIdentity) throw new Error("An identity already uses this email. Use a unique staff email before creating a new login.");
  const [identity] = await controlDb<{ id: string }[]>`
    INSERT INTO identities (email, password_hash, display_name)
    VALUES (${member.email}, ${hashPassword(password)}, ${member.name})
    RETURNING id
  `;
  if (!identity) throw new Error("Staff login could not be created.");
  await controlDb`
    INSERT INTO tenant_memberships (tenant_id, identity_id, role)
    VALUES (${tenant.id}, ${identity.id}, ${member.role})
    ON CONFLICT (tenant_id, identity_id) DO UPDATE SET role = EXCLUDED.role
  `;
  await db`UPDATE team_members SET identity_id = ${identity.id}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenant.id}`;
  await db`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${actor.id}, 'staff.login.provisioned', 'team_member', ${member.id}, ${JSON.stringify({ identityId: identity.id })}::jsonb)`;
  await controlDb`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id) VALUES (${actor.id}, ${tenant.id}, 'staff.login.provisioned', 'team_member', ${member.id})`;
  revalidateStaff();
}

export async function resetStaffPassword(formData: FormData) {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  const memberId = String(formData.get("memberId") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  if (password.length < 12) throw new Error("Choose a temporary password with at least 12 characters.");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  const db = await validStaffMember(tenant, memberId);
  const [member] = await db<{ id: string; identityId: string | null }[]>`SELECT id, identity_id AS "identityId" FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (!member?.identityId) throw new Error("Create a staff login before changing its password.");
  await controlDb`UPDATE identities SET password_hash = ${hashPassword(password)}, updated_at = now() WHERE id = ${member.identityId}`;
  // A reset invalidates any prior login immediately.
  await controlDb`UPDATE sessions SET revoked_at = now() WHERE identity_id = ${member.identityId} AND revoked_at IS NULL`;
  await db`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id) VALUES (${tenant.id}, ${actor.id}, 'staff.login.password_reset', 'team_member', ${member.id})`;
  await controlDb`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id) VALUES (${actor.id}, ${tenant.id}, 'staff.login.password_reset', 'team_member', ${member.id})`;
  revalidateStaff();
}

export async function setStaffLifecycle(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "team");
  const actor = await requireIdentity();
  const memberId = String(formData.get("memberId") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!["deactivate", "reactivate", "archive", "restore"].includes(action)) throw new Error("Choose a valid staff action.");
  if (["archive", "restore"].includes(action) && membership.role !== "owner") throw new Error("Only an owner can archive or restore staff.");
  if (!["archive", "restore"].includes(action) && !["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage staff.");
  const db = await validStaffMember(tenant, memberId);
  const [member] = await db<{ id: string; identityId: string | null; role: string }[]>`SELECT id, identity_id AS "identityId", role FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (!member) throw new Error("Staff member is unavailable.");
  if (member.identityId === actor.id) throw new Error("Use another owner to change your own staff access.");
  if (member.role === "owner") throw new Error("Owner access cannot be changed from the staff directory.");
  if (membership.role !== "owner" && member.role === "manager") {
    throw new Error("Only an owner can change a manager's access.");
  }
  const lifecycleAvailable = await staffLifecycleAvailable(tenant);
  if (["archive", "restore"].includes(action) && !lifecycleAvailable) throw new Error("Archive is available after the staff lifecycle migration is applied.");
  const isActive = ["reactivate", "restore"].includes(action);
  if (lifecycleAvailable) {
    const archivedAt = action === "archive" ? new Date().toISOString() : action === "restore" ? null : undefined;
    if (archivedAt !== undefined) await db`UPDATE team_members SET is_active = ${isActive}, archived_at = ${archivedAt}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenant.id}`;
    else await db`UPDATE team_members SET is_active = ${isActive}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenant.id}`;
  } else {
    await db`UPDATE team_members SET is_active = ${isActive}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenant.id}`;
  }
  await db`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${actor.id}, ${`staff.${action}`}, 'team_member', ${member.id}, ${JSON.stringify({ isActive })}::jsonb)`;
  await controlDb`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id) VALUES (${actor.id}, ${tenant.id}, ${`staff.${action}`}, 'team_member', ${member.id})`;
  revalidateStaff();
}

/** Manager-only staff capability policy. Defaults are deny-by-default;
 * owner and manager tenant memberships retain their existing authority. */
export async function saveStaffPermissions(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!['owner', 'manager'].includes(membership.role)) throw new Error('You do not have permission to manage staff.');
  await requireFeature(tenant.id, 'team');
  const memberId = String(formData.get("memberId") ?? "");
  const db = await validStaffMember(tenant, memberId);
  const [member] = await db<{ role: string }[]>`SELECT role FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (member?.role === 'owner') throw new Error('Owner permissions cannot be changed from the staff directory.');
  if (membership.role !== 'owner' && member?.role === 'manager') throw new Error("Only an owner can change a manager's permissions.");
  const workspacePermissionsAvailable = await staffWorkspacePermissionsAvailable(tenant);
  const permissions = {
    canUpdateAppointmentStatus: String(formData.get("canUpdateAppointmentStatus") ?? "") === "on",
    canManageOwnAppointments: String(formData.get("canManageOwnAppointments") ?? "") === "on",
    canViewTeamCalendar: String(formData.get("canViewTeamCalendar") ?? "") === "on",
    canManageTeamAppointments: String(formData.get("canManageTeamAppointments") ?? "") === "on",
    canManageOwnTimeOff: String(formData.get("canManageOwnTimeOff") ?? "") === "on",
    canManageTeamTimeOff: String(formData.get("canManageTeamTimeOff") ?? "") === "on",
    canManageWaitlist: String(formData.get("canManageWaitlist") ?? "") === "on",
    canViewClients: String(formData.get("canViewClients") ?? "") === "on",
    canManageClients: String(formData.get("canManageClients") ?? "") === "on",
    canAccessReports: String(formData.get("canAccessReports") ?? "") === "on",
    canManageResources: String(formData.get("canManageResources") ?? "") === "on",
    canManageServiceSettings: String(formData.get("canManageServiceSettings") ?? "") === "on",
  };
  const baseArgs = [tenant.id, memberId, permissions.canUpdateAppointmentStatus, permissions.canManageOwnAppointments, permissions.canViewTeamCalendar, permissions.canManageTeamAppointments, permissions.canManageOwnTimeOff, permissions.canManageTeamTimeOff, permissions.canManageWaitlist];
  await db.unsafe(
    workspacePermissionsAvailable ?
    "INSERT INTO staff_permissions (tenant_id, team_member_id, can_update_appointment_status, can_manage_own_appointments, can_view_team_calendar, can_manage_team_appointments, can_manage_own_time_off, can_manage_team_time_off, can_manage_waitlist, can_view_clients, can_manage_clients, can_access_reports, can_manage_resources, can_manage_service_settings, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()) ON CONFLICT (tenant_id, team_member_id) DO UPDATE SET can_update_appointment_status=EXCLUDED.can_update_appointment_status, can_manage_own_appointments=EXCLUDED.can_manage_own_appointments, can_view_team_calendar=EXCLUDED.can_view_team_calendar, can_manage_team_appointments=EXCLUDED.can_manage_team_appointments, can_manage_own_time_off=EXCLUDED.can_manage_own_time_off, can_manage_team_time_off=EXCLUDED.can_manage_team_time_off, can_manage_waitlist=EXCLUDED.can_manage_waitlist, can_view_clients=EXCLUDED.can_view_clients, can_manage_clients=EXCLUDED.can_manage_clients, can_access_reports=EXCLUDED.can_access_reports, can_manage_resources=EXCLUDED.can_manage_resources, can_manage_service_settings=EXCLUDED.can_manage_service_settings, updated_at=now()"
    : "INSERT INTO staff_permissions (tenant_id, team_member_id, can_update_appointment_status, can_manage_own_appointments, can_view_team_calendar, can_manage_team_appointments, can_manage_own_time_off, can_manage_team_time_off, can_manage_waitlist, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT (tenant_id, team_member_id) DO UPDATE SET can_update_appointment_status=EXCLUDED.can_update_appointment_status, can_manage_own_appointments=EXCLUDED.can_manage_own_appointments, can_view_team_calendar=EXCLUDED.can_view_team_calendar, can_manage_team_appointments=EXCLUDED.can_manage_team_appointments, can_manage_own_time_off=EXCLUDED.can_manage_own_time_off, can_manage_team_time_off=EXCLUDED.can_manage_team_time_off, can_manage_waitlist=EXCLUDED.can_manage_waitlist, updated_at=now()",
    workspacePermissionsAvailable ? [...baseArgs, permissions.canViewClients, permissions.canManageClients, permissions.canAccessReports, permissions.canManageResources, permissions.canManageServiceSettings] : baseArgs,
  );
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'staff.permissions.updated', 'team_member', ${memberId}, ${JSON.stringify(permissions)}::jsonb)`;
  revalidateStaff();
}

export async function saveStaffWorkingHours(formData: FormData) {
  const tenant = await editableStaffTenant();
  const memberId = String(formData.get("memberId") ?? "");
  const serializedSchedule = String(formData.get("schedule") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const days = formData.getAll("days").map(String).filter((day) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(day));
  type ScheduleEntry = { day: string; startTime: string; endTime: string };
  let schedule: ScheduleEntry[];
  try {
    const parsed = serializedSchedule ? JSON.parse(serializedSchedule) : days.map((day) => ({ day, startTime, endTime }));
    if (!Array.isArray(parsed)) throw new Error();
    schedule = parsed.filter((entry): entry is ScheduleEntry => Boolean(entry) && typeof entry.day === "string" && typeof entry.startTime === "string" && typeof entry.endTime === "string");
  } catch {
    throw new Error("Working hours could not be read. Please try again.");
  }
  const validDays = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  if (!memberId || schedule.length === 0 || schedule.length > 28 || schedule.some((entry) => !validDays.has(entry.day) || !/^\d\d:\d\d$/.test(entry.startTime) || !/^\d\d:\d\d$/.test(entry.endTime) || entry.startTime >= entry.endTime)) throw new Error("Choose at least one day and valid shift times.");
  const shiftsByDay = new Map<string, ScheduleEntry[]>();
  for (const entry of schedule) shiftsByDay.set(entry.day, [...(shiftsByDay.get(entry.day) ?? []), entry]);
  for (const [day, shifts] of shiftsByDay) {
    const ordered = [...shifts].sort((left, right) => left.startTime.localeCompare(right.startTime));
    if (ordered.some((shift, index) => index > 0 && shift.startTime < ordered[index - 1].endTime)) {
      throw new Error(`Working shifts on ${day} cannot overlap.`);
    }
  }
  const db = await validStaffMember(tenant, memberId);
  await db`DELETE FROM availability_rules WHERE tenant_id = ${tenant.id} AND team_member_id = ${memberId}`;
  for (const entry of schedule) await db`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone) VALUES (${tenant.id}, ${memberId}, ${`FREQ=WEEKLY;BYDAY=${entry.day}`}, ${entry.startTime}, ${entry.endTime}, ${tenant.timezone})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${"staff.availability.updated"}, 'team_member', ${memberId}, ${JSON.stringify({ schedule })}::jsonb)`;
  revalidateStaff();
}

export async function addStaffTimeOff(formData: FormData) {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const localDate = String(formData.get("localDate") ?? "");
  const endLocalDate = String(formData.get("endLocalDate") ?? localDate);
  const fullDay = String(formData.get("fullDay") ?? "false") === "true";
  const isUnavailable = true;
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  const reason = optionalText(formData, "reason", 500);
  const hasPartialWindow = Boolean(startTime) && Boolean(endTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endLocalDate) || endLocalDate < localDate || (!fullDay && (!hasPartialWindow || startTime! >= endTime!)) || (fullDay && (startTime || endTime))) throw new Error("Choose a valid date or date range, then either block the full day or enter a complete valid time range.");
  const dates = localDatesInRange(localDate, endLocalDate);
  if (dates.length > 31) throw new Error("Time off can cover up to 31 days at a time.");
  const db = await validStaffMember(tenant, memberId);
  const existing = await db<{ localDate: string }[]>`SELECT local_date::text AS "localDate" FROM availability_overrides WHERE tenant_id = ${tenant.id} AND team_member_id = ${memberId} AND local_date >= ${localDate} AND local_date <= ${endLocalDate}`;
  if (existing.length > 0) throw new Error("One or more selected dates already have a time-off exception. Choose dates without an existing exception.");
  for (const date of dates) await db`INSERT INTO availability_overrides (tenant_id, team_member_id, local_date, start_time, end_time, is_unavailable, reason) VALUES (${tenant.id}, ${memberId}, ${date}, ${startTime}, ${endTime}, ${isUnavailable}, ${reason})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${"staff.availability.exception_added"}, 'team_member', ${memberId}, ${JSON.stringify({ localDate, endLocalDate, dateCount: dates.length, fullDay, isUnavailable, startTime, endTime, reason })}::jsonb)`;
  revalidateStaff();
}

export async function updateStaffTimeOff(formData: FormData) {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const overrideId = String(formData.get("overrideId") ?? "");
  const localDate = String(formData.get("localDate") ?? "");
  const endLocalDate = String(formData.get("endLocalDate") ?? localDate);
  const fullDay = String(formData.get("fullDay") ?? "false") === "true";
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  const reason = optionalText(formData, "reason", 500);
  const hasPartialWindow = Boolean(startTime) && Boolean(endTime);
  if (!overrideId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || endLocalDate !== localDate || (!fullDay && (!hasPartialWindow || startTime! >= endTime!)) || (fullDay && (startTime || endTime))) throw new Error("Choose one valid date and a complete valid time range when needed.");
  const db = await validStaffMember(tenant, memberId);
  const [override] = await db<{ id: string }[]>`SELECT id FROM availability_overrides WHERE id = ${overrideId} AND tenant_id = ${tenant.id} AND team_member_id = ${memberId}`;
  if (!override) throw new Error("That time-off entry is unavailable.");
  const conflicts = await db<{ id: string }[]>`SELECT id FROM availability_overrides WHERE tenant_id = ${tenant.id} AND team_member_id = ${memberId} AND local_date = ${localDate} AND id <> ${overrideId}`;
  if (conflicts.length) throw new Error("Another time-off entry already exists on that date.");
  await db`UPDATE availability_overrides SET local_date = ${localDate}, start_time = ${startTime}, end_time = ${endTime}, is_unavailable = TRUE, reason = ${reason} WHERE id = ${overrideId} AND tenant_id = ${tenant.id} AND team_member_id = ${memberId}`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${"staff.availability.exception_updated"}, 'team_member', ${memberId}, ${JSON.stringify({ overrideId, localDate, fullDay, startTime, endTime, reason })}::jsonb)`;
  revalidateStaff();
}

export async function deleteStaffTimeOff(formData: FormData) {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const overrideId = String(formData.get("overrideId") ?? "");
  if (!overrideId) throw new Error("Choose a time-off entry to remove.");
  const db = await validStaffMember(tenant, memberId);
  const [removed] = await db<{ id: string; localDate: string }[]>`DELETE FROM availability_overrides WHERE id = ${overrideId} AND tenant_id = ${tenant.id} AND team_member_id = ${memberId} RETURNING id, local_date::text AS "localDate"`;
  if (!removed) throw new Error("That time-off entry is unavailable.");
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${"staff.availability.exception_removed"}, 'team_member', ${memberId}, ${JSON.stringify({ overrideId, localDate: removed.localDate })}::jsonb)`;
  revalidateStaff();
}
