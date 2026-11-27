import type { tenantDb } from "./database";

export const manualPaymentMethods = ["card", "cash", "bank_transfer", "other"] as const;
export const paymentMethodLabels: Record<string, string> = {
  card: "Card", cash: "Cash", bank_transfer: "Bank transfer", other: "Other", gift_card: "Gift card",
};

export type RecordedAppointmentPayment = { id: string; amountCents: number; method: string; revision: string | null; stripeSandbox?: boolean };

/** Payment corrections are recorded in booking history and linked to any ledger adjustment. */
export function activeAppointmentPayments(db: Pick<ReturnType<typeof tenantDb>, "unsafe">, tenantId: string, bookingId: string) {
  return db.unsafe<RecordedAppointmentPayment[]>(`
    SELECT p.id, coalesce((edit.metadata->>'amountCents')::int, p.amount_cents) AS "amountCents",
      coalesce(edit.metadata->>'method', p.method) AS method, edit.id AS revision,
      EXISTS (SELECT 1 FROM booking_events e WHERE e.tenant_id = p.tenant_id AND e.booking_id = p.booking_id
        AND e.event_type = 'payment.payment' AND e.metadata->>'paymentId' = p.id::text
        AND e.metadata->>'source' = 'stripe_sandbox') AS "stripeSandbox"
    FROM payment_records p
    LEFT JOIN LATERAL (
      SELECT id, event_type, metadata FROM booking_events
      WHERE tenant_id = p.tenant_id AND booking_id = p.booking_id
        AND event_type IN ('payment.corrected', 'payment.deleted')
        AND metadata->>'paymentId' = p.id::text
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) edit ON true
    WHERE p.tenant_id = $1 AND p.booking_id = $2 AND p.kind = 'payment'
      AND edit.event_type IS DISTINCT FROM 'payment.deleted'
      AND NOT EXISTS (
        SELECT 1 FROM booking_events e
        WHERE e.tenant_id = p.tenant_id AND e.booking_id = p.booking_id
          AND (
            (e.event_type IN ('payment.corrected', 'payment.deleted') AND e.metadata->>'adjustmentId' = p.id::text)
            OR (e.event_type = 'payment.refund_returned' AND e.metadata->>'paymentId' = p.id::text)
          )
      )
      AND (p.method <> 'gift_card' OR NOT EXISTS (
        SELECT 1 FROM payment_records r
        WHERE r.tenant_id = p.tenant_id AND r.booking_id = p.booking_id
          AND r.method = 'gift_card' AND r.kind = 'refund'
      ))
    ORDER BY p.recorded_at DESC, p.id DESC
  `, [tenantId, bookingId]);
}
