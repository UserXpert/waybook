import type { tenantDb } from "./database";

type SaleItemContext = { db: ReturnType<typeof tenantDb>; tenantId: string };
type SaleLine = { id: string; title: string; unitPriceCents: number; quantity: number; discountCents: number };
type PaymentItem = {
  id: string;
  kind: "payment" | "refund";
  amountCents: number;
  method: string;
  recordedAt: Date;
  adjustment: boolean;
};

export function getAppointmentSaleProducts({ db, tenantId }: SaleItemContext, saleId: string) {
  return db<SaleLine[]>`
    SELECT id,title_snapshot AS title,unit_price_cents AS "unitPriceCents",quantity,discount_cents AS "discountCents"
    FROM commerce_sale_lines WHERE tenant_id=${tenantId} AND sale_id=${saleId} AND line_kind='product'
    ORDER BY created_at, id
  `;
}

export function getAppointmentSalePayments({ db, tenantId }: SaleItemContext, bookingId: string) {
  return db<PaymentItem[]>`
    SELECT p.id, p.kind, p.amount_cents AS "amountCents", p.method, p.recorded_at AS "recordedAt",
      EXISTS(SELECT 1 FROM booking_events e WHERE e.tenant_id = p.tenant_id AND e.booking_id = p.booking_id
        AND e.event_type IN ('payment.corrected', 'payment.deleted') AND e.metadata->>'adjustmentId' = p.id::text) AS adjustment
    FROM payment_records p WHERE p.tenant_id = ${tenantId} AND p.booking_id = ${bookingId}
    ORDER BY p.recorded_at DESC, p.id DESC
  `;
}
