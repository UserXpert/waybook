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
export type StripeSandboxNotification = StripeCheckoutNotification | StripeRefundNotification;

type StripeWebhookEnvelope = {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  account?: unknown;
  type?: unknown;
  data?: { object?: {
    object?: unknown; id?: unknown; client_reference_id?: unknown; livemode?: unknown;
    metadata?: { waybook_refund_attempt?: unknown };
  } };
};

/** Verify the original bytes before decoding the Stripe snapshot event. */
export function readStripeSandboxNotification(
  bytes: Uint8Array,
  signature: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeSandboxNotification | null {
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
  if (event.livemode !== false || typeof event.account !== "string" ||
      !/^acct_[A-Za-z0-9]+$/.test(event.account)) return null;
  const resource = event.data?.object;
  if (typeof resource?.id !== "string") return null;
  if (checkoutEvents.has(event.type) && resource.object === "checkout.session") {
    const attemptId = resource.client_reference_id;
    if (resource.livemode === false && /^cs_test_[A-Za-z0-9]+$/.test(resource.id) &&
        typeof attemptId === "string" && uuidPattern.test(attemptId)) {
      return { kind: "checkout", accountId: event.account, attemptId, sessionId: resource.id };
    }
  }
  if (refundEvents.has(event.type) && resource.object === "refund") {
    // Refund snapshots can omit livemode. The signed envelope declares it.
    const attemptId = resource.metadata?.waybook_refund_attempt;
    if ((resource.livemode === undefined || resource.livemode === false) && /^re_[A-Za-z0-9]+$/.test(resource.id) &&
        typeof attemptId === "string" && uuidPattern.test(attemptId)) {
      return { kind: "refund", accountId: event.account, attemptId, refundId: resource.id };
    }
  }
  return null;
}
