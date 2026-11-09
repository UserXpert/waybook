"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

const quantityFrom = (value: FormDataEntryValue | null) => Number.parseInt(String(value ?? ""), 10);

async function managerCommerceContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to manage checkout.");
  return { tenant, identity: await requireIdentity() };
}

export async function createRetailCheckout(formData: FormData) {
  const { tenant, identity } = await managerCommerceContext();
  const customerId = String(formData.get("customerId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const quantity = quantityFrom(formData.get("quantity"));
  if (!customerId || !productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Choose a client, product, and quantity from 1 to 99.");

  const db = tenantDb(tenant);
  const [saleId] = await db.begin(async (transaction) => {
    const [customer] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM customers WHERE id=$1 AND tenant_id=$2", [customerId, tenant.id]);
    const [product] = await transaction.unsafe<{ id: string; title: string; priceCents: number }[]>("SELECT id, title, price_cents AS \"priceCents\" FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='product' AND is_active=TRUE", [productId, tenant.id]);
    const [settings] = await transaction.unsafe<{ currency: string }[]>("SELECT currency FROM tenant_settings WHERE tenant_id=$1", [tenant.id]);
    if (!customer || !product || !settings) throw new Error("The selected client or product is no longer available.");
    const [sale] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_sales (tenant_id, customer_id, status, currency, opened_by_identity_id) VALUES ($1,$2,'draft',$3,$4) RETURNING id", [tenant.id, customer.id, settings.currency, identity.id]);
    await transaction.unsafe("INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity) VALUES ($1,$2,$3,'product',$4,$5,$6)", [tenant.id, sale.id, product.id, product.title, product.priceCents, quantity]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.created','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, sale.id, JSON.stringify({ customerId, productId, quantity })]);
    return [sale.id] as const;
  });
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/sales/retail")}?sale=${saleId}`);
}

export async function addProductToRetailCheckout(formData: FormData) {
  const { tenant, identity } = await managerCommerceContext();
  const saleId = String(formData.get("saleId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const quantity = quantityFrom(formData.get("quantity"));
  if (!saleId || !productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Choose an active product and quantity from 1 to 99.");
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM commerce_sales WHERE id=$1 AND tenant_id=$2 AND status='draft'", [saleId, tenant.id]);
    const [product] = await transaction.unsafe<{ id: string; title: string; priceCents: number }[]>("SELECT id, title, price_cents AS \"priceCents\" FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='product' AND is_active=TRUE", [productId, tenant.id]);
    if (!sale || !product) throw new Error("This draft checkout or product is no longer available.");
    await transaction.unsafe("INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity) VALUES ($1,$2,$3,'product',$4,$5,$6)", [tenant.id, sale.id, product.id, product.title, product.priceCents, quantity]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.line_added','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, sale.id, JSON.stringify({ productId, quantity })]);
  });
  revalidatePath("/app/sales/retail");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/sales/retail")}?sale=${saleId}`);
}

/** Records one exact manual tender and closes the draft atomically. Refunds are
 * intentionally a later append-only flow, never an edit of this payment. */
export async function closeRetailCheckout(formData: FormData) {
  const { tenant, identity } = await managerCommerceContext();
  const saleId = String(formData.get("saleId") ?? "");
  const method = String(formData.get("method") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!saleId || !["card", "cash", "bank_transfer", "other"].includes(method) || (notes?.length ?? 0) > 500) throw new Error("Choose a payment method and keep the optional note under 500 characters.");
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ id: string; status: string; currency: string }[]>("SELECT id,status,currency FROM commerce_sales WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [saleId, tenant.id]);
    if (!sale || sale.status !== "draft") throw new Error("Only an open draft checkout can be collected.");
    const [total] = await transaction.unsafe<{ cents: number }[]>("SELECT coalesce(sum((unit_price_cents * quantity) - discount_cents),0)::int AS cents FROM commerce_sale_lines WHERE sale_id=$1 AND tenant_id=$2", [sale.id, tenant.id]);
    if (!total || total.cents <= 0) throw new Error("Add at least one priced item before collecting payment.");
    await transaction.unsafe("INSERT INTO commerce_sale_transactions (tenant_id,sale_id,kind,method,amount_cents,currency,notes,recorded_by_identity_id) VALUES ($1,$2,'payment',$3,$4,$5,$6,$7)", [tenant.id, sale.id, method, total.cents, sale.currency, notes, identity.id]);
    await transaction.unsafe("UPDATE commerce_sales SET status='closed',closed_by_identity_id=$1,closed_at=now(),updated_at=now() WHERE id=$2 AND tenant_id=$3", [identity.id, sale.id, tenant.id]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.closed','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, sale.id, JSON.stringify({ method, amountCents: total.cents })]);
  });
  revalidatePath("/app/sales/retail");
  revalidatePath("/app/sales");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/sales/retail")}?sale=${saleId}`);
}
