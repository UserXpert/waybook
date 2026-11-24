"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { parseStaffRolePermissions, staffRoleIdPattern, type StaffRoleOption } from "@/lib/waybook/staff-role-fields";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

type RoleActionState = { error?: string; role?: StaffRoleOption; deleted?: boolean };

export async function saveStaffRole(_: RoleActionState, data: FormData): Promise<RoleActionState> {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") return { error: "Only owners can manage workspace roles." };
  await requireFeature(tenant.id, "team");

  const id = String(data.get("roleId") ?? "");
  const deleting = data.get("intent") === "delete";
  if ((id || deleting) && !staffRoleIdPattern.test(id)) return { error: "This role is unavailable." };
  const name = String(data.get("name") ?? "").trim();
  if (!deleting && (!name || name.length > 60)) return { error: "Enter a role name up to 60 characters." };
  if (!deleting && ["owner", "manager", "staff", "read-only", "read only"].includes(name.toLowerCase())) {
    return { error: "Choose a name different from the built-in roles." };
  }

  const actor = await requireIdentity();
  const permissions = parseStaffRolePermissions(data);
  let role: StaffRoleOption | undefined;
  try {
    role = await tenantDb(tenant).begin(async (tx) => {
      const [saved] = deleting
        ? await tx.unsafe<StaffRoleOption[]>("DELETE FROM staff_roles WHERE tenant_id = $1 AND id = $2 RETURNING id, name", [tenant.id, id])
        : id
          ? await tx.unsafe<StaffRoleOption[]>("UPDATE staff_roles SET name = $1, permissions = $2::text::jsonb WHERE tenant_id = $3 AND id = $4 RETURNING id, name", [name, JSON.stringify(permissions), tenant.id, id])
          : await tx.unsafe<StaffRoleOption[]>("INSERT INTO staff_roles (tenant_id, name, permissions) VALUES ($1, $2, $3::text::jsonb) RETURNING id, name", [tenant.id, name, JSON.stringify(permissions)]);
      if (saved) {
        const action = deleting ? "staff.role.deleted" : id ? "staff.role.updated" : "staff.role.created";
        await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, 'staff_role', $4, $5::text::jsonb)",
          [tenant.id, actor.id, action, saved.id, JSON.stringify({ name: saved.name, ...(deleting ? {} : { permissions }) })]);
      }
      return saved;
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23505") return { error: "A role already uses this name." };
    if (code === "23503" && deleting) return { error: "Reassign the staff using this role before deleting it." };
    throw error;
  }
  if (!role) return { error: "This role is unavailable." };

  const slug = await currentTenantRouteSlug(tenant.slug);
  for (const path of ["/app/team", "/app/settings"]) {
    revalidatePath(path);
    revalidatePath(tenantPath(slug, path));
  }
  return deleting ? { deleted: true } : { role };
}
