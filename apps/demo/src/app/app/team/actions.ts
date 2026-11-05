"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";

async function editableStaffTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage staff.");
  await requireFeature(tenant.id, "team");
  return tenant;
}

async function validStaffMember(tenant: TenantRecord, memberId: string) {
  const db = tenantDb(tenant);
  const [member] = await db<{ id: string }[]>`SELECT id FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (!member) throw new Error("Staff member is unavailable.");
  return db;
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

export async function saveTeamMember(formData: FormData) {
  const tenant = await editableStaffTenant();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff");
  const memberId = String(formData.get("memberId") ?? "");
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  const isActive = String(formData.get("isActive") ?? "") === "on";
  const phone = optionalText(formData, "phone", 80);
  const jobTitle = optionalText(formData, "jobTitle", 120);
  const specialty = optionalText(formData, "specialty", 160);
  const workLocation = optionalText(formData, "workLocation", 160);
  const staffCode = optionalText(formData, "staffCode", 80);
  const internalNotes = optionalText(formData, "internalNotes", 2_000);
  if (!name || name.length > 160 || !email.includes("@") || !["manager", "staff", "read-only"].includes(role)) throw new Error("Enter a name, valid email, and role.");
  const db = tenantDb(tenant);
  const validServices = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id = ${tenant.id} AND id = ANY(${serviceIds})`;
  if (validServices.length !== serviceIds.length) throw new Error("A selected service is unavailable.");
  const [member] = memberId
    ? await db<{ id: string }[]>`UPDATE team_members SET name = ${name}, email = ${email}, role = ${role}, is_active = ${isActive}, phone = ${phone}, job_title = ${jobTitle}, specialty = ${specialty}, work_location = ${workLocation}, staff_code = ${staffCode}, internal_notes = ${internalNotes}, updated_at = now() WHERE id = ${memberId} AND tenant_id = ${tenant.id} RETURNING id`
    : await db<{ id: string }[]>`INSERT INTO team_members (tenant_id, role, name, email, is_active, phone, job_title, specialty, work_location, staff_code, internal_notes) VALUES (${tenant.id}, ${role}, ${name}, ${email}, ${isActive}, ${phone}, ${jobTitle}, ${specialty}, ${workLocation}, ${staffCode}, ${internalNotes}) ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_active = EXCLUDED.is_active, phone = EXCLUDED.phone, job_title = EXCLUDED.job_title, specialty = EXCLUDED.specialty, work_location = EXCLUDED.work_location, staff_code = EXCLUDED.staff_code, internal_notes = EXCLUDED.internal_notes, updated_at = now() RETURNING id`;
  if (!member) throw new Error("Staff member is unavailable.");
  await db`DELETE FROM service_team_members WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id}`;
  for (const service of validServices) await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenant.id}, ${service.id}, ${member.id})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${memberId ? "staff.updated" : "staff.created"}, "team_member", ${member.id}, ${JSON.stringify({ fields: ["name", "email", "role", "isActive", "phone", "jobTitle", "specialty", "workLocation", "staffCode", "internalNotes", "serviceIds"] })}::jsonb)`;
  revalidateStaff();
}

export async function saveStaffWorkingHours(formData: FormData) {
  const tenant = await editableStaffTenant();
  const memberId = String(formData.get("memberId") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const days = formData.getAll("days").map(String).filter((day) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(day));
  if (!memberId || !/^\d\d:\d\d$/.test(startTime) || !/^\d\d:\d\d$/.test(endTime) || startTime >= endTime || days.length === 0) throw new Error("Choose at least one day and a valid time range.");
  const db = await validStaffMember(tenant, memberId);
  await db`DELETE FROM availability_rules WHERE tenant_id = ${tenant.id} AND team_member_id = ${memberId}`;
  await db`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone) VALUES (${tenant.id}, ${memberId}, ${`FREQ=WEEKLY;BYDAY=${days.join(",")}`}, ${startTime}, ${endTime}, ${tenant.timezone})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, "staff.availability.updated", "team_member", ${memberId}, ${JSON.stringify({ days, startTime, endTime })}::jsonb)`;
  revalidateStaff();
}

export async function addStaffTimeOff(formData: FormData) {
  const tenant = await editableStaffTenant();
  const memberId = String(formData.get("memberId") ?? "");
  const localDate = String(formData.get("localDate") ?? "");
  const isUnavailable = String(formData.get("isUnavailable") ?? "true") === "true";
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  const reason = optionalText(formData, "reason", 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || (!isUnavailable && (!startTime || !endTime || startTime >= endTime))) throw new Error("Enter a date and valid available hours.");
  const db = await validStaffMember(tenant, memberId);
  await db`INSERT INTO availability_overrides (tenant_id, team_member_id, local_date, start_time, end_time, is_unavailable, reason) VALUES (${tenant.id}, ${memberId}, ${localDate}, ${startTime}, ${endTime}, ${isUnavailable}, ${reason})`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, "staff.availability.exception_added", "team_member", ${memberId}, ${JSON.stringify({ localDate, isUnavailable, startTime, endTime, reason })}::jsonb)`;
  revalidateStaff();
}
