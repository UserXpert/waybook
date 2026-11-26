import "server-only";

import type { tenantDb } from "./database";
import { appointmentStripeAccount } from "./stripe-appointment-checkout";
import type { StripeSandboxConfig } from "./stripe-connect-api";
import { stripeRefundSandbox, type SandboxRefund, type SandboxRefundAttempt } from "./stripe-refund-api";

type Database = ReturnType<typeof tenantDb>;
type Context = { db: Database; tenantId: string; bookingId: string };
type Query = Pick<Database, "unsafe">;
type StoredRefund = SandboxRefundAttempt & {
  actorId: string;
  refundId: string | null;
  state: SandboxRefund["state"];
  retryable: boolean;
};
type PaidCheckout = { id: string; accountId: string; paymentIntentId: string };

async function lockBooking(sql: Query, { tenantId, bookingId }: Context) {
  const [booking] = await sql.unsafe<{ status: string }[]>("SELECT status FROM bookings WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenantId, bookingId]);
  if (!booking) throw new Error("Appointment is unavailable.");
  return booking;
}

async function paidCheckout(sql: Query, { tenantId, bookingId }: Context) {
  const [checkout] = await sql.unsafe<PaidCheckout[]>(`
    SELECT id, account_id AS "accountId", payment_intent_id AS "paymentIntentId"
    FROM stripe_sandbox_checkout_attempts
    WHERE tenant_id = $1 AND booking_id = $2 AND state = 'settled'
  `, [tenantId, bookingId]);
  return checkout;
}

async function remainingRefund(sql: Query, { tenantId, bookingId }: Context) {
  const [row] = await sql.unsafe<{ cents: number }[]>(`
    SELECT greatest(coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0), 0)::int AS cents
    FROM payment_records WHERE tenant_id = $1 AND booking_id = $2
  `, [tenantId, bookingId]);
  return row.cents;
}

async function refundAttempt(sql: Query, payment: PaidCheckout, id: string | null) {
  const [attempt] = await sql.unsafe<Omit<StoredRefund, "accountId" | "paymentIntentId">[]>(`
    SELECT id, amount_cents AS "amountCents", created_by_identity_id AS "actorId", refund_id AS "refundId",
           state, created_at > now() - interval '20 hours' AS retryable
    FROM stripe_sandbox_refund_attempts
    WHERE payment_attempt_id = $1 AND ($2::uuid = id OR ($2::uuid IS NULL AND state = 'pending'))
  `, [payment.id, id]);
  return attempt ? { ...attempt, accountId: payment.accountId, paymentIntentId: payment.paymentIntentId } : null;
}

export async function stripeAppointmentRefundDetails(context: Context) {
  const paid = await paidCheckout(context.db, context);
  if (!paid) return null;
  const [remainingCents, pending] = await Promise.all([
    remainingRefund(context.db, context),
    refundAttempt(context.db, paid, null),
  ]);
  return { remainingCents, pendingCents: pending?.amountCents ?? null };
}

type RefundInput = { action: "start" | "check"; id: string; amountCents: number; expectedCents: number; actorId: string };

async function reserveRefund(context: Context, accountId: string, input: RefundInput) {
  return context.db.begin(async (sql) => {
    const booking = await lockBooking(sql, context);
    const paid = await paidCheckout(sql, context);
    if (paid?.accountId !== accountId) throw new Error("The original Stripe sandbox account is unavailable.");
    if (input.action === "check") return refundAttempt(sql, paid, null);
    const repeated = await refundAttempt(sql, paid, input.id);
    if (repeated) {
      if (repeated.amountCents !== input.amountCents || repeated.actorId !== input.actorId) {
        throw new Error("This refund does not match the original request.");
      }
      return repeated;
    }
    if (!["completed", "cancelled"].includes(booking.status)) {
      throw new Error("Finish checkout before refunding the Stripe payment.");
    }
    if (await refundAttempt(sql, paid, null)) throw new Error("A refund is already pending. Check its status before starting another.");
    const remaining = await remainingRefund(sql, context);
    if (remaining !== input.expectedCents || !Number.isSafeInteger(input.amountCents) ||
        input.amountCents < 1 || input.amountCents > remaining) {
      throw new Error("Review the remaining refundable amount before submitting.");
    }
    await sql.unsafe(`
      INSERT INTO stripe_sandbox_refund_attempts (id, payment_attempt_id, amount_cents, created_by_identity_id)
      VALUES ($1, $2, $3, $4)
    `, [input.id, paid.id, input.amountCents, input.actorId]);
    return refundAttempt(sql, paid, input.id);
  });
}

async function reconcileRefund(context: Context, attempt: StoredRefund, refund: SandboxRefund) {
  const { tenantId, bookingId } = context;
  return context.db.begin(async (sql) => {
    await lockBooking(sql, context);
    const payment = await paidCheckout(sql, context);
    if (!payment) throw new Error("The original Stripe payment is unavailable.");
    const stored = await refundAttempt(sql, payment, attempt.id);
    if (!stored || (stored.refundId && stored.refundId !== refund.id)) throw new Error("The Stripe refund changed unexpectedly.");
    if (stored.state !== "pending") return stored.state;
    await sql.unsafe("UPDATE stripe_sandbox_refund_attempts SET refund_id = $2, state = $3 WHERE id = $1",
      [stored.id, refund.id, refund.state]);
    if (refund.state !== "succeeded") return refund.state;
    await sql.unsafe(`
      INSERT INTO payment_records (id, tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id)
      VALUES ($1, $2, $3, 'refund', $4, 'card', $5)
    `, [stored.id, tenantId, bookingId, stored.amountCents, stored.actorId]);
    const metadata = JSON.stringify({ paymentId: stored.id, originalPaymentId: payment.id, amountCents: stored.amountCents, method: "card", source: "stripe_sandbox" });
    await sql.unsafe(`
      INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
      VALUES ($1, $2, $3, 'payment.refund', $4::text::jsonb)
    `, [tenantId, bookingId, stored.actorId, metadata]);
    await sql.unsafe(`
      INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
      VALUES ($1, $2, 'payment.refund_recorded', 'payment_record', $3, $4::text::jsonb)
    `, [tenantId, stored.actorId, stored.id, metadata]);
    return refund.state;
  });
}

export async function runStripeAppointmentRefund(context: Context, config: StripeSandboxConfig, input: RefundInput) {
  const accountId = await appointmentStripeAccount(context.tenantId);
  if (!accountId) throw new Error("The original Stripe sandbox account is unavailable.");
  const attempt = await reserveRefund(context, accountId, input);
  if (!attempt) return null;
  if (attempt.state !== "pending") return attempt.state;
  const stripe = stripeRefundSandbox(config);
  if (!attempt.refundId && !attempt.retryable) {
    throw new Error("Check the original refund in Stripe before starting another.");
  }
  const refund = attempt.refundId ? await stripe.retrieve(attempt, attempt.refundId) : await stripe.create(attempt);
  return reconcileRefund(context, attempt, refund);
}
