import type { StripeSandboxConfig } from "./stripe-connect-api";
import { stripeHostedCheckoutUrl, stripeSandboxRequest } from "./stripe-checkout-api";

const rehearsalAmountCents = 1000;
const rehearsalPrefix = "waybook-rehearsal-";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StripeSession = {
  id?: unknown; object?: unknown; livemode?: unknown; mode?: unknown;
  amount_total?: unknown; currency?: unknown; client_reference_id?: unknown;
  status?: unknown; payment_status?: unknown; created?: unknown; url?: unknown;
};

function isRehearsal(session: StripeSession) {
  return session.object === "checkout.session" && session.livemode === false && session.mode === "payment" &&
    typeof session.id === "string" && /^cs_test_[A-Za-z0-9]+$/.test(session.id) &&
    session.currency === "dkk" && session.amount_total === rehearsalAmountCents &&
    typeof session.client_reference_id === "string" && session.client_reference_id.startsWith(rehearsalPrefix) &&
    uuidPattern.test(session.client_reference_id.slice(rehearsalPrefix.length));
}

export async function openSandboxRehearsal(config: StripeSandboxConfig, accountId: string, settingsPath: string, nonce: string, request = fetch) {
  const returnUrl = new URL(settingsPath, config.origin);
  if (!uuidPattern.test(nonce) || returnUrl.origin !== config.origin || !settingsPath.startsWith("/") ||
      returnUrl.username || returnUrl.password || returnUrl.hash) throw new Error("Invalid sandbox rehearsal context.");
  const cancelUrl = new URL(returnUrl);
  returnUrl.searchParams.set("sandbox", "payment-returned");
  cancelUrl.searchParams.set("sandbox", "payment-cancelled");
  const reference = rehearsalPrefix + nonce;
  const params = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "adaptive_pricing[enabled]": "false",
    client_reference_id: reference,
    success_url: returnUrl.href,
    cancel_url: cancelUrl.href,
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": String(rehearsalAmountCents),
    "line_items[0][price_data][product_data][name]": "Waybook sandbox rehearsal",
    "line_items[0][quantity]": "1",
  });
  const response = await stripeSandboxRequest(config, request, accountId, "/v1/checkout/sessions", "POST", params, reference);
  const session = await response.json() as StripeSession;
  const url = typeof session.id === "string" && stripeHostedCheckoutUrl(session.url, session.id);
  if (!isRehearsal(session) || session.client_reference_id !== reference || session.status !== "open" || !url) {
    throw new Error("Stripe did not confirm the expected sandbox rehearsal.");
  }
  return url;
}

export async function listSandboxRehearsals(config: StripeSandboxConfig, accountId: string, request = fetch) {
  const response = await stripeSandboxRequest(config, request, accountId, "/v1/checkout/sessions?limit=30", "GET");
  const { data } = await response.json() as { data: StripeSession[] };
  return data.filter((session): session is StripeSession & { id: string; created: number } =>
    isRehearsal(session) && typeof session.created === "number" && Number.isSafeInteger(session.created) &&
    session.created > 0 && session.created < 4_102_444_800 &&
    ["open", "complete", "expired"].includes(String(session.status)))
    .slice(0, 10)
    .map((session) => ({
      id: session.id,
      created: session.created,
      state: session.status === "expired" ? "Expired" : session.payment_status === "paid" ? "Paid" :
        session.status === "complete" ? "Processing" : "Awaiting payment",
    }));
}
