import { createHmac, timingSafeEqual } from "node:crypto";

const checkoutEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
]);
const refundEvents = new Set(["refund.created", "refund.updated", "refund.failed"]);
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type ConnectedNotification = {
  accountId: string;
  attemptId: string;
};

export type StripeCheckoutNotification = ConnectedNotification & { kind: "checkout"; sessionId: string };
export type StripeRefundNotification = ConnectedNotification & { kind: "refund"; refundId: string };
export type StripeDashboardRefundNotification = {
  kind: "dashboard-refund"; accountId: string; refundId: string; paymentIntentId: string; amountCents: number;
};
export type StripePaymentNotification = StripeCheckoutNotification | StripeRefundNotification | StripeDashboardRefundNotification;

type StripeWebhookEnvelope = {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  account?: unknown;
  type?: unknown;
  data?: { object?: {
    object?: unknown; id?: unknown; client_reference_id?: unknown; livemode?: unknown;
    payment_intent?: unknown; amount?: unknown; currency?: unknown;
    metadata?: { waybook_refund_attempt?: unknown };
  } };
};

/** Verify the original bytes before decoding the Stripe snapshot event. */
export function readStripePaymentNotification(
  bytes: Uint8Array,
  signature: string,
  secret: string,
  expectedLivemode = false,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripePaymentNotification | null {
  const parts = signature.split(",").map((entry) => entry.trim());
  const timestamps = parts.filter((entry) => entry.startsWith("t="));
  const timestamp = timestamps[0]?.slice(2) ?? "";
  if (timestamps.length !== 1 || !/^[1-9][0-9]{0,12}$/.test(timestamp) ||
      Math.abs(nowSeconds - Number(timestamp)) > 300) throw new Error("Invalid Stripe signature timestamp.");

  const expected = createHmac("sha256", secret).update(timestamp + ".").update(bytes).digest();
  const verified = parts.some((entry) =>
    /^v1=[0-9a-f]{64}$/i.test(entry) && timingSafeEqual(expected, Buffer.from(entry.slice(3), "hex")));
  if (!verified) throw new Error("Invalid Stripe signature.");

  const event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as StripeWebhookEnvelope | null;
  if (event?.object !== "event" || typeof event.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
      typeof event.type !== "string") throw new Error("Invalid Stripe event.");
  if (event.livemode !== expectedLivemode || typeof event.account !== "string" ||
      !/^acct_[A-Za-z0-9]+$/.test(event.account)) return null;
  const resource = event.data?.object;
  if (typeof resource?.id !== "string") return null;
  if (checkoutEvents.has(event.type) && resource.object === "checkout.session") {
    const attemptId = resource.client_reference_id;
    const sessionIdPattern = expectedLivemode ? /^cs_live_[A-Za-z0-9]+$/ : /^cs_test_[A-Za-z0-9]+$/;
    if (resource.livemode === expectedLivemode && sessionIdPattern.test(resource.id) &&
        typeof attemptId === "string" && uuidPattern.test(attemptId)) {
      return { kind: "checkout", accountId: event.account, attemptId, sessionId: resource.id };
    }
  }
  if (refundEvents.has(event.type) && resource.object === "refund" &&
      (resource.livemode === undefined || resource.livemode === expectedLivemode) && /^re_[A-Za-z0-9]+$/.test(resource.id)) {
    // Refund snapshots can omit livemode. The signed envelope declares it.
    const attemptId = resource.metadata?.waybook_refund_attempt;
    if (typeof attemptId === "string" && uuidPattern.test(attemptId)) {
      return { kind: "refund", accountId: event.account, attemptId, refundId: resource.id };
    }
    if (attemptId === undefined && resource.currency === "dkk" && typeof resource.payment_intent === "string" &&
        /^pi_[A-Za-z0-9]+$/.test(resource.payment_intent) && typeof resource.amount === "number" &&
        Number.isSafeInteger(resource.amount) && resource.amount > 0 && resource.amount <= 10_000_000) {
      return { kind: "dashboard-refund", accountId: event.account, refundId: resource.id,
        paymentIntentId: resource.payment_intent, amountCents: resource.amount };
    }
  }
  return null;
}
