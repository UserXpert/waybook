import type { StripeSandboxConfig } from "./stripe-connect-api";
import { stripeDkkMinimumCents, stripeHostedCheckoutUrl, stripeSandboxRequest } from "./stripe-checkout-api";

export const rehearsalAmountCents = 1000;
const rehearsalPrefix = "waybook-rehearsal-";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StripeSession = {
  id?: unknown; object?: unknown; livemode?: unknown; mode?: unknown;
  amount_total?: unknown; currency?: unknown; client_reference_id?: unknown;
  status?: unknown; payment_status?: unknown; payment_method_types?: unknown; url?: unknown;
};

export function isRehearsalAmount(amount: number) {
  return Number.isSafeInteger(amount) && amount >= stripeDkkMinimumCents && amount <= 10_000_000;
}

function isRehearsal(session: StripeSession, amount: number) {
  return session.object === "checkout.session" && session.livemode === false && session.mode === "payment" &&
    typeof session.id === "string" && /^cs_test_[A-Za-z0-9]+$/.test(session.id) &&
    session.currency === "dkk" && session.amount_total === amount &&
    Array.isArray(session.payment_method_types) && session.payment_method_types.length === 1 &&
    session.payment_method_types[0] === "card" &&
    typeof session.client_reference_id === "string" && session.client_reference_id.startsWith(rehearsalPrefix) &&
    uuidPattern.test(session.client_reference_id.slice(rehearsalPrefix.length));
}

export async function openSandboxRehearsal(config: StripeSandboxConfig, accountId: string, settingsPath: string, nonce: string, request = fetch, amount = rehearsalAmountCents) {
  const returnUrl = new URL(settingsPath, config.origin);
  if (!isRehearsalAmount(amount) || !uuidPattern.test(nonce) || returnUrl.origin !== config.origin || !settingsPath.startsWith("/") ||
      returnUrl.username || returnUrl.password || returnUrl.hash) throw new Error("Invalid sandbox rehearsal context.");
  const cancelUrl = new URL(returnUrl);
  returnUrl.searchParams.set("sale", nonce);
  cancelUrl.searchParams.set("sale", nonce);
  returnUrl.searchParams.set("sandbox", "payment-returned");
  cancelUrl.searchParams.set("sandbox", "payment-cancelled");
  const reference = rehearsalPrefix + nonce;
  const params = new URLSearchParams({
    mode: "payment",
    "allowed_payment_method_types[0]": "card",
    "adaptive_pricing[enabled]": "false",
    client_reference_id: reference,
    success_url: returnUrl.href,
    cancel_url: cancelUrl.href,
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][product_data][name]": "Waybook sandbox rehearsal",
    "line_items[0][quantity]": "1",
  });
  const response = await stripeSandboxRequest(config, request, accountId, "/v1/checkout/sessions", "POST", params, reference);
  const session = await response.json() as StripeSession;
  const url = typeof session.id === "string" && stripeHostedCheckoutUrl(session.url, session.id);
  if (!isRehearsal(session, amount) || session.client_reference_id !== reference || session.status !== "open" || !url) {
    throw new Error("Stripe did not confirm the expected sandbox rehearsal.");
  }
  return { id: session.id as string, url };
}

export async function sandboxRehearsalPaid(config: StripeSandboxConfig, accountId: string, id: string, nonce: string, request = fetch, amount = rehearsalAmountCents) {
  if (!isRehearsalAmount(amount) || !/^cs_test_[A-Za-z0-9]+$/.test(id) || !uuidPattern.test(nonce)) throw new Error("Invalid sandbox rehearsal context.");
  const response = await stripeSandboxRequest(config, request, accountId, `/v1/checkout/sessions/${id}`, "GET");
  const session = await response.json() as StripeSession;
  if (!isRehearsal(session, amount) || session.id !== id || session.client_reference_id !== rehearsalPrefix + nonce) {
    throw new Error("Stripe did not confirm the expected sandbox rehearsal.");
  }
  return session.status === "complete" && session.payment_status === "paid";
}
