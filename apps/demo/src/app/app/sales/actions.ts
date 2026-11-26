"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { activeAppointmentPayments } from "@/lib/waybook/appointment-payment-records";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { withSuccessToast } from "@/lib/waybook/toast";
import { giftCardCodeHashes, normaliseGiftCardCode } from "@/lib/waybook/gift-card-code";

const quantityFrom = (value: FormDataEntryValue | null) => Number(value);

export async function addProductToAppointmentSale(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to add appointment products.");

  const saleId = String(formData.get("saleId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const quantity = quantityFrom(formData.get("quantity"));
  if (!saleId || !productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Choose an active product and quantity from 1 to 99.");

  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ id: string; bookingId: string; status: string; bookingStatus: string; currency: string }[]>(
      "SELECT cs.id,cs.booking_id AS \"bookingId\",cs.status,cs.currency,b.status AS \"bookingStatus\" FROM commerce_sales cs JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id WHERE cs.id=$1 AND cs.tenant_id=$2 FOR UPDATE OF cs,b",
      [saleId, tenant.id],
    );
    const [product] = await transaction.unsafe<{ id: string; title: string; priceCents: number; currency: string }[]>(
      "SELECT id,title,price_cents AS \"priceCents\",currency FROM commerce_catalog_items WHERE id=$1 AND tenant_id=$2 AND kind='product' AND is_active=TRUE FOR SHARE",
      [productId, tenant.id],
    );
    if (!sale || !product || product.currency !== sale.currency) throw new Error("The appointment sale or product is no longer available.");
    if (sale.status !== "open" || !["confirmed", "arrived"].includes(sale.bookingStatus)) throw new Error("Products can only be added to confirmed or arrived appointments with an open sale.");
    const [line] = await transaction.unsafe<{ id: string }[]>(
      "INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity) VALUES ($1,$2,$3,'product',$4,$5,$6) RETURNING id",
      [tenant.id, sale.id, product.id, product.title, product.priceCents, quantity],
    );
    await transaction.unsafe(
      "INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'commerce.product_added',$4::jsonb)",
      [tenant.id, sale.bookingId, identity.id, JSON.stringify({ saleId: sale.id, lineId: line.id, productId: product.id, title: product.title, unitPriceCents: product.priceCents, quantity })],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'appointment_sale.product_added','commerce_sale',$3,$4::jsonb)",
      [tenant.id, identity.id, sale.id, JSON.stringify({ bookingId: sale.bookingId, lineId: line.id, productId: product.id, title: product.title, unitPriceCents: product.priceCents, quantity })],
    );
  });
  revalidatePath("/app/sales");
  revalidatePath("/app/bookings");
  revalidatePath("/app/calendars");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/sales")}?sale=${saleId}`, "Product added to sale."));
}

export async function removeProductFromAppointmentSale(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to remove appointment products.");

  const saleId = String(formData.get("saleId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ bookingId: string }[]>(`
      SELECT b.id AS "bookingId"
      FROM commerce_sales cs JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id
      WHERE cs.id=$1 AND cs.tenant_id=$2 AND cs.status='open' FOR UPDATE OF b
    `, [saleId, tenant.id]);
    if (!sale) throw new Error("The appointment sale is no longer available.");
    const [line] = await transaction.unsafe<{ id: string }[]>(`
      DELETE FROM commerce_sale_lines WHERE tenant_id=$1 AND sale_id=$2 AND id=$3 AND line_kind='product'
      RETURNING id
    `, [tenant.id, saleId, lineId]);
    if (!line) return;
    const metadata = JSON.stringify({ saleId, lineId, bookingId: sale.bookingId });
    await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'commerce.product_removed',$4::jsonb)", [tenant.id, sale.bookingId, identity.id, metadata]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'appointment_sale.product_removed','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, saleId, metadata]);
  });
  revalidatePath("/app/sales");
  revalidatePath("/app/bookings");
  revalidatePath("/app/calendars");
}

export async function redeemPackageForAppointmentSale(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to redeem appointment packages.");
  const saleId = String(formData.get("saleId") ?? "");
  const packageId = String(formData.get("packageId") ?? "");
  if (!saleId || !packageId) throw new Error("Choose an eligible client package.");
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    const [sale] = await transaction.unsafe<{ id: string; bookingId: string; customerId: string; serviceId: string; status: string; bookingStatus: string }[]>(
      "SELECT cs.id,cs.booking_id AS \"bookingId\",cs.customer_id AS \"customerId\",b.service_id AS \"serviceId\",cs.status,b.status AS \"bookingStatus\" FROM commerce_sales cs JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id WHERE cs.id=$1 AND cs.tenant_id=$2 FOR UPDATE OF cs,b",
      [saleId, tenant.id],
    );
    const [clientPackage] = await transaction.unsafe<{ id: string; title: string; remainingUnits: number }[]>(
      "SELECT cp.id,cp.title_snapshot AS title,coalesce(sum(CASE WHEN ce.direction='credit' THEN ce.units ELSE -ce.units END),0)::int AS \"remainingUnits\" FROM commerce_packages cp JOIN commerce_entitlement_entries ce ON ce.package_id=cp.id AND ce.tenant_id=cp.tenant_id WHERE cp.id=$1 AND cp.tenant_id=$2 AND cp.customer_id=$3 AND cp.status='active' AND (cp.expires_at IS NULL OR cp.expires_at > now()) GROUP BY cp.id HAVING EXISTS (SELECT 1 FROM commerce_package_service_entitlements pe WHERE pe.tenant_id=cp.tenant_id AND pe.catalog_item_id=cp.catalog_item_id AND pe.service_id=$4)",
      [packageId, tenant.id, sale?.customerId ?? "", sale?.serviceId ?? ""],
    );
    if (!sale || !clientPackage) throw new Error("That appointment or eligible package is no longer available.");
    if (sale.status !== "open" || !["confirmed", "arrived"].includes(sale.bookingStatus)) throw new Error("Packages can only be redeemed for confirmed or arrived appointments with an open sale.");
    if (clientPackage.remainingUnits < 1) throw new Error("That package has no visits remaining.");
    const [entry] = await transaction.unsafe<{ id: string }[]>(
      "INSERT INTO commerce_entitlement_entries (tenant_id,package_id,booking_id,sale_id,service_id,kind,direction,units,reason,recorded_by_identity_id) VALUES ($1,$2,$3,$4,$5,'redeem','debit',1,'Appointment package redemption',$6) RETURNING id",
      [tenant.id, clientPackage.id, sale.bookingId, sale.id, sale.serviceId, identity.id],
    );
    await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'commerce.package_redeemed',$4::jsonb)", [tenant.id, sale.bookingId, identity.id, JSON.stringify({ saleId: sale.id, packageId: clientPackage.id, entitlementEntryId: entry.id, title: clientPackage.title })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'appointment_sale.package_redeemed','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, sale.id, JSON.stringify({ bookingId: sale.bookingId, packageId: clientPackage.id, entitlementEntryId: entry.id })]);
  });
  revalidatePath("/app/sales"); revalidatePath("/app/bookings"); revalidatePath("/app/calendars"); revalidatePath("/app/packages");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/sales")}?sale=${saleId}`, "Package redeemed."));
}

export type GiftCardTenderState = { error: string | null };

export async function redeemGiftCardForAppointmentSale(_previous: GiftCardTenderState, formData: FormData): Promise<GiftCardTenderState> {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to redeem gift cards.");
  const saleId = String(formData.get("saleId") ?? "");
  const code = normaliseGiftCardCode(String(formData.get("cardCode") ?? ""));
  const amount = String(formData.get("amountDkk") ?? "").trim();
  if (!saleId || !/^[A-Z0-9-]{8,40}$/.test(code) || !/^\d+(?:[.,]\d{1,2})?$/.test(amount)) return { error: "Enter a valid gift-card number and amount." };
  const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 10_000_000) return { error: "Enter a valid gift-card amount." };
  const hashes = giftCardCodeHashes(code);
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  try { await db.begin(async transaction => {
    const [sale] = await transaction.unsafe<{ id: string; bookingId: string; customerId: string; status: string; bookingStatus: string; currency: string }[]>(
      "SELECT cs.id,cs.booking_id AS \"bookingId\",cs.customer_id AS \"customerId\",cs.status,b.status AS \"bookingStatus\",cs.currency FROM commerce_sales cs JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id WHERE cs.id=$1 AND cs.tenant_id=$2 FOR UPDATE OF cs,b", [saleId, tenant.id],
    );
    if (!sale || sale.status !== "open" || sale.currency !== "DKK" || !["confirmed", "arrived"].includes(sale.bookingStatus)) throw new Error("Gift cards can only be used for an active DKK appointment with an open sale.");
    if ((await activeAppointmentPayments(transaction, tenant.id, sale.bookingId)).length) {
      throw new Error("A payment is already recorded for this appointment.");
    }
    const [card] = await transaction.unsafe<{ id: string; ownerId: string | null; currency: string }[]>(
      "SELECT id,issued_to_customer_id AS \"ownerId\",currency FROM commerce_gift_cards WHERE tenant_id=$1 AND code_hash IN ($2,$3) AND status='active' AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", [tenant.id, ...hashes],
    );
    if (!card || card.currency !== sale.currency || (card.ownerId && card.ownerId !== sale.customerId)) throw new Error("That gift card is unavailable for this appointment.");
    const [entry] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,sale_id,booking_id,kind,direction,amount_cents,currency,reason,recorded_by_identity_id) VALUES ($1,$2,$3,$4,'redeem','debit',$5,$6,'Appointment gift-card redemption',$7) RETURNING id", [tenant.id, card.id, sale.id, sale.bookingId, amountCents, sale.currency, identity.id]);
    const [saleTransaction] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_sale_transactions (tenant_id,sale_id,kind,method,amount_cents,currency,recorded_by_identity_id) VALUES ($1,$2,'payment','gift_card',$3,$4,$5) RETURNING id", [tenant.id, sale.id, amountCents, sale.currency, identity.id]);
    await transaction.unsafe("INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method,recorded_by_identity_id,gift_card_entry_id,gift_card_sale_transaction_id) VALUES ($1,$2,'payment',$3,'gift_card',$4,$5,$6)", [tenant.id, sale.bookingId, amountCents, identity.id, entry.id, saleTransaction.id]);
    await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'payment.gift_card',$4::jsonb)", [tenant.id, sale.bookingId, identity.id, JSON.stringify({ amountCents })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'appointment_sale.gift_card_redeemed','commerce_sale',$3,$4::jsonb)", [tenant.id, identity.id, sale.id, JSON.stringify({ bookingId: sale.bookingId, giftCardId: card.id, amountCents })]);
  }); } catch {
    return { error: "The gift card could not be used. Check the card, its owner and balance, and the appointment amount." };
  }
  revalidatePath("/app/sales"); revalidatePath("/app/bookings"); revalidatePath("/app/calendars"); revalidatePath("/app/gift-cards");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/sales")}?sale=${saleId}`, "Gift card redeemed."));
}
