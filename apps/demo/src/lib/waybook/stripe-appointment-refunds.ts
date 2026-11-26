import "server-only";

import { tenantDb } from "./database";
import { appointmentStripeAccount, recoverStripeCheckoutByPaymentIntent } from "./stripe-appointment-checkout";
import type { StripeSandboxConfig } from "./stripe-connect-api";
import type { StripeDashboardRefundNotification, StripeRefundNotification } from "./stripe-sandbox-webhook";
import { stripeSandboxTenantForAccount } from "./stripe-sandbox";
import { stripeRefundSandbox, type SandboxRefund, type SandboxRefundAttempt } from "./stripe-refund-api";

type Database = ReturnType<typeof tenantDb>;
type Context = { db: Database; tenantId: string; bookingId: string };
type Query = Pick<Database, "unsafe">;
type StoredRefund = SandboxRefundAttempt & {
  actorId: string | null;
  refundId: string | null;
  state: SandboxRefund["state"];
  retryable: boolean;
};
type PaidCheckout = { id: string; accountId: string; paymentIntentId: string };
const refundColumns = `r.id, r.amount_cents AS "amountCents", r.created_by_identity_id AS "actorId",
  r.refund_id AS "refundId", r.state, r.created_at > now() - interval '20 hours' AS retryable`;

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
    SELECT ${refundColumns}
    FROM stripe_sandbox_refund_attempts r
    WHERE r.payment_attempt_id = $1 AND ($2::uuid = r.id OR ($2::uuid IS NULL AND r.state = 'pending'))
    ORDER BY r.created_at DESC, r.id DESC LIMIT 1
  `, [payment.id, id]);
  return attempt ? { ...attempt, accountId: payment.accountId, paymentIntentId: payment.paymentIntentId } : null;
}

export async function stripeAppointmentRefundDetails(context: Context) {
  const paid = await paidCheckout(context.db, context);
  if (!paid) return null;
  const [remainingCents, [latest]] = await Promise.all([
    remainingRefund(context.db, context),
    context.db.unsafe<{ state: SandboxRefund["state"]; amountCents: number; returned: boolean }[]>(`
      SELECT state, amount_cents AS "amountCents", return_payment_id IS NOT NULL AS returned
      FROM stripe_sandbox_refund_attempts
      WHERE payment_attempt_id = $1 ORDER BY (state = 'pending') DESC, created_at DESC, id DESC LIMIT 1
    `, [paid.id]),
  ]);
  const pendingCents = latest?.state === "pending" ? latest.amountCents : null;
  const failure = latest?.returned ? "Stripe returned the last refund after it was recorded." :
    latest?.state === "failed" ? "Stripe declined the last refund." :
    latest?.state === "canceled" ? "Stripe cancelled the last refund." : null;
  return { remainingCents, pendingCents, failure };
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

async function postRefundEntry(
  sql: Query,
  context: Context,
  originalPaymentId: string,
  stored: StoredRefund,
  returnPaymentId?: string,
) {
  const { tenantId, bookingId } = context;
  const id = returnPaymentId ?? stored.id;
  const kind = returnPaymentId ? "payment" : "refund";
  const event = returnPaymentId ? "payment.refund_returned" : "payment.refund";
  const action = returnPaymentId ? event : "payment.refund_recorded";
  await sql.unsafe(`
    INSERT INTO payment_records (id, tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id)
    VALUES ($1, $2, $3, $4, $5, 'card', $6)
  `, [id, tenantId, bookingId, kind, stored.amountCents, stored.actorId]);
  const metadata = JSON.stringify({ paymentId: id, originalPaymentId, amountCents: stored.amountCents,
    method: "card", source: "stripe_sandbox", recordedVia: stored.actorId ? "waybook" : "stripe",
    ...(returnPaymentId ? { originalRefundId: stored.id } : {}) });
  await sql.unsafe(`
    INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
    VALUES ($1, $2, $3, $4, $5::text::jsonb)
  `, [tenantId, bookingId, stored.actorId, event, metadata]);
  await sql.unsafe(`
    INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
    VALUES ($1, $2, $3, 'payment_record', $4, $5::text::jsonb)
  `, [tenantId, stored.actorId, action, id, metadata]);
}

async function reconcileRefund(context: Context, attempt: StoredRefund, refund: SandboxRefund) {
  return context.db.begin(async (sql) => {
    await lockBooking(sql, context);
    const payment = await paidCheckout(sql, context);
    if (!payment) throw new Error("The original Stripe payment is unavailable.");
    const stored = await refundAttempt(sql, payment, attempt.id);
    if (!stored || stored.amountCents !== attempt.amountCents) throw new Error("The Stripe refund changed unexpectedly.");
    return recordRefundOutcome(sql, context, payment, stored, refund);
  });
}

async function recordRefundOutcome(sql: Query, context: Context, payment: PaidCheckout, stored: StoredRefund, refund: SandboxRefund) {
  if (stored.refundId && stored.refundId !== refund.id) throw new Error("The Stripe refund changed unexpectedly.");
  if (stored.state === "succeeded" && refund.state === "failed") {
    if (!refund.failureBalanceTransactionId) throw new Error("Stripe has not confirmed the returned refund balance.");
    const returnPaymentId = crypto.randomUUID();
    await sql.unsafe(`
      UPDATE stripe_sandbox_refund_attempts
      SET state = 'failed', return_payment_id = $2, failure_balance_transaction_id = $3 WHERE id = $1
    `, [stored.id, returnPaymentId, refund.failureBalanceTransactionId]);
    await postRefundEntry(sql, context, payment.id, stored, returnPaymentId);
    return "failed";
  }
  if (stored.state !== "pending") return stored.state;
  await sql.unsafe("UPDATE stripe_sandbox_refund_attempts SET refund_id = $2, state = $3 WHERE id = $1",
    [stored.id, refund.id, refund.state]);
  if (refund.state === "succeeded") await postRefundEntry(sql, context, payment.id, stored);
  return refund.state;
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
  const refund = !attempt.refundId ? await stripe.create(attempt) :
    attempt.actorId ? await stripe.retrieve(attempt, attempt.refundId) : await stripe.retrieveDashboard(attempt, attempt.refundId);
  return reconcileRefund(context, attempt, refund);
}

export async function settleStripeRefundNotification(
  config: StripeSandboxConfig, notification: StripeRefundNotification | StripeDashboardRefundNotification,
) {
  const { accountId, refundId } = notification;
  const tenant = await stripeSandboxTenantForAccount(accountId);
  if (!tenant) return;
  const db = tenantDb(tenant);
  if (notification.kind === "dashboard-refund") {
    await recordDashboardRefund(db, tenant.id, config, notification);
    return;
  }
  const [attempt] = await db.unsafe<(StoredRefund & { bookingId: string })[]>(`
    SELECT ${refundColumns}, p.booking_id AS "bookingId", p.account_id AS "accountId",
           p.payment_intent_id AS "paymentIntentId"
    FROM stripe_sandbox_refund_attempts r JOIN stripe_sandbox_checkout_attempts p ON p.id = r.payment_attempt_id
    WHERE p.tenant_id = $1 AND p.account_id = $2 AND p.state = 'settled'
      AND r.id = $3 AND r.state IN ('pending', 'succeeded')
  `, [tenant.id, accountId, notification.attemptId]);
  if (!attempt || (attempt.refundId && attempt.refundId !== refundId)) return;
  const refund = await stripeRefundSandbox(config).retrieve(attempt, refundId);
  await reconcileRefund({ db, tenantId: tenant.id, bookingId: attempt.bookingId }, attempt, refund);
}

async function recordDashboardRefund(db: Database, tenantId: string, config: StripeSandboxConfig, notification: StripeDashboardRefundNotification) {
  const { accountId, paymentIntentId, amountCents, refundId } = notification;
  const linkedPayment = async () => (await db.unsafe<{ bookingId: string }[]>(`
    SELECT booking_id AS "bookingId" FROM stripe_sandbox_checkout_attempts
    WHERE tenant_id = $1 AND account_id = $2 AND payment_intent_id = $3 AND state = 'settled'
  `, [tenantId, accountId, paymentIntentId]))[0];
  let linked = await linkedPayment();
  if (!linked) {
    const [pending] = await db.unsafe(`
      SELECT id FROM stripe_sandbox_checkout_attempts
      WHERE tenant_id = $1 AND account_id = $2 AND state = 'pending' LIMIT 1
    `, [tenantId, accountId]);
    if (!pending) linked = await linkedPayment();
    if (!pending && !linked) return;
  }
  const refund = await stripeRefundSandbox(config).retrieveDashboard(notification, refundId);
  if (!linked) {
    const recovered = await recoverStripeCheckoutByPaymentIntent(db, tenantId, config, notification);
    // A simultaneous checkout notification can settle the intent during lookup.
    linked = await linkedPayment();
    if (!linked && !recovered) return;
    if (!linked) throw new Error("The verified checkout payment is not in the ledger yet.");
  }
  const context = { db, tenantId, bookingId: linked.bookingId };
  await db.begin(async (sql) => {
    await lockBooking(sql, context);
    const paid = await paidCheckout(sql, context);
    if (!paid || paid.accountId !== accountId || paid.paymentIntentId !== paymentIntentId) {
      throw new Error("The original Stripe payment changed unexpectedly.");
    }
    await sql.unsafe(`
      INSERT INTO stripe_sandbox_refund_attempts (id, payment_attempt_id, amount_cents, refund_id)
      VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (refund_id) DO NOTHING
    `, [paid.id, amountCents, refundId]);
    const [stored] = await sql.unsafe<StoredRefund[]>(`
      SELECT ${refundColumns}, $2::text AS "accountId", $3::text AS "paymentIntentId"
      FROM stripe_sandbox_refund_attempts r WHERE r.payment_attempt_id = $1 AND r.refund_id = $4
    `, [paid.id, accountId, paymentIntentId, refundId]);
    if (!stored || stored.amountCents !== amountCents) throw new Error("This refund does not match the original payment.");
    await recordRefundOutcome(sql, context, paid, stored, refund);
  });
}
