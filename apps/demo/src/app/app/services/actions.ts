"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "service";
}

export async function saveService(formData: FormData) {
  const identity = await requireIdentity();
  const [membership] = await controlDb<{ tenantId: string; role: string }[]>`SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2`;
  if (!membership || !["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage services.");
  const tenant = await findTenantById(membership.tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  await requireFeature(tenant.id, "booking-essentials");
  const id = String(formData.get("serviceId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const durationMinutes = Number(formData.get("durationMinutes"));
  const bufferBeforeMinutes = Number(formData.get("bufferBeforeMinutes") ?? 0);
  const bufferAfterMinutes = Number(formData.get("bufferAfterMinutes") ?? 0);
  const priceCents = Math.round(Number(formData.get("priceDkk")) * 100);
  const isActive = String(formData.get("isActive") ?? "on") === "on";
  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
  if (!title || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(bufferBeforeMinutes) || bufferBeforeMinutes < 0 || !Number.isInteger(bufferAfterMinutes) || bufferAfterMinutes < 0 || !Number.isInteger(priceCents) || priceCents < 0) throw new Error("Enter a name, duration, non-negative buffers, and a valid DKK price.");
  const db = tenantDb(tenant);
  const validMembers = await db<{ id: string }[]>`SELECT id FROM team_members WHERE tenant_id = ${tenant.id} AND id = ANY(${memberIds}) AND is_active = TRUE`;
  if (validMembers.length !== memberIds.length) throw new Error("One or more selected employees are unavailable.");
  let serviceId = id;
  if (id) {
    const [service] = await db<{ id: string }[]>`UPDATE services SET title = ${title}, description = ${description}, duration_minutes = ${durationMinutes}, buffer_before_minutes = ${bufferBeforeMinutes}, buffer_after_minutes = ${bufferAfterMinutes}, price_cents = ${priceCents}, is_active = ${isActive}, updated_at = now() WHERE id = ${id} AND tenant_id = ${tenant.id} RETURNING id`;
    if (!service) throw new Error("Service is unavailable.");
  } else {
    const baseSlug = slugify(title);
    const [existing] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM services WHERE tenant_id = ${tenant.id} AND slug LIKE ${`${baseSlug}%`}`;
    const slug = existing?.count ? `${baseSlug}-${existing.count + 1}` : baseSlug;
    const [service] = await db<{ id: string }[]>`INSERT INTO services (tenant_id, slug, title, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, is_active) VALUES (${tenant.id}, ${slug}, ${title}, ${description}, ${durationMinutes}, ${bufferBeforeMinutes}, ${bufferAfterMinutes}, ${priceCents}, ${isActive}) RETURNING id`;
    serviceId = service.id;
  }
  await db`DELETE FROM service_team_members WHERE tenant_id = ${tenant.id} AND service_id = ${serviceId}`;
  for (const member of validMembers) await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenant.id}, ${serviceId}, ${member.id})`;
  revalidatePath("/app/services");
  revalidatePath("/app/team");
  revalidatePath("/app/calendars");
  revalidatePath("/book");
}
