import "server-only";

import { completeSettledAppointment } from "./appointment-checkout-completion";
import { controlDb, tenantDb } from "./database";
import { stripeConnectSandbox, stripeSandboxConfig, type StripeSandboxConfig } from "./stripe-connect-api";
import { stripeCheckoutLifetimeSeconds, stripeCheckoutSandbox, stripeSandboxMobilePayAvailable, type SandboxCheckoutAttempt, type SandboxCheckoutSession } from "./stripe-checkout-api";
import type { StripeCheckoutNotification } from "./stripe-sandbox-webhook";
import { stripeSandboxTenantForAccount } from "./stripe-sandbox";

type TenantDatabase = ReturnType<typeof tenantDb>;
type CheckoutContext = { db: TenantDatabase; tenantId: string; bookingId: string };
type PaymentMethod = "card" | "mobilepay";
type CheckoutInput = {
  action: "open" | "check" | "cancel" | "return";
  expectedCents: number;
  actorId: string;
  returnPath: string;
  paymentMethod?: PaymentMethod;
};
type Attempt = SandboxCheckoutAttempt & {
  paymentMethod: PaymentMethod;
  bookingId: string;
  actorId: string;
  returnOrigin: string;
  sessionId: string | null;
  state: "pending" | "settled";
};
type AttemptQuery = Pick<TenantDatabase, "unsafe">;
const selectAttempt = `
  SELECT id, booking_id AS "bookingId", account_id AS "accountId", amount_cents AS "amountCents",
         created_by_identity_id AS "actorId", expires_at_seconds AS "expiresAtSeconds", return_path AS "returnPath",
         return_origin AS "returnOrigin", session_id AS "sessionId", stripe_customer_id AS "stripeCustomerId",
         payment_method_type AS "paymentMethod", state
  FROM stripe_sandbox_checkout_attempts
`;

export function appointmentStripeConfig() {
  return stripeSandboxConfig(process.env);
}

export async function appointmentStripeAccount(tenantId: string) {
  const [connection] = await controlDb<{ accountId: string }[]>`
    SELECT account_id AS "accountId" FROM waybook_stripe_sandbox_connections
    WHERE tenant_id = ${tenantId} AND account_id IS NOT NULL
  `;
  return connection?.accountId ?? null;
}

async function currentAttempt(sql: AttemptQuery, tenantId: string, bookingId: string) {
  const [attempt] = await sql.unsafe<Attempt[]>(`
    ${selectAttempt}
    WHERE tenant_id = $1 AND booking_id = $2 AND state <> 'expired'
  `, [tenantId, bookingId]);
  return attempt ?? null;
}

export async function appointmentStripeState({ db, tenantId, bookingId }: CheckoutContext) {
  const attempt = await currentAttempt(db, tenantId, bookingId);
  return attempt ? { state: attempt.state, paymentMethod: attempt.paymentMethod } : null;
}

async function lockAppointment(sql: AttemptQuery, tenantId: string, bookingId: string) {
  const [booking] = await sql.unsafe<{ status: string; stage: string | null }[]>(`
    SELECT status, attendance_stage AS stage FROM bookings WHERE tenant_id = $1 AND id = $2 FOR UPDATE
  `, [tenantId, bookingId]);
  if (!booking) throw new Error("Appointment is unavailable.");
  return booking;
}

async function reserveAttempt(
  { db, tenantId, bookingId }: CheckoutContext,
  config: StripeSandboxConfig,
  accountId: string | null,
  input: CheckoutInput,
  canStart: boolean,
) {
  return db.begin(async (sql) => {
    const booking = await lockAppointment(sql, tenantId, bookingId);
    const existing = await currentAttempt(sql, tenantId, bookingId);
    if (existing && input.paymentMethod && existing.paymentMethod !== input.paymentMethod) {
      throw new Error("Resolve the open Stripe payment before choosing a different payment method.");
    }
    if (existing || input.action !== "open") return existing;
    if (!accountId || booking.status !== "arrived" || booking.stage !== "checking_out") {
      throw new Error("Open appointment checkout with a connected Stripe sandbox account first.");
    }
    if (!canStart) throw new Error("The Stripe payment changed. Review checkout and try again.");
    const paymentMethod = input.paymentMethod ?? "card";
    const [cart] = await sql.unsafe<{ total: number; currency: string; alreadyRecorded: boolean; stripeCustomerId: string | null }[]>(`
      SELECT cart.chargeable_cents::int AS total, sale.currency,
             EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = $1 AND booking_id = $2) AS "alreadyRecorded",
             saved.stripe_customer_id AS "stripeCustomerId"
      FROM appointment_checkout_amounts($1, $2) cart
      JOIN commerce_sales sale ON sale.tenant_id = $1 AND sale.booking_id = $2
      JOIN bookings booking ON booking.tenant_id = sale.tenant_id AND booking.id = sale.booking_id
      LEFT JOIN stripe_sandbox_client_cards saved
        ON saved.tenant_id = booking.tenant_id AND saved.customer_id = booking.customer_id
        AND saved.account_id = $3 AND saved.consented_at IS NOT NULL AND saved.card_brand IS NOT NULL
        AND $4::text = 'card'
    `, [tenantId, bookingId, accountId, paymentMethod]);
    if (!cart || cart.currency !== "DKK" || cart.alreadyRecorded || cart.total <= 0 ||
        cart.total > 10_000_000 || cart.total !== input.expectedCents) {
      throw new Error("Review the current checkout total before opening a Stripe sandbox payment.");
    }
    await sql.unsafe(`
      INSERT INTO stripe_sandbox_checkout_attempts
        (tenant_id, booking_id, account_id, amount_cents, return_path, return_origin, created_by_identity_id,
         expires_at_seconds, stripe_customer_id, payment_method_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, floor(extract(epoch FROM now()))::int + $8::int, $9, $10)
    `, [tenantId, bookingId, accountId, cart.total, input.returnPath, config.origin, input.actorId,
      stripeCheckoutLifetimeSeconds, cart.stripeCustomerId, paymentMethod]);
    return currentAttempt(sql, tenantId, bookingId);
  });
}

async function reconcileAttempt(
  { db, tenantId, bookingId }: CheckoutContext,
  attempt: Attempt,
  session: SandboxCheckoutSession,
) {
  return db.begin(async (sql) => {
    if (session.state === "paid") {
      // Attendance edits lock the reservation before locking the appointment.
      await sql.unsafe(`
        SELECT block.id FROM bookings booking
        JOIN booking_blocks block ON block.tenant_id = booking.tenant_id AND block.id = booking.booking_block_id
        WHERE booking.tenant_id = $1 AND booking.id = $2 FOR UPDATE OF block
      `, [tenantId, bookingId]);
    }
    const booking = await lockAppointment(sql, tenantId, bookingId);
    const stored = await currentAttempt(sql, tenantId, bookingId);
    if (!stored || stored.id !== attempt.id) return { state: "expired" as const };
    if (stored.state === "settled") return { state: "paid" as const };
    if (stored.sessionId && stored.sessionId !== session.id) throw new Error("The Stripe session changed unexpectedly.");
    await sql.unsafe("UPDATE stripe_sandbox_checkout_attempts SET session_id = $2 WHERE id = $1", [stored.id, session.id]);
    if (session.state === "expired") {
      await sql.unsafe("UPDATE stripe_sandbox_checkout_attempts SET state = 'expired' WHERE id = $1", [stored.id]);
    }
    if (session.state !== "paid") return session;

    // The trigger allows the matching immutable receipt once this transaction marks the attempt settled.
    await sql.unsafe("UPDATE stripe_sandbox_checkout_attempts SET state = 'settled', payment_intent_id = $2 WHERE id = $1",
      [stored.id, session.paymentIntentId]);
    await sql.unsafe(`
      INSERT INTO payment_records (id, tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id)
      VALUES ($1, $2, $3, 'payment', $4, 'card', $5)
    `, [stored.id, tenantId, bookingId, stored.amountCents, stored.actorId]);
    const metadata = JSON.stringify({ paymentId: stored.id, amountCents: stored.amountCents,
      method: "card", source: "stripe_sandbox", stripePaymentMethod: stored.paymentMethod });
    await sql.unsafe(`
      INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
      VALUES ($1, $2, $3, 'payment.payment', $4::text::jsonb)
    `, [tenantId, bookingId, stored.actorId, metadata]);
    await sql.unsafe(`
      INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
      VALUES ($1, $2, 'payment.payment_recorded', 'payment_record', $3, $4::text::jsonb)
    `, [tenantId, stored.actorId, stored.id, metadata]);
    if (booking.status === "arrived" && booking.stage === "checking_out") {
      const [cart] = await sql.unsafe<{ exact: boolean }[]>(`
        SELECT chargeable_cents = $3 AS exact FROM appointment_checkout_amounts($1, $2)
      `, [tenantId, bookingId, stored.amountCents]);
      if (cart?.exact) await completeSettledAppointment(sql, tenantId, bookingId, stored.actorId);
    }
    return { state: "paid" as const };
  });
}

export async function runAppointmentStripeCheckout(
  context: CheckoutContext,
  config: StripeSandboxConfig,
  input: CheckoutInput,
) {
  const accountId = await appointmentStripeAccount(context.tenantId);
  const canStart = Boolean(accountId && input.action === "open" &&
    !await currentAttempt(context.db, context.tenantId, context.bookingId));
  if (canStart && accountId) {
    if (input.paymentMethod === "mobilepay" && input.expectedCents < 250) {
      throw new Error("MobilePay payments must be at least DKK 2.50.");
    }
    if (await stripeConnectSandbox(config).merchantStatus(accountId) !== "ready") {
      throw new Error("Finish Stripe sandbox setup in Settings before taking a payment.");
    }
    if (input.paymentMethod === "mobilepay" && !await stripeSandboxMobilePayAvailable(config, accountId)) {
      throw new Error("MobilePay is unavailable for this Stripe sandbox account.");
    }
  }
  const attempt = await reserveAttempt(context, config, accountId, input, canStart);
  if (!attempt) return { state: "expired" as const };
  if (attempt.state === "settled") return { state: "paid" as const };
  if (attempt.returnOrigin !== config.origin || attempt.accountId !== accountId) {
    throw new Error("The open Stripe payment must be resolved with its original account and return address.");
  }
  const stripe = stripeCheckoutSandbox(config);
  let sessionId = attempt.sessionId;
  if (!sessionId) {
    if (Date.now() >= attempt.expiresAtSeconds * 1000) {
      const recovered = await stripe.findAfterExpiry(attempt);
      if (!recovered) throw new Error("Stripe did not confirm the original session. Check this attempt in Stripe before accepting another payment.");
      if (input.action !== "cancel" || recovered.state !== "open") return reconcileAttempt(context, attempt, recovered);
      sessionId = recovered.id;
    } else {
      if (input.action === "return") {
        throw new Error("Stripe’s session has not been saved. Check payment status before taking another payment.");
      }
      const created = await stripe.create(attempt);
      await reconcileAttempt(context, attempt, created);
      sessionId = created.id;
    }
  }
  const session = input.action === "cancel" ? await stripe.expire(attempt, sessionId) : await stripe.retrieve(attempt, sessionId);
  return reconcileAttempt(context, attempt, session);
}

export async function settleStripeCheckoutNotification(config: StripeSandboxConfig, notification: StripeCheckoutNotification) {
  const { accountId, attemptId, sessionId } = notification;
  const tenant = await stripeSandboxTenantForAccount(accountId);
  if (!tenant) return;
  const db = tenantDb(tenant);
  const [attempt] = await db.unsafe<Attempt[]>(`
    ${selectAttempt} WHERE tenant_id = $1 AND account_id = $2 AND id = $3 AND state = 'pending'
  `, [tenant.id, accountId, attemptId]);
  if (!attempt || (attempt.sessionId && attempt.sessionId !== sessionId)) return;
  // Stripe's current record is authoritative even if a signed delivery arrives out of order.
  const session = await stripeCheckoutSandbox(config).retrieve(attempt, sessionId);
  if (session.state !== "paid" && session.state !== "expired") {
    throw new Error("Stripe checkout has not reached its final state.");
  }
  // The same appointment lock protects manual checks and webhook retries.
  await reconcileAttempt({ db, tenantId: tenant.id, bookingId: attempt.bookingId }, attempt, session);
}

export async function recoverStripeCheckoutByPaymentIntent(
  db: TenantDatabase, tenantId: string, config: StripeSandboxConfig,
  { accountId, paymentIntentId }: { accountId: string; paymentIntentId: string },
) {
  const stripe = stripeCheckoutSandbox(config);
  const candidate = await stripe.findByPaymentIntent(accountId, paymentIntentId);
  if (!candidate) return false;
  const [attempt] = await db.unsafe<Attempt[]>(`
    ${selectAttempt} WHERE tenant_id = $1 AND account_id = $2 AND id = $3 AND state <> 'expired'
  `, [tenantId, accountId, candidate.attemptId]);
  if (!attempt) return false;
  if (attempt.sessionId && attempt.sessionId !== candidate.id) throw new Error("The Stripe session changed unexpectedly.");
  const session = await stripe.retrieve(attempt, candidate.id);
  if (session.state !== "paid" || session.paymentIntentId !== paymentIntentId) {
    throw new Error("Stripe has not confirmed the original checkout payment.");
  }
  const result = await reconcileAttempt({ db, tenantId, bookingId: attempt.bookingId }, attempt, session);
  if (result.state !== "paid") throw new Error("The original Stripe payment could not be recorded.");
  return true;
}
