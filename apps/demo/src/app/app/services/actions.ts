"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "service";
}

export async function saveService(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error("You do not have permission to manage services.");
  const id = String(formData.get("serviceId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const durationMinutes = Number(formData.get("durationMinutes"));
  const priceCents = Math.round(Number(formData.get("priceDkk")) * 100);
  const cadenceInput = String(formData.get("recommendedRebookDays") ?? "").trim();
  const recommendedRebookDays = cadenceInput ? Number(cadenceInput) : null;
  const isActive = String(formData.get("isActive") ?? "on") === "on";
  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  if (!title || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(priceCents) || priceCents < 0 || (recommendedRebookDays !== null && (!Number.isInteger(recommendedRebookDays) || recommendedRebookDays < 1 || recommendedRebookDays > 730))) throw new Error("Enter a name, duration, valid DKK price, and an optional return interval from 1 to 730 days.");
  const db = tenantDb(tenant);
  const validMembers = await db<{ id: string }[]>`SELECT id FROM team_members WHERE tenant_id = ${tenant.id} AND id = ANY(${memberIds}) AND is_active = TRUE`;
  if (validMembers.length !== memberIds.length) throw new Error("One or more selected employees are unavailable.");
  const validLocations = await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenant.id} AND id = ANY(${locationIds}) AND is_active = TRUE`;
  if (validLocations.length !== locationIds.length) throw new Error("One or more selected locations are unavailable.");
  let serviceId = id;
  if (id) {
    const [service] = await db<{ id: string }[]>`UPDATE services SET title = ${title}, description = ${description}, duration_minutes = ${durationMinutes}, buffer_before_minutes = 0, buffer_after_minutes = 0, price_cents = ${priceCents}, recommended_rebook_days = ${recommendedRebookDays}, is_active = ${isActive}, updated_at = now() WHERE id = ${id} AND tenant_id = ${tenant.id} RETURNING id`;
    if (!service) throw new Error("Service is unavailable.");
  } else {
    const baseSlug = slugify(title);
    const [existing] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM services WHERE tenant_id = ${tenant.id} AND slug LIKE ${`${baseSlug}%`}`;
    const slug = existing?.count ? `${baseSlug}-${existing.count + 1}` : baseSlug;
    const [service] = await db<{ id: string }[]>`INSERT INTO services (tenant_id, slug, title, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, recommended_rebook_days, is_active) VALUES (${tenant.id}, ${slug}, ${title}, ${description}, ${durationMinutes}, 0, 0, ${priceCents}, ${recommendedRebookDays}, ${isActive}) RETURNING id`;
    serviceId = service.id;
  }
  await db`DELETE FROM service_team_members WHERE tenant_id = ${tenant.id} AND service_id = ${serviceId}`;
  for (const member of validMembers) await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenant.id}, ${serviceId}, ${member.id})`;
  await db`DELETE FROM service_locations WHERE tenant_id = ${tenant.id} AND service_id = ${serviceId}`;
  for (const location of validLocations) await db`INSERT INTO service_locations (tenant_id, service_id, location_id) VALUES (${tenant.id}, ${serviceId}, ${location.id})`;
  revalidatePath("/app/services");
  revalidatePath("/app/team");
  revalidatePath("/app/calendars");
  revalidatePath("/book");
}
