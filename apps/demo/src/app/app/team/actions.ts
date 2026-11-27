"use server";

import { assertNoOperationalFreeText } from "@/lib/waybook/operations-only-fields";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TransactionSql } from "postgres";
import { canEditStaffPhoto } from "@/lib/waybook/staff-photo-permissions";
import { CatalogueImageError, cataloguePhotoFromForm } from "@/lib/waybook/catalogue-media";
import { hashPassword, requireIdentity } from "@/lib/waybook/auth";
import { controlDb, tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { getGoogleAuth, googleSignInAvailable } from "@/lib/waybook/google-auth";
import { issueStaffInvitation, revokeStaffInvitation } from "@/lib/waybook/staff-invitations";
import { deleteStaffAccessRequest, inviteFromStaffAccessRequest } from "@/lib/waybook/staff-access-requests";
import { staffInvitationEmailConfig } from "@/lib/waybook/staff-invitation-email";
import { requireFeature } from "@/lib/waybook/features";
import { isStaffCalendarColor } from "@/lib/waybook/staff-calendar-colors";
import { staffLifecycleCapabilities } from "@/lib/waybook/staff-lifecycle";
import { staffRoleIdPattern } from "@/lib/waybook/staff-role-fields";
import { enforceReadOnlyPermissions } from "@/lib/waybook/read-only-permissions";
import { canManageTimeOff, staffPermissionContext, staffWorkspacePermissionsAvailable } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { withSuccessToast } from "@/lib/waybook/toast";

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
  const [member] = await db<{ id: string }[]>`SELECT id FROM team_members tm WHERE id = ${memberId} AND tenant_id = ${tenant.id} AND to_jsonb(tm)->>'deleted_at' IS NULL`;
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
  while (cursor <= last && dates.length <= 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export type StaffPhotoResult = { error: string | null };

export async function saveStaffPhoto(formData: FormData): Promise<StaffPhotoResult> {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "team");
  const memberId = String(formData.get("memberId") ?? "");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!canEditStaffPhoto(membership.role, permissions.teamMemberId, memberId)) throw new Error("You do not have permission to change this photo.");
  const db = await validStaffMember(tenant, memberId);
  const photo = formData.get("photo");
  const removing = formData.get("removePhoto") === "on";
  if (!removing && (!(photo instanceof File) || photo.size === 0)) return { error: "Choose a photo to upload." };
  let photoDataUrl: string | null;
  try {
    photoDataUrl = await cataloguePhotoFromForm(formData, null);
  } catch (error) {
    if (error instanceof CatalogueImageError) return { error: error.message };
    throw error;
  }
  const actor = await requireIdentity();
  await db.begin(async (tx) => {
    const [updated] = await tx.unsafe<{ id: string }[]>("UPDATE team_members SET photo_data_url = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3 RETURNING id", [photoDataUrl, tenant.id, memberId]);
    if (!updated) throw new Error("Staff member is unavailable.");
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'staff.photo_updated', 'team_member', $3, $4::jsonb)", [tenant.id, actor.id, memberId, { removed: removing }]);
  });
  revalidateStaff();
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath(tenantPath(slug, "/app"), "layout");
  return { error: null };
}

export type StaffDetailsState = { error?: string; saved?: boolean };

export async function saveOwnerProfileDetails(_: StaffDetailsState, formData: FormData): Promise<StaffDetailsState> {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") return { error: "Only the workspace owner can edit their own details." };
  await requireFeature(tenant.id, "team");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const calendarColor = String(formData.get("calendarColor") ?? "").trim().toLowerCase() || null;
  const memberId = formData.get("memberId");
  if (!name || name.length > 160) return { error: "Enter a name up to 160 characters." };
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid workspace email." };
  if (phone.length > 80) return { error: "Enter a phone number up to 80 characters." };
  if (calendarColor && !isStaffCalendarColor(calendarColor)) return { error: "Choose one of the available calendar colours." };
  assertNoOperationalFreeText(formData, "internalNotes");
  if (typeof memberId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(memberId)) {
    return { error: "Your workspace profile is unavailable." };
  }

  const jobTitle = optionalText(formData, "jobTitle", 120);
  const specialty = optionalText(formData, "specialty", 160);
  const workLocation = optionalText(formData, "workLocation", 160);
  const staffCode = optionalText(formData, "staffCode", 80);
  const actor = await requireIdentity();
  try {
    const [saved] = await tenantDb(tenant)<{ id: string }[]>`
      WITH prior AS (
        SELECT id, name, email, phone, calendar_color, job_title, specialty, work_location, staff_code
        FROM team_members
        WHERE tenant_id = ${tenant.id} AND id = ${memberId} AND identity_id = ${actor.id}
          AND role = 'owner' AND is_active
        FOR UPDATE
      ), profile AS (
        UPDATE team_members AS member
        SET name = ${name}, email = ${email}, phone = ${phone || null}, calendar_color = COALESCE(${calendarColor}, member.calendar_color),
          job_title = CASE WHEN ${formData.has("jobTitle")} THEN ${jobTitle} ELSE member.job_title END,
          specialty = CASE WHEN ${formData.has("specialty")} THEN ${specialty} ELSE member.specialty END,
          work_location = CASE WHEN ${formData.has("workLocation")} THEN ${workLocation} ELSE member.work_location END,
          staff_code = CASE WHEN ${formData.has("staffCode")} THEN ${staffCode} ELSE member.staff_code END,
          updated_at = now()
        FROM prior WHERE member.id = prior.id
        RETURNING member.id, array_remove(ARRAY[
          CASE WHEN member.name IS DISTINCT FROM prior.name THEN 'name' END,
          CASE WHEN member.email IS DISTINCT FROM prior.email THEN 'email' END,
          CASE WHEN member.phone IS DISTINCT FROM prior.phone THEN 'phone' END,
          CASE WHEN member.calendar_color IS DISTINCT FROM prior.calendar_color THEN 'calendarColor' END,
          CASE WHEN member.job_title IS DISTINCT FROM prior.job_title THEN 'jobTitle' END,
          CASE WHEN member.specialty IS DISTINCT FROM prior.specialty THEN 'specialty' END,
          CASE WHEN member.work_location IS DISTINCT FROM prior.work_location THEN 'workLocation' END,
          CASE WHEN member.staff_code IS DISTINCT FROM prior.staff_code THEN 'staffCode' END
        ], NULL) AS fields
      ), audited AS (
        INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
        SELECT ${tenant.id}, ${actor.id}, 'staff.updated', 'team_member', id,
          jsonb_build_object('fields', fields) FROM profile WHERE cardinality(fields) > 0
      )
      SELECT id FROM profile
    `;
    if (!saved) return { error: "Your workspace profile is unavailable." };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      if ("constraint_name" in error && error.constraint_name === "team_members_tenant_calendar_color_key") {
        return { error: "That calendar colour is already in use. Choose another colour." };
      }
      return { error: "A staff member already uses this email." };
    }
    throw error;
  }

  revalidateStaff();
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath(tenantPath(slug, "/app"), "layout");
  return { saved: true };
}

export async function saveTeamMember(_: StaffDetailsState, formData: FormData): Promise<StaffDetailsState> {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) return { error: "You do not have permission to manage staff." };
  await requireFeature(tenant.id, "team");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleChoice = String(formData.get("role") ?? "staff");
  const staffRoleId = roleChoice.startsWith("custom:") ? roleChoice.slice(7) : null;
  const role = staffRoleId !== null ? "staff" : roleChoice;
  const memberId = String(formData.get("memberId") ?? "");
  let serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  let locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  const isActive = String(formData.get("isActive") ?? "") === "on";
  const phone = optionalText(formData, "phone", 80);
  const jobTitle = optionalText(formData, "jobTitle", 120);
  const specialty = optionalText(formData, "specialty", 160);
  const workLocation = optionalText(formData, "workLocation", 160);
  const staffCode = optionalText(formData, "staffCode", 80);
  assertNoOperationalFreeText(formData, "internalNotes");
  const calendarColor = String(formData.get("calendarColor") ?? "").trim().toLowerCase() || null;
  const assignmentsOnly = formData.get("editMode") === "assignments";
  const replaceAssignments = assignmentsOnly || !memberId;
  if (assignmentsOnly && !memberId) return { error: "Staff member is unavailable." };
  if (!assignmentsOnly && (!name || name.length > 160 || !email.includes("@") || !["manager", "staff", "read-only"].includes(role))) return { error: "Enter a name, valid email, and role." };
  const db = tenantDb(tenant);
  if (!assignmentsOnly && staffRoleId !== null) {
    if (!staffRoleIdPattern.test(staffRoleId)) return { error: "Choose an available role." };
    const [customRole] = await db`SELECT id FROM staff_roles WHERE tenant_id = ${tenant.id} AND id = ${staffRoleId}`;
    if (!customRole) return { error: "Choose an available role." };
  }
  if (!assignmentsOnly && memberId) {
    const [existing] = await db<{ role: string; staffRoleId: string | null }[]>`SELECT role, staff_role_id AS "staffRoleId" FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
    if (existing?.role === "owner") return { error: "The workspace owner profile cannot be changed here." };
    if (membership.role !== "owner" && (role === "manager" || existing?.role === "manager")) {
      return { error: "Only an owner can create or change a manager profile." };
    }
    if (existing && membership.role !== "owner" && staffRoleId !== existing.staffRoleId) return { error: "Only an owner can change custom role assignments." };
  } else if (!assignmentsOnly && membership.role !== "owner" && (role === "manager" || staffRoleId !== null)) {
    return { error: "Only an owner can assign manager or custom roles." };
  }
  if (!assignmentsOnly && calendarColor && !isStaffCalendarColor(calendarColor)) return { error: "Choose one of the available calendar colours." };
  // Preserve the established new-staff default without sending an unbounded
  // directory to the browser. Existing profiles always submit explicit IDs.
  if (!memberId && String(formData.get("defaultAssignments") ?? "") === "all") {
    const [services, locations] = await Promise.all([
      db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id = ${tenant.id} AND is_active = TRUE`,
      db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE`,
    ]);
    serviceIds = services.map((service) => service.id);
    locationIds = locations.map((location) => location.id);
  }
  const validServices = replaceAssignments ? await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id = ${tenant.id} AND id = ANY(${serviceIds})` : [];
  if (replaceAssignments && validServices.length !== serviceIds.length) return { error: "A selected service is unavailable." };
  const validLocations = replaceAssignments ? await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenant.id} AND id = ANY(${locationIds}) AND is_active = TRUE` : [];
  if (replaceAssignments && validLocations.length !== locationIds.length) return { error: "A selected location is unavailable." };
  let member: { id: string } | undefined;
  try {
    [member] = assignmentsOnly
      ? await db<{ id: string }[]>`SELECT id FROM team_members tm WHERE id = ${memberId} AND tenant_id = ${tenant.id} AND to_jsonb(tm)->>'deleted_at' IS NULL`
      : memberId
      ? await db<{ id: string }[]>`UPDATE team_members SET name = ${name}, email = ${email}, role = ${role}, staff_role_id = ${staffRoleId}, is_active = ${isActive}, phone = ${phone}, job_title = CASE WHEN ${formData.has("jobTitle")} THEN ${jobTitle} ELSE job_title END, specialty = CASE WHEN ${formData.has("specialty")} THEN ${specialty} ELSE specialty END, work_location = CASE WHEN ${formData.has("workLocation")} THEN ${workLocation} ELSE work_location END, staff_code = CASE WHEN ${formData.has("staffCode")} THEN ${staffCode} ELSE staff_code END, calendar_color = COALESCE(${calendarColor}, calendar_color), updated_at = now() WHERE id = ${memberId} AND tenant_id = ${tenant.id} AND to_jsonb(team_members)->>'deleted_at' IS NULL AND role <> 'owner' AND (${membership.role} = 'owner' OR (role <> 'manager' AND staff_role_id IS NOT DISTINCT FROM ${staffRoleId}::uuid)) RETURNING id`
      : await db<{ id: string }[]>`INSERT INTO team_members (tenant_id, role, staff_role_id, name, email, is_active, phone, job_title, specialty, work_location, staff_code, calendar_color) VALUES (${tenant.id}, ${role}, ${staffRoleId}, ${name}, ${email}, ${isActive}, ${phone}, ${jobTitle}, ${specialty}, ${workLocation}, ${staffCode}, ${calendarColor}) ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      if ("constraint_name" in error && error.constraint_name === "team_members_tenant_calendar_color_key") {
        return { error: "That calendar colour is already in use. Choose another colour." };
      }
      return { error: "A staff member already uses this email." };
    }
    throw error;
  }
  if (!member) return { error: memberId ? "Staff member is unavailable." : "A staff member already uses this email." };
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
  if (replaceAssignments) await db.begin(async (tx) => {
    await tx.unsafe("SELECT id FROM team_members WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenant.id, member.id]);
    await tx.unsafe("DELETE FROM service_team_members WHERE tenant_id = $1 AND team_member_id = $2", [tenant.id, member.id]);
    await tx.unsafe("INSERT INTO service_team_members (tenant_id, service_id, team_member_id) SELECT $1, unnest($2::uuid[]), $3", [tenant.id, validServices.map(({ id }) => id), member.id]);
    await tx.unsafe("DELETE FROM team_member_locations WHERE tenant_id = $1 AND team_member_id = $2", [tenant.id, member.id]);
    await tx.unsafe("INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) SELECT $1, $2, unnest($3::uuid[])", [tenant.id, member.id, validLocations.map(({ id }) => id)]);
  });
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${memberId ? "staff.updated" : "staff.created"}, 'team_member', ${member.id}, ${JSON.stringify({ fields: ["name", "email", "role", "staffRoleId", "isActive", "phone", "jobTitle", "specialty", "workLocation", "staffCode", "calendarColor", "serviceIds", "locationIds"] })}::jsonb)`;
  revalidateStaff();
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(slug, "/app/team")}?employee=${member.id}${assignmentsOnly ? "&tab=services" : ""}`, "Staff member saved."));
}

export async function createStaffGoogleInvitation(formData: FormData) {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  const configured = getGoogleAuth();
  if (!configured || !(await googleSignInAvailable())) throw new Error("Google invitations are unavailable.");
  const memberId = String(formData.get("memberId") ?? "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(memberId)) throw new Error("Staff member is unavailable.");
  const token = await issueStaffInvitation(tenant, actor.id, memberId);
  return new URL(`/join#${token}`, configured.origin).href;
}

type StaffAccessReviewState = { error?: string; sent?: boolean; deleted?: boolean };

export async function reviewStaffAccess(_: StaffAccessReviewState, formData: FormData): Promise<StaffAccessReviewState> {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  const requestId = String(formData.get("requestId") ?? "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)) {
    return { error: "This request is unavailable." };
  }
  const intent = formData.get("intent");
  try {
    if (intent === "delete") {
      const deleted = await deleteStaffAccessRequest(tenant, actor.id, requestId);
      return deleted ? { deleted: true } : { error: "This invitation was already claimed. Manage the account in Staff." };
    }
    if (intent !== "grant" && intent !== "resend") return { error: "Choose an action for this request." };
    const sendNumber = String(formData.get("sendNumber") ?? "");
    if (intent === "resend" && !/^\d{1,9}$/.test(sendNumber)) return { error: "Refresh the request list before resending." };
    const configured = staffInvitationEmailConfig();
    if (!configured) return { error: "Staff invitation email is unavailable until Waybook has a verified sender." };
    return await inviteFromStaffAccessRequest(tenant, actor.id, requestId, configured, intent === "resend" ? Number(sendNumber) : undefined);
  } catch {
    return { error: intent === "delete" ? "The request couldn’t be deleted. Try again." : "The invitation couldn’t be sent. Try again or review the profile in Staff." };
  }
}

export async function cancelStaffGoogleInvitation(formData: FormData) {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  if (!(await googleSignInAvailable())) throw new Error("Google invitations are unavailable.");
  const memberId = String(formData.get("memberId") ?? "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(memberId)) throw new Error("Staff member is unavailable.");
  await revokeStaffInvitation(tenant.id, actor.id, memberId);
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
  await controlDb.begin(async (tx) => {
    const [updated] = await tx.unsafe<{ id: string }[]>(`
      UPDATE identities i SET password_hash = $1, updated_at = now()
      WHERE i.id = $2 AND i.password_hash <> '' AND NOT i.is_platform_admin
        AND EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.identity_id = i.id AND m.tenant_id = $3)
        AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.identity_id = i.id AND m.tenant_id <> $3)
      RETURNING id
    `, [hashPassword(password), member.identityId, tenant.id]);
    if (!updated) throw new Error("This account does not support a workspace password reset.");
    await tx.unsafe("UPDATE sessions SET revoked_at = now() WHERE identity_id = $1 AND revoked_at IS NULL", [member.identityId]);
    await tx.unsafe(
      "INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id) VALUES ($1, $2, 'staff.login.password_reset', 'team_member', $3)",
      [actor.id, tenant.id, member.id],
    );
  });
  await db`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id) VALUES (${tenant.id}, ${actor.id}, 'staff.login.password_reset', 'team_member', ${member.id})`;
  revalidateStaff();
}

export async function deleteStaffProfile(formData: FormData): Promise<{ error?: string }> {
  const tenant = await ownerStaffTenant();
  const actor = await requireIdentity();
  const memberId = String(formData.get("memberId") ?? "");
  if (!staffRoleIdPattern.test(memberId)) return { error: "Staff member is unavailable." };
  if (!(await staffLifecycleCapabilities(tenant)).deletion) return { error: "Staff deletion is unavailable in this workspace." };

  const [deleted] = await tenantDb(tenant)`
    WITH deleted_profile AS (
      UPDATE team_members
      SET deleted_at = now(), archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE tenant_id = ${tenant.id} AND id = ${memberId}
        AND deleted_at IS NULL AND NOT is_active AND role <> 'owner'
        AND identity_id IS DISTINCT FROM ${actor.id}::uuid
      RETURNING id
    )
    INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
    SELECT ${tenant.id}, ${actor.id}, 'staff.delete', 'team_member', id, '{"isActive":false}'::jsonb
    FROM deleted_profile
    RETURNING target_id
  `;
  if (!deleted) return { error: "Only an inactive or archived staff profile can be deleted." };
  revalidateStaff();
  return {};
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
  const { archive: lifecycleAvailable } = await staffLifecycleCapabilities(tenant);
  if (["archive", "restore"].includes(action) && !lifecycleAvailable) throw new Error("Archive is available after the staff lifecycle migration is applied.");
  const isActive = ["reactivate", "restore"].includes(action);
  const [updated] = lifecycleAvailable
    ? await db`
        UPDATE team_members tm SET is_active = ${isActive}, updated_at = now(),
          archived_at = CASE ${action} WHEN 'archive' THEN now() WHEN 'restore' THEN NULL ELSE archived_at END
        WHERE id = ${member.id} AND tenant_id = ${tenant.id} AND to_jsonb(tm)->>'deleted_at' IS NULL
        RETURNING id
      `
    : await db`UPDATE team_members SET is_active = ${isActive}, updated_at = now() WHERE id = ${member.id} AND tenant_id = ${tenant.id} RETURNING id`;
  if (!updated) throw new Error("Staff member is unavailable.");
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
  const [member] = await db<{ role: string; staffRoleId: string | null }[]>`SELECT role, staff_role_id AS "staffRoleId" FROM team_members WHERE id = ${memberId} AND tenant_id = ${tenant.id}`;
  if (member?.staffRoleId) throw new Error("Manage permissions for this role in Settings.");
  if (member?.role === 'owner') throw new Error('Owner permissions cannot be changed from the staff directory.');
  if (membership.role !== 'owner' && member?.role === 'manager') throw new Error("Only an owner can change a manager's permissions.");
  const workspacePermissionsAvailable = await staffWorkspacePermissionsAvailable(tenant);
  const permissions = enforceReadOnlyPermissions(member?.role ?? "", {
    canUpdateAppointmentStatus: String(formData.get("canUpdateAppointmentStatus") ?? "") === "on",
    canManageOwnAppointments: String(formData.get("canManageOwnAppointments") ?? "") === "on",
    canViewTeamCalendar: String(formData.get("canViewTeamCalendar") ?? "") === "on",
    canManageTeamAppointments: String(formData.get("canManageTeamAppointments") ?? "") === "on",
    canManageOwnTimeOff: String(formData.get("canManageOwnTimeOff") ?? "") === "on",
    canManageTeamTimeOff: String(formData.get("canManageTeamTimeOff") ?? "") === "on",
    canManageWaitlist: String(formData.get("canManageWaitlist") ?? "") === "on",
    canCheckoutAppointments: false,
    canViewClients: String(formData.get("canViewClients") ?? "") === "on",
    canManageClients: String(formData.get("canManageClients") ?? "") === "on",
    canAccessReports: String(formData.get("canAccessReports") ?? "") === "on",
    canManageResources: String(formData.get("canManageResources") ?? "") === "on",
    canManageServiceSettings: String(formData.get("canManageServiceSettings") ?? "") === "on",
  });
  if (member?.role === "read-only") {
    // An edit to view access should leave any previous write grants stored.
    const viewGrants = { can_view_team_calendar: permissions.canViewTeamCalendar };
    const grants = workspacePermissionsAvailable
      ? { ...viewGrants, can_view_clients: permissions.canViewClients, can_access_reports: permissions.canAccessReports }
      : viewGrants;
    await db`
      INSERT INTO staff_permissions ${db({ tenant_id: tenant.id, team_member_id: memberId, ...grants })}
      ON CONFLICT (tenant_id, team_member_id) DO UPDATE SET ${db(grants)}, updated_at=now()
    `;
  } else {
    const baseArgs = [tenant.id, memberId, permissions.canUpdateAppointmentStatus, permissions.canManageOwnAppointments, permissions.canViewTeamCalendar, permissions.canManageTeamAppointments, permissions.canManageOwnTimeOff, permissions.canManageTeamTimeOff, permissions.canManageWaitlist];
    await db.unsafe(
      workspacePermissionsAvailable ?
      "INSERT INTO staff_permissions (tenant_id, team_member_id, can_update_appointment_status, can_manage_own_appointments, can_view_team_calendar, can_manage_team_appointments, can_manage_own_time_off, can_manage_team_time_off, can_manage_waitlist, can_view_clients, can_manage_clients, can_access_reports, can_manage_resources, can_manage_service_settings, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()) ON CONFLICT (tenant_id, team_member_id) DO UPDATE SET can_update_appointment_status=EXCLUDED.can_update_appointment_status, can_manage_own_appointments=EXCLUDED.can_manage_own_appointments, can_view_team_calendar=EXCLUDED.can_view_team_calendar, can_manage_team_appointments=EXCLUDED.can_manage_team_appointments, can_manage_own_time_off=EXCLUDED.can_manage_own_time_off, can_manage_team_time_off=EXCLUDED.can_manage_team_time_off, can_manage_waitlist=EXCLUDED.can_manage_waitlist, can_view_clients=EXCLUDED.can_view_clients, can_manage_clients=EXCLUDED.can_manage_clients, can_access_reports=EXCLUDED.can_access_reports, can_manage_resources=EXCLUDED.can_manage_resources, can_manage_service_settings=EXCLUDED.can_manage_service_settings, updated_at=now()"
      : "INSERT INTO staff_permissions (tenant_id, team_member_id, can_update_appointment_status, can_manage_own_appointments, can_view_team_calendar, can_manage_team_appointments, can_manage_own_time_off, can_manage_team_time_off, can_manage_waitlist, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT (tenant_id, team_member_id) DO UPDATE SET can_update_appointment_status=EXCLUDED.can_update_appointment_status, can_manage_own_appointments=EXCLUDED.can_manage_own_appointments, can_view_team_calendar=EXCLUDED.can_view_team_calendar, can_manage_team_appointments=EXCLUDED.can_manage_team_appointments, can_manage_own_time_off=EXCLUDED.can_manage_own_time_off, can_manage_team_time_off=EXCLUDED.can_manage_team_time_off, can_manage_waitlist=EXCLUDED.can_manage_waitlist, updated_at=now()",
      workspacePermissionsAvailable ? [...baseArgs, permissions.canViewClients, permissions.canManageClients, permissions.canAccessReports, permissions.canManageResources, permissions.canManageServiceSettings] : baseArgs,
    );
  }
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'staff.permissions.updated', 'team_member', ${memberId}, ${JSON.stringify(permissions)}::jsonb)`;
  revalidateStaff();
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(slug, "/app/team")}?employee=${memberId}&tab=permissions`, "Staff permissions saved."));
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
  if (!memberId || schedule.length > 28 || schedule.some((entry) => !validDays.has(entry.day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.endTime) || entry.startTime >= entry.endTime)) throw new Error("Choose valid shift times.");
  const shiftsByDay = new Map<string, ScheduleEntry[]>();
  for (const entry of schedule) shiftsByDay.set(entry.day, [...(shiftsByDay.get(entry.day) ?? []), entry]);
  for (const [day, shifts] of shiftsByDay) {
    const ordered = [...shifts].sort((left, right) => left.startTime.localeCompare(right.startTime));
    if (ordered.some((shift, index) => index > 0 && shift.startTime < ordered[index - 1].endTime)) {
      throw new Error(`Working shifts on ${day} cannot overlap.`);
    }
  }
  const db = await validStaffMember(tenant, memberId);
  await db.begin(async (tx) => {
    await tx.unsafe("DELETE FROM availability_rules WHERE tenant_id = $1 AND team_member_id = $2", [tenant.id, memberId]);
    for (const entry of schedule) await tx.unsafe("INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone) VALUES ($1, $2, $3, $4, $5, $6)", [tenant.id, memberId, `FREQ=WEEKLY;BYDAY=${entry.day}`, entry.startTime, entry.endTime, tenant.timezone]);
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'team_member', $3, $4::jsonb)", [tenant.id, "staff.availability.updated", memberId, JSON.stringify({ schedule })]);
  });
  revalidateStaff();
}

export type StaffTimeOffState = { error?: string; success?: string };

async function saveTimeOffTransaction(tenant: TenantRecord, memberId: string, change: (tx: TransactionSql) => Promise<StaffTimeOffState>) {
  const result = await tenantDb(tenant).begin(async (tx): Promise<StaffTimeOffState> => {
    const [member] = await tx.unsafe("SELECT id FROM team_members WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [memberId, tenant.id]);
    if (!member) return { error: "Staff member is unavailable." };
    return change(tx);
  });
  if (result.success) revalidateStaff();
  return result;
}

export async function addStaffTimeOff(formData: FormData): Promise<StaffTimeOffState> {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const localDate = String(formData.get("localDate") ?? "");
  const endLocalDate = String(formData.get("endLocalDate") ?? localDate);
  const fullDay = String(formData.get("fullDay") ?? "false") === "true";
  const isUnavailable = true;
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  assertNoOperationalFreeText(formData, "reason");
  const hasPartialWindow = Boolean(startTime) && Boolean(endTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endLocalDate) || endLocalDate < localDate || (!fullDay && (!hasPartialWindow || startTime! >= endTime!)) || (fullDay && (startTime || endTime))) {
    return { error: "Choose a valid date or date range, then either block the full day or enter a complete valid time range." };
  }
  const dates = localDatesInRange(localDate, endLocalDate);
  if (dates.length > 31) return { error: "Time off can cover up to 31 days at a time." };
  if (dates[0] !== localDate || dates.at(-1) !== endLocalDate) return { error: "Choose a valid date or date range." };
  return saveTimeOffTransaction(tenant, memberId, async (tx) => {
    const [existing] = await tx.unsafe("SELECT id FROM availability_overrides WHERE tenant_id = $1 AND team_member_id = $2 AND local_date BETWEEN $3 AND $4 LIMIT 1", [tenant.id, memberId, localDate, endLocalDate]);
    if (existing) return { error: "One or more selected dates already have a time-off exception. Choose dates without an existing exception." };
    await tx.unsafe("INSERT INTO availability_overrides (tenant_id, team_member_id, local_date, start_time, end_time, is_unavailable) SELECT $1, $2, day, $3, $4, TRUE FROM unnest($5::date[]) AS day", [tenant.id, memberId, startTime, endTime, dates]);
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'staff.availability.exception_added', 'team_member', $2, $3::jsonb)", [tenant.id, memberId, JSON.stringify({ localDate, endLocalDate, dateCount: dates.length, fullDay, isUnavailable, startTime, endTime })]);
    return { success: "Time off saved." };
  });
}

export async function updateStaffTimeOff(formData: FormData): Promise<StaffTimeOffState> {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const overrideId = String(formData.get("overrideId") ?? "");
  const localDate = String(formData.get("localDate") ?? "");
  const endLocalDate = String(formData.get("endLocalDate") ?? localDate);
  const fullDay = String(formData.get("fullDay") ?? "false") === "true";
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  assertNoOperationalFreeText(formData, "reason");
  const hasPartialWindow = Boolean(startTime) && Boolean(endTime);
  if (!overrideId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || endLocalDate !== localDate || localDatesInRange(localDate, localDate)[0] !== localDate || (!fullDay && (!hasPartialWindow || startTime! >= endTime!)) || (fullDay && (startTime || endTime))) {
    return { error: "Choose one valid date and a complete valid time range when needed." };
  }
  return saveTimeOffTransaction(tenant, memberId, async (tx) => {
    const [override] = await tx.unsafe("SELECT id FROM availability_overrides WHERE id = $1 AND tenant_id = $2 AND team_member_id = $3", [overrideId, tenant.id, memberId]);
    if (!override) return { error: "That time-off entry is unavailable." };
    const [conflict] = await tx.unsafe("SELECT id FROM availability_overrides WHERE tenant_id = $1 AND team_member_id = $2 AND local_date = $3 AND id <> $4 LIMIT 1", [tenant.id, memberId, localDate, overrideId]);
    if (conflict) return { error: "Another time-off entry already exists on that date." };
    await tx.unsafe("UPDATE availability_overrides SET local_date = $1, start_time = $2, end_time = $3, is_unavailable = TRUE WHERE id = $4 AND tenant_id = $5 AND team_member_id = $6", [localDate, startTime, endTime, overrideId, tenant.id, memberId]);
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'staff.availability.exception_updated', 'team_member', $2, $3::jsonb)", [tenant.id, memberId, JSON.stringify({ overrideId, localDate, fullDay, startTime, endTime })]);
    return { success: "Time off updated." };
  });
}

export async function deleteStaffTimeOff(formData: FormData): Promise<StaffTimeOffState> {
  const memberId = String(formData.get("memberId") ?? "");
  const tenant = await editableStaffTimeOffTenant(memberId);
  const overrideId = String(formData.get("overrideId") ?? "");
  if (!overrideId) return { error: "Choose a time-off entry to remove." };
  return saveTimeOffTransaction(tenant, memberId, async (tx) => {
    const [removed] = await tx.unsafe<{ localDate: string }[]>("DELETE FROM availability_overrides WHERE id = $1 AND tenant_id = $2 AND team_member_id = $3 RETURNING local_date::text AS \"localDate\"", [overrideId, tenant.id, memberId]);
    if (!removed) return { error: "That time-off entry is unavailable." };
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'staff.availability.exception_removed', 'team_member', $2, $3::jsonb)", [tenant.id, memberId, JSON.stringify({ overrideId, localDate: removed.localDate })]);
    return { success: "Time off removed." };
  });
}
