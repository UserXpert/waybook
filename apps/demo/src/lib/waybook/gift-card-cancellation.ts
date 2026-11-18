import "server-only";
import type { tenantDb } from "./database";

type Sql = ReturnType<typeof tenantDb>;

/** Called inside the cancellation transaction after the booking is locked. */
export async function refundGiftCardOnCancellation(db: Sql, tenantId: string, bookingId: string, actorId: string | null) {
  const [redemption] = await db<{ cardId: string; saleId: string; currency: string; amountCents: number }[]>`
    SELECT gift_card_id AS "cardId", sale_id AS "saleId", currency, amount_cents AS "amountCents"
    FROM commerce_gift_card_entries WHERE tenant_id=${tenantId} AND booking_id=${bookingId} AND kind='redeem'
  `;
  if (!redemption) return;
  const [existing] = await db<{ id: string }[]>`
    SELECT id FROM commerce_gift_card_entries WHERE tenant_id=${tenantId} AND booking_id=${bookingId} AND kind='refund'
  `;
  if (existing) return;
  const [card] = await db<{ status: string; expiresAt: Date | null; expired: boolean }[]>`
    SELECT status,expires_at AS "expiresAt",coalesce(expires_at<=now(),false) AS expired
    FROM commerce_gift_cards WHERE tenant_id=${tenantId} AND id=${redemption.cardId} FOR UPDATE
  `;
  if (!card) throw new Error("The original gift card is unavailable for the cancellation refund.");
  if (card.status !== "active" || card.expired) {
    await db`UPDATE commerce_gift_cards SET status='active',expires_at=NULL WHERE tenant_id=${tenantId} AND id=${redemption.cardId}`;
    await db`INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata)
      VALUES (${tenantId},${actorId},'gift_card.reactivated_for_refund','commerce_gift_card',${redemption.cardId},${JSON.stringify({ bookingId, previousStatus: card.status, previousExpiresAt: card.expiresAt })}::jsonb)`;
  }
  const [entry] = await db<{ id: string }[]>`
    INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,sale_id,booking_id,kind,direction,amount_cents,currency,reason,recorded_by_identity_id)
    VALUES (${tenantId},${redemption.cardId},${redemption.saleId},${bookingId},'refund','credit',${redemption.amountCents},${redemption.currency},'Appointment cancellation refund',${actorId}) RETURNING id
  `;
  const [saleTransaction] = await db<{ id: string }[]>`
    INSERT INTO commerce_sale_transactions (tenant_id,sale_id,kind,method,amount_cents,currency,recorded_by_identity_id)
    VALUES (${tenantId},${redemption.saleId},'refund','gift_card',${redemption.amountCents},${redemption.currency},${actorId}) RETURNING id
  `;
  await db`INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method,recorded_by_identity_id,gift_card_entry_id,gift_card_sale_transaction_id)
    VALUES (${tenantId},${bookingId},'refund',${redemption.amountCents},'gift_card',${actorId},${entry.id},${saleTransaction.id})`;
  await db`INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata)
    VALUES (${tenantId},${bookingId},${actorId},'payment.gift_card_refund',${JSON.stringify({ amountCents: redemption.amountCents })}::jsonb)`;
  await db`INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata)
    VALUES (${tenantId},${actorId},'appointment_sale.gift_card_refunded','commerce_sale',${redemption.saleId},${JSON.stringify({ bookingId, giftCardId: redemption.cardId, amountCents: redemption.amountCents })}::jsonb)`;
}
