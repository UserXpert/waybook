import { createHmac, timingSafeEqual } from "node:crypto";

const handledEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
]);

export type StripeCheckoutNotification = {
  accountId: string;
  attemptId: string;
  sessionId: string;
};

type StripeWebhookEnvelope = {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  account?: unknown;
  type?: unknown;
  data?: { object?: { object?: unknown; id?: unknown; client_reference_id?: unknown; livemode?: unknown } };
};

/** Verify the original bytes before decoding the Stripe snapshot event. */
export function readStripeCheckoutNotification(
  bytes: Uint8Array,
  signature: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeCheckoutNotification | null {
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
  if (event.livemode !== false || !handledEvents.has(event.type) || typeof event.account !== "string" ||
      !/^acct_[A-Za-z0-9]+$/.test(event.account)) return null;
  const session = event.data?.object;
  if (session?.object !== "checkout.session" || session.livemode !== false ||
      typeof session.id !== "string" || !/^cs_test_[A-Za-z0-9]+$/.test(session.id) ||
      typeof session.client_reference_id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session.client_reference_id)) return null;
  return { accountId: event.account, attemptId: session.client_reference_id, sessionId: session.id };
}
