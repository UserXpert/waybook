import type { tenantDb } from "./database";

export type AppointmentPaymentBalance = { outstandingCents: number; refundableCents: number };

export async function getAppointmentPaymentBalance(db: ReturnType<typeof tenantDb>, tenantId: string, bookingId: string) {
  const [balance] = await db<AppointmentPaymentBalance[]>`
    SELECT CASE WHEN b.status = 'cancelled' OR EXISTS (
        SELECT 1 FROM commerce_entitlement_entries ce
        WHERE ce.tenant_id = b.tenant_id AND ce.booking_id = b.id AND ce.kind = 'redeem' AND ce.package_id IS NOT NULL
      ) THEN 0 ELSE greatest(b.booked_price_cents - payment.net, 0) END::int AS "outstandingCents",
      greatest(payment.regular_net, 0)::int AS "refundableCents"
    FROM bookings b
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0) AS net,
        coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END)
          FILTER (WHERE method <> 'gift_card'), 0) AS regular_net
      FROM payment_records WHERE tenant_id = b.tenant_id AND booking_id = b.id
    ) payment
    WHERE b.tenant_id = ${tenantId} AND b.id = ${bookingId}
  `;
  return balance ?? null;
}
