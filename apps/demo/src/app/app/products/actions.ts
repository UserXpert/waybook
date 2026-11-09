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

export async function saveProduct(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) throw new Error("You do not have permission to manage products.");

  const id = String(formData.get("productId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase() || null;
  const priceDkk = Number(String(formData.get("priceDkk") ?? "").replace(",", "."));
  const priceCents = Math.round(priceDkk * 100);
  const isActive = String(formData.get("isActive") ?? "") === "on";
  if (!title || title.length > 140 || (description?.length ?? 0) > 1000 || (sku?.length ?? 0) > 80 || !Number.isFinite(priceDkk) || !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 10_000_000) {
    throw new Error("Enter a product name, a valid price, and an optional SKU or description within the allowed length.");
  }

  const db = tenantDb(tenant);
  const identity = await requireIdentity();
  let productId = id;
  try {
    await db.begin(async (transaction) => {
      if (id) {
        const [current] = await transaction.unsafe<{ metadata: { photoDataUrl?: string } }[]>(
          "SELECT metadata FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='product' FOR UPDATE",
          [id, tenant.id],
        );
        if (!current) throw new Error("Product is unavailable.");
        const photoDataUrl = await cataloguePhotoFromForm(formData, current.metadata?.photoDataUrl ?? null);
        const [product] = await transaction.unsafe<{ id: string }[]>(
          "UPDATE commerce_catalog_items SET title=$1, description=$2, sku=$3, price_cents=$4, is_active=$5, metadata=$6::jsonb, updated_at=now() WHERE id=$7 AND tenant_id=$8 AND kind='product' RETURNING id",
          [title, description, sku, priceCents, isActive, JSON.stringify({ ...current.metadata, photoDataUrl }), id, tenant.id],
        );
        if (!product) throw new Error("Product is unavailable.");
      } else {
        const [settings] = await transaction.unsafe<{ currency: string }[]>("SELECT currency FROM tenant_settings WHERE tenant_id=$1", [tenant.id]);
        if (!settings) throw new Error("Tenant settings are unavailable.");
        const photoDataUrl = await cataloguePhotoFromForm(formData, null);
        const [product] = await transaction.unsafe<{ id: string }[]>(
          "INSERT INTO commerce_catalog_items (tenant_id,kind,title,description,sku,price_cents,currency,metadata) VALUES ($1,'product',$2,$3,$4,$5,$6,$7::jsonb) RETURNING id",
          [tenant.id, title, description, sku, priceCents, settings.currency, JSON.stringify({ photoDataUrl })],
        );
        productId = product.id;
      }
      await transaction.unsafe(
        "INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,$3,'catalog_product',$4,$5::jsonb)",
        [tenant.id, identity.id, id ? "product.updated" : "product.created", productId, JSON.stringify({ title, sku, priceCents, isActive })],
      );
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new Error("That SKU already belongs to another product in this workspace.");
    throw error;
  }
  revalidatePath("/app/products");
  revalidatePath("/app/sales");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/products")}?product=${productId}`);
}
