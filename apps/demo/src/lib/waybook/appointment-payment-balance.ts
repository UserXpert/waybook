import { activeAppointmentPayments, type RecordedAppointmentPayment } from "./appointment-payment-records";
import type { tenantDb } from "./database";

export type AppointmentPaymentBalance = { outstandingCents: number; refundableCents: number; packageRedeemed: boolean; payments: RecordedAppointmentPayment[] };

export async function getAppointmentPaymentBalance(db: ReturnType<typeof tenantDb>, tenantId: string, bookingId: string) {
  const [[balance], payments] = await Promise.all([
    db<Omit<AppointmentPaymentBalance, "payments">[]>`
    SELECT CASE WHEN b.status = 'cancelled' THEN 0
        ELSE greatest(cart.chargeable_cents - payment.net, 0) END::int AS "outstandingCents",
      greatest(payment.regular_net, 0)::int AS "refundableCents", cart.package_redeemed AS "packageRedeemed"
    FROM bookings b
    CROSS JOIN LATERAL appointment_checkout_amounts(b.tenant_id, b.id) cart
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0) AS net,
        coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END)
          FILTER (WHERE method <> 'gift_card'), 0) AS regular_net
      FROM payment_records WHERE tenant_id = b.tenant_id AND booking_id = b.id
    ) payment
    WHERE b.tenant_id = ${tenantId} AND b.id = ${bookingId}
  `, activeAppointmentPayments(db, tenantId, bookingId)]);
  return balance ? { ...balance, refundableCents: payments.some((payment) => payment.stripeMode) ? 0 : balance.refundableCents, payments } : null;
}

/** Check completion inside the status transaction without exposing the payment ledger. */
export async function canCompleteNoShow(db: Pick<ReturnType<typeof tenantDb>, "unsafe">, tenantId: string, bookingId: string) {
  const [booking] = await db.unsafe<{ eligible: boolean }[]>(`
    SELECT (
      cart.chargeable_cents = 0 OR coalesce((
        SELECT sum(CASE pr.kind WHEN 'payment' THEN pr.amount_cents ELSE -pr.amount_cents END)
        FROM payment_records pr WHERE pr.tenant_id = b.tenant_id AND pr.booking_id = b.id
      ), 0) > 0
    ) AS eligible
    FROM bookings b
    CROSS JOIN LATERAL appointment_checkout_amounts(b.tenant_id, b.id) cart
    WHERE b.tenant_id = $1 AND b.id = $2
  `, [tenantId, bookingId]);
  return booking?.eligible ?? false;
}
