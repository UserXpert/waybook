"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { cataloguePhotoFromForm } from "@/lib/waybook/catalogue-media";

async function managerContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to manage packages.");
  return { tenant, identity: await requireIdentity() };
}
const unitsFrom = (value: FormDataEntryValue | null) => Number.parseInt(String(value ?? ""), 10);

export async function savePackageDefinition(formData: FormData) {
  const { tenant, identity } = await managerContext();
  const packageItemId = String(formData.get("packageItemId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const serviceId = String(formData.get("serviceId") ?? "");
  const units = unitsFrom(formData.get("units"));
  const priceDkk = Number(String(formData.get("priceDkk") ?? "").replace(",", "."));
  const priceCents = Math.round(priceDkk * 100);
  const expiryRaw = String(formData.get("expiryDays") ?? "").trim();
  const expiryDays = expiryRaw ? unitsFrom(expiryRaw) : null;
  if (!title || title.length > 140 || !serviceId || !Number.isInteger(units) || units < 1 || units > 999 || !Number.isFinite(priceCents) || priceCents < 0 || priceCents > 10_000_000 || (expiryDays !== null && (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650))) throw new Error("Enter a package title, service, 1–999 visits, valid price, and optional expiry of 1–3650 days.");
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [service] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM services WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE", [serviceId, tenant.id]);
    const [settings] = await transaction.unsafe<{ currency: string }[]>("SELECT currency FROM tenant_settings WHERE tenant_id=$1", [tenant.id]);
    if (!service || !settings) throw new Error("The selected service is no longer available.");
    if (packageItemId) {
      const [current] = await transaction.unsafe<{ metadata: { photoDataUrl?: string } }[]>("SELECT metadata FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='package' FOR UPDATE", [packageItemId, tenant.id]);
      if (!current) throw new Error("That package definition is unavailable.");
      const [{ count: issuedCount }] = await transaction.unsafe<{ count: number }[]>("SELECT count(*)::int AS count FROM commerce_packages WHERE tenant_id=$1 AND catalog_item_id=$2", [tenant.id, packageItemId]);
      const existing = await transaction.unsafe<{ serviceId: string; units: number; expiryDays: number | null }[]>("SELECT service_id AS \"serviceId\",included_units AS units,expires_after_days AS \"expiryDays\" FROM commerce_package_service_entitlements WHERE tenant_id=$1 AND catalog_item_id=$2", [tenant.id, packageItemId]);
      if (issuedCount > 0 && (existing.length !== 1 || existing[0].serviceId !== serviceId || existing[0].units !== units || existing[0].expiryDays !== expiryDays)) throw new Error("Service, visits, and expiry are locked after a package is issued. Create a new definition for changed terms.");
      const photoDataUrl = await cataloguePhotoFromForm(formData, current.metadata?.photoDataUrl ?? null);
      await transaction.unsafe("UPDATE commerce_catalog_items SET title=$1,price_cents=$2,is_active=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$5 AND tenant_id=$6", [title, priceCents, String(formData.get("isActive") ?? "") === "on", JSON.stringify({ ...current.metadata, photoDataUrl }), packageItemId, tenant.id]);
      if (issuedCount === 0) await transaction.unsafe("UPDATE commerce_package_service_entitlements SET service_id=$1,included_units=$2,expires_after_days=$3,updated_at=now() WHERE tenant_id=$4 AND catalog_item_id=$5", [service.id, units, expiryDays, tenant.id, packageItemId]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'package_definition.updated','commerce_catalog_item',$3,$4::jsonb)", [tenant.id, identity.id, packageItemId, JSON.stringify({ serviceId, units, priceCents, expiryDays, issuedCount })]);
    } else {
      const photoDataUrl = await cataloguePhotoFromForm(formData, null);
      const [item] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency,metadata) VALUES ($1,'package',$2,$3,$4,$5::jsonb) RETURNING id", [tenant.id, title, priceCents, settings.currency, JSON.stringify({ photoDataUrl })]);
      await transaction.unsafe("INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units,expires_after_days) VALUES ($1,$2,$3,$4,$5)", [tenant.id, item.id, service.id, units, expiryDays]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'package_definition.created','commerce_catalog_item',$3,$4::jsonb)", [tenant.id, identity.id, item.id, JSON.stringify({ serviceId, units, priceCents, expiryDays })]);
    }
  });
  revalidatePath("/app/packages");
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(tenantPath(slug, "/app/packages"));
}

export async function issueClientPackage(formData: FormData) {
  const { tenant, identity } = await managerContext();
  const customerId = String(formData.get("customerId") ?? "");
  const packageItemId = String(formData.get("packageItemId") ?? "");
  if (!customerId || !packageItemId) throw new Error("Choose a client and package.");
  const db = tenantDb(tenant);
  let issuedId = "";
  await db.begin(async (transaction) => {
    const [customer] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM customers WHERE id=$1 AND tenant_id=$2", [customerId, tenant.id]);
    const [packageItem] = await transaction.unsafe<{ title: string; priceCents: number; currency: string; photoDataUrl: string | null }[]>("SELECT title,price_cents AS \"priceCents\",currency,metadata->>'photoDataUrl' AS \"photoDataUrl\" FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='package' AND is_active=TRUE", [packageItemId, tenant.id]);
    const definitions = await transaction.unsafe<{ serviceId: string; serviceTitle: string; units: number; expiryDays: number | null }[]>("SELECT pe.service_id AS \"serviceId\",s.title AS \"serviceTitle\",pe.included_units AS units,pe.expires_after_days AS \"expiryDays\" FROM commerce_package_service_entitlements pe JOIN services s ON s.id=pe.service_id AND s.tenant_id=pe.tenant_id WHERE pe.tenant_id=$1 AND pe.catalog_item_id=$2", [tenant.id, packageItemId]);
    if (!customer || !packageItem || definitions.length === 0) throw new Error("The selected client or package is no longer available.");
    const expiryDays = Math.max(...definitions.map((item) => item.expiryDays ?? 0));
    const [issued] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_packages (tenant_id,catalog_item_id,customer_id,status,expires_at,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot) VALUES ($1,$2,$3,'active',CASE WHEN $4::int > 0 THEN now() + ($4::text || ' days')::interval ELSE NULL END,$5,$6,$7,$8) RETURNING id", [tenant.id, packageItemId, customer.id, expiryDays, packageItem.title, packageItem.priceCents, packageItem.currency, definitions[0].serviceTitle]);
    issuedId = issued.id;
    for (const definition of definitions) await transaction.unsafe("INSERT INTO commerce_entitlement_entries (tenant_id,package_id,service_id,kind,direction,units,reason,recorded_by_identity_id) VALUES ($1,$2,$3,'grant','credit',$4,'Package issued',$5)", [tenant.id, issued.id, definition.serviceId, definition.units, identity.id]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'client_package.issued','commerce_package',$3,$4::jsonb)", [tenant.id, identity.id, issued.id, JSON.stringify({ customerId, packageItemId })]);
  });
  revalidatePath("/app/packages"); revalidatePath("/app/customers");
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(slug, "/app/packages")}?package=${issuedId}`);
}
