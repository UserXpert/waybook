"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { assertNoOperationalFreeText } from "@/lib/waybook/operations-only-fields";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { withSuccessToast } from "@/lib/waybook/toast";

export type RetailCheckoutResult = { href: string } | { error: string };
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const valueFrom = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const validQuantity = (quantity: number) => Number.isInteger(quantity) && quantity >= 1 && quantity <= 99;

async function managerCommerceContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to manage checkout.");
  return { tenant, identity: await requireIdentity() };
}

async function checkoutSaved(tenant: Awaited<ReturnType<typeof managerCommerceContext>>["tenant"], saleId: string, message: string, page = ""): Promise<RetailCheckoutResult> {
  revalidatePath("/app/sales/retail");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const params = new URLSearchParams();
  if (/^[1-9]\d{0,8}$/.test(page) && page !== "1") params.set("page", page);
  params.set("sale", saleId);
  return { href: withSuccessToast(`${tenantPath(tenantSlug, "/app/sales/retail")}?${params}`, message) };
}

export async function createRetailCheckout(formData: FormData): Promise<RetailCheckoutResult> {
  const { tenant, identity } = await managerCommerceContext();
  const saleId = valueFrom(formData, "entryId");
  const customerId = valueFrom(formData, "customerId");
  const productId = valueFrom(formData, "productId");
  const quantity = Number(valueFrom(formData, "quantity"));
  if (![saleId, customerId, productId].every((id) => uuidPattern.test(id)) || !validQuantity(quantity)) {
    return { error: "Choose a contact, product, and quantity from 1 to 99." };
  }

  const db = tenantDb(tenant);
  const saved = await db.begin(async (transaction) => {
    const [source] = await transaction.unsafe<{ title: string; priceCents: number; currency: string }[]>(`
      SELECT product.title, product.price_cents AS "priceCents", settings.currency
      FROM commerce_catalog_items product
      JOIN tenant_settings settings ON settings.tenant_id = product.tenant_id
      JOIN customers customer ON customer.tenant_id = product.tenant_id AND customer.id = $3
      WHERE product.id = $1 AND product.tenant_id = $2 AND product.kind = 'product' AND product.is_active
    `, [productId, tenant.id, customerId]);
    if (source) {
      const [inserted] = await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO commerce_sales (id, tenant_id, customer_id, status, currency, opened_by_identity_id)
        VALUES ($1,$2,$3,'draft',$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id
      `, [saleId, tenant.id, customerId, source.currency, identity.id]);
      if (inserted) {
        await transaction.unsafe(`
          INSERT INTO commerce_sale_lines (id,tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity)
          VALUES ($1,$2,$1,$3,'product',$4,$5,$6)
        `, [saleId, tenant.id, productId, source.title, source.priceCents, quantity]);
        await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.created','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, saleId, { customerId, productId, quantity }]);
        return true;
      }
    }
    // The first line uses the draft ID so an interrupted create can be verified after a catalogue change.
    const [prior] = await transaction.unsafe<{ id: string }[]>(`
      SELECT sale.id FROM commerce_sales sale
      JOIN commerce_sale_lines line ON line.id=sale.id AND line.sale_id=sale.id AND line.tenant_id=sale.tenant_id
      WHERE sale.id=$1 AND sale.tenant_id=$2 AND sale.customer_id=$3 AND sale.booking_id IS NULL
        AND sale.opened_by_identity_id=$4 AND line.catalog_item_id=$5 AND line.quantity=$6
    `, [saleId, tenant.id, customerId, identity.id, productId, quantity]);
    return Boolean(prior);
  });
  return saved
    ? checkoutSaved(tenant, saleId, "Retail checkout created.")
    : { error: "The selected contact or product is no longer available." };
}

export async function addProductToRetailCheckout(formData: FormData): Promise<RetailCheckoutResult> {
  const { tenant, identity } = await managerCommerceContext();
  const entryId = valueFrom(formData, "entryId");
  const saleId = valueFrom(formData, "saleId");
  const productId = valueFrom(formData, "productId");
  const quantity = Number(valueFrom(formData, "quantity"));
  if (![entryId, saleId, productId].every((id) => uuidPattern.test(id)) || !validQuantity(quantity)) {
    return { error: "Choose an active product and quantity from 1 to 99." };
  }

  const db = tenantDb(tenant);
  const saved = await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ status: string }[]>(
      "SELECT status FROM commerce_sales WHERE id=$1 AND tenant_id=$2 AND booking_id IS NULL AND NOT is_stripe_practice FOR UPDATE", [saleId, tenant.id],
    );
    if (!sale) return false;
    const [prior] = await transaction.unsafe<{ matches: boolean }[]>(`
      SELECT (sale_id=$2 AND catalog_item_id=$3 AND quantity=$4) AS matches
      FROM commerce_sale_lines WHERE id=$1 AND tenant_id=$5
    `, [entryId, saleId, productId, quantity, tenant.id]);
    if (prior) return prior.matches;
    if (sale.status !== "draft") return false;
    const [product] = await transaction.unsafe<{ title: string; priceCents: number }[]>(
      'SELECT title, price_cents AS "priceCents" FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind=\'product\' AND is_active',
      [productId, tenant.id],
    );
    if (!product) return false;
    await transaction.unsafe("INSERT INTO commerce_sale_lines (id,tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity) VALUES ($1,$2,$3,$4,'product',$5,$6,$7)", [entryId, tenant.id, saleId, productId, product.title, product.priceCents, quantity]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.line_added','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, saleId, { productId, quantity }]);
    return true;
  });
  return saved
    ? checkoutSaved(tenant, saleId, "Product added to checkout.", valueFrom(formData, "page"))
    : { error: "This draft checkout or product is no longer available." };
}

/** Records one exact manual tender and closes the draft atomically. */
export async function closeRetailCheckout(formData: FormData): Promise<RetailCheckoutResult> {
  const { tenant, identity } = await managerCommerceContext();
  const entryId = valueFrom(formData, "entryId");
  const saleId = valueFrom(formData, "saleId");
  const method = valueFrom(formData, "method");
  const expectedTotal = Number(valueFrom(formData, "totalCents"));
  assertNoOperationalFreeText(formData, "notes");
  if (![entryId, saleId].every((id) => uuidPattern.test(id)) || !Number.isSafeInteger(expectedTotal) || expectedTotal <= 0
    || !["card", "cash", "bank_transfer", "other"].includes(method)) {
    return { error: "Choose a checkout with a positive total and a payment method." };
  }

  const db = tenantDb(tenant);
  const error = await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ status: string; currency: string }[]>(
      "SELECT status,currency FROM commerce_sales WHERE id=$1 AND tenant_id=$2 AND booking_id IS NULL AND NOT is_stripe_practice FOR UPDATE", [saleId, tenant.id],
    );
    if (sale?.status === "closed") {
      const [prior] = await transaction.unsafe<{ id: string }[]>(`
        SELECT id FROM commerce_sale_transactions WHERE tenant_id=$1 AND sale_id=$2 AND id=$3
          AND kind='payment' AND method=$4 AND amount_cents=$5 AND recorded_by_identity_id=$6
      `, [tenant.id, saleId, entryId, method, expectedTotal, identity.id]);
      return prior ? null : "This checkout has already been collected. Reopen it to review the payment.";
    }
    if (sale?.status !== "draft") return "Only an open draft checkout can be collected.";
    const [total] = await transaction.unsafe<{ cents: number }[]>(`
      SELECT coalesce(sum((unit_price_cents * quantity) - discount_cents),0)::int AS cents
      FROM commerce_sale_lines WHERE sale_id=$1 AND tenant_id=$2
    `, [saleId, tenant.id]);
    if (total.cents !== expectedTotal) return "The total changed. Refresh the checkout before collecting payment.";
    await transaction.unsafe("INSERT INTO commerce_sale_transactions (id,tenant_id,sale_id,kind,method,amount_cents,currency,recorded_by_identity_id) VALUES ($1,$2,$3,'payment',$4,$5,$6,$7)", [entryId, tenant.id, saleId, method, total.cents, sale.currency, identity.id]);
    await transaction.unsafe("UPDATE commerce_sales SET status='closed',closed_by_identity_id=$1,closed_at=now(),updated_at=now() WHERE id=$2 AND tenant_id=$3", [identity.id, saleId, tenant.id]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'retail_checkout.closed','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, saleId, { method, amountCents: total.cents }]);
    return null;
  });
  if (error) return { error };
  revalidatePath("/app/sales");
  return checkoutSaved(tenant, saleId, "Payment collected.", valueFrom(formData, "page"));
}
