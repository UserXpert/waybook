"use server";

import { createHash, createHmac } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { cataloguePhotoFromForm } from "@/lib/waybook/catalogue-media";

const amountFrom = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? "").replace(",", ".")) * 100);
const normaliseCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
function giftCardCodeHash(code: string) {
  const secret = process.env.WAYBOOK_GIFT_CARD_CODE_SECRET;
  if (secret) return createHmac("sha256", secret).update(code).digest("hex");
  if (process.env.NODE_ENV !== "production") return createHmac("sha256", "waybook-local-development-gift-card-secret").update(code).digest("hex");
  throw new Error("Gift cards require WAYBOOK_GIFT_CARD_CODE_SECRET in production.");
}

export async function issueGiftCard(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to issue gift cards.");

  const code = normaliseCode(String(formData.get("code") ?? ""));
  const ownerId = String(formData.get("ownerId") ?? "") || null;
  const amountCents = amountFrom(formData.get("amountDkk"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!/^[A-Z0-9-]{8,40}$/.test(code) || !Number.isFinite(amountCents) || amountCents < 100 || amountCents > 10_000_000 || (notes?.length ?? 0) > 500) {
    throw new Error("Enter an 8–40 character gift-card number, a balance from 1 to 100,000 kr., and an optional note under 500 characters.");
  }
  const lastFour = code.replaceAll("-", "").slice(-4);
  if (lastFour.length !== 4) throw new Error("The gift-card number needs at least four letters or digits.");

  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  let cardId = "";
  try {
    await db.begin(async (transaction) => {
      if (ownerId) {
        const [owner] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM customers WHERE id=$1 AND tenant_id=$2", [ownerId, tenant.id]);
        if (!owner) throw new Error("That client is no longer available.");
      }
      const [settings] = await transaction.unsafe<{ currency: string }[]>("SELECT currency FROM tenant_settings WHERE tenant_id=$1", [tenant.id]);
      if (!settings) throw new Error("Tenant settings are unavailable.");
      const hash = giftCardCodeHash(code);
      const legacyHash = createHash("sha256").update(code).digest("hex");
      const [existing] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM commerce_gift_cards WHERE tenant_id=$1 AND code_hash IN ($2,$3) LIMIT 1", [tenant.id, hash, legacyHash]);
      if (existing) throw new Error("That gift-card number already exists in this workspace.");
      const [card] = await transaction.unsafe<{ id: string }[]>("INSERT INTO commerce_gift_cards (tenant_id,issued_to_customer_id,code_hash,code_hash_version,code_last_four,currency) VALUES ($1,$2,$3,2,$4,$5) RETURNING id", [tenant.id, ownerId, hash, lastFour, settings.currency]);
      cardId = card.id;
      await transaction.unsafe("INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason,recorded_by_identity_id) VALUES ($1,$2,'issue','credit',$3,$4,$5,$6)", [tenant.id, card.id, amountCents, settings.currency, notes || "Gift card issued", identity.id]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'gift_card.issued','commerce_gift_card',$3,$4::jsonb)", [tenant.id, identity.id, card.id, JSON.stringify({ ownerId, amountCents, lastFour })]);
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new Error("That gift-card number already exists in this workspace.");
    throw error;
  }
  revalidatePath("/app/gift-cards");
  revalidatePath("/app/customers");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/gift-cards")}?card=${cardId}`);
}

export async function updateGiftCardDetails(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to edit gift cards.");

  const cardId = String(formData.get("cardId") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim();
  if (!cardId || notes.length > 500) throw new Error("Enter an internal note under 500 characters.");

  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (transaction) => {
    if (ownerId) {
      const [owner] = await transaction.unsafe<{ id: string }[]>("SELECT id FROM customers WHERE id=$1 AND tenant_id=$2", [ownerId, tenant.id]);
      if (!owner) throw new Error("That client is no longer available.");
    }
    const [card] = await transaction.unsafe<{ metadata: { notes?: string; photoDataUrl?: string } }[]>(
      "SELECT metadata FROM commerce_gift_cards WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [cardId, tenant.id],
    );
    if (!card) throw new Error("That gift card is unavailable.");
    const photoDataUrl = await cataloguePhotoFromForm(formData, card.metadata?.photoDataUrl ?? null);
    await transaction.unsafe(
      "UPDATE commerce_gift_cards SET issued_to_customer_id=$1,metadata=$2::jsonb WHERE id=$3 AND tenant_id=$4",
      [ownerId, JSON.stringify({ ...card.metadata, notes, photoDataUrl }), cardId, tenant.id],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'gift_card.details_updated','commerce_gift_card',$3,$4::jsonb)",
      [tenant.id, identity.id, cardId, JSON.stringify({ ownerId, notesChanged: notes !== (card.metadata?.notes ?? ""), photoChanged: photoDataUrl !== (card.metadata?.photoDataUrl ?? null) })],
    );
  });
  revalidatePath("/app/gift-cards");
  revalidatePath("/app/customers");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(tenantSlug, "/app/gift-cards")}?card=${cardId}`);
}
