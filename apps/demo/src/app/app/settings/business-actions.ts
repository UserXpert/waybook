"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { businessProfileFields, type BusinessProfile } from "@/lib/waybook/business-profile";
import { CatalogueImageError, cataloguePhotoFromForm } from "@/lib/waybook/catalogue-media";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

export type BusinessProfileState = { error?: string; saved?: boolean };

export async function saveBusinessProfile(_: BusinessProfileState, data: FormData): Promise<BusinessProfileState> {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") return { error: "Only the workspace owner can change business details." };

  const name = String(data.get("name") ?? "").trim();
  if (!name || name.length > 120) return { error: "Enter a business name up to 120 characters." };
  const profile: BusinessProfile = {};
  for (const { key, label, maxLength } of businessProfileFields) {
    const value = String(data.get(key) ?? "").trim();
    if (value.length > maxLength) return { error: `${label} must be at most ${maxLength} characters.` };
    if (value) profile[key] = value;
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return { error: "Enter a valid business email." };
  if (profile.website) {
    try {
      const url = new URL(profile.website);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      return { error: "Enter a website address starting with https:// or http://." };
    }
  }
  const db = tenantDb(tenant);
  const [settings] = await db<{ available: boolean }[]>`
    SELECT to_jsonb(ts) ? 'business_profile' AS available FROM tenant_settings ts WHERE tenant_id = ${tenant.id}
  `;
  if (!settings?.available) return { error: "Update the workspace database before saving business details." };

  const removeLogo = data.get("removePhoto") === "on";
  let logo: string | null;
  try {
    logo = await cataloguePhotoFromForm(data, null);
  } catch (error) {
    if (error instanceof CatalogueImageError) return { error: error.message };
    throw error;
  }
  const actor = await requireIdentity();
  const [saved] = await db`
    WITH changed AS (
      UPDATE tenant_settings SET name = ${name}, business_profile = ${db.json(profile)},
        booking_page = CASE
          WHEN NOT ${removeLogo} AND ${logo}::text IS NULL THEN booking_page
          ELSE (
            CASE jsonb_typeof(booking_page)
              WHEN 'string' THEN (booking_page #>> '{}')::jsonb
              WHEN 'object' THEN booking_page
              ELSE '{}'::jsonb
            END - 'logoUrl'
          ) || CASE
            WHEN ${removeLogo} THEN '{}'::jsonb
            ELSE jsonb_build_object('logoUrl', ${logo}::text)
          END
        END,
        updated_at = now()
      WHERE tenant_id = ${tenant.id}
      RETURNING tenant_id
    )
    INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id)
    SELECT tenant_id, ${actor.id}, 'tenant.business_profile.updated', 'tenant_settings', tenant_id FROM changed
    RETURNING target_id
  `;
  if (!saved) return { error: "Business settings are unavailable." };
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath("/app", "layout");
  for (const path of ["/app/settings", "/app/online-booking", "/book", "/login"]) {
    revalidatePath(path);
    revalidatePath(tenantPath(slug, path));
  }
  return { saved: true };
}
