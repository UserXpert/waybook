import type { StripePaymentConfig } from "./stripe-payment-mode";

const apiOrigin = "https://api.stripe.com";
const checkoutSessions = "/v1/checkout/sessions";
const sandboxSessionId = /^cs_test_[A-Za-z0-9]+$/;
const liveSessionId = /^cs_live_[A-Za-z0-9]+$/;
const attemptIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const stripeCheckoutLifetimeSeconds = 2 * 60 * 60;
type SandboxPaymentConfig = Extract<StripePaymentConfig, { livemode?: false }>;

export type SandboxCheckoutAttempt = {
  id: string;
  accountId: string;
  amountCents: number;
  expiresAtSeconds: number;
  returnPath: string;
  paymentMethod?: "card" | "mobilepay";
  stripeCustomerId?: string | null;
};

export type SandboxCheckoutSession =
  | { id: string; state: "open"; url: string }
  | { id: string; state: "expired" | "processing" }
  | { id: string; state: "paid"; paymentIntentId: string };

type SessionResponse = {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  mode?: unknown;
  client_reference_id?: unknown;
  customer?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  expires_at?: unknown;
  status?: unknown;
  payment_status?: unknown;
  payment_method_types?: unknown;
  payment_intent?: unknown;
  url?: unknown;
};

export function stripeHostedCheckoutUrl(value: unknown, sessionId: string) {
  if (typeof value !== "string" || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.origin !== "https://checkout.stripe.com" || url.username || url.password) return null;
  return url.pathname === `/c/pay/${sessionId}` || url.pathname === `/g/pay/${sessionId}` ? url.href : null;
}

function verifySession(
  session: SessionResponse | null,
  attempt: SandboxCheckoutAttempt,
  livemode: boolean,
  expectedId?: string,
): SandboxCheckoutSession {
  const paymentMethod = attempt.paymentMethod ?? "card";
  const sessionIdPattern = livemode ? liveSessionId : sandboxSessionId;
  if (typeof session?.id !== "string" || !sessionIdPattern.test(session.id) ||
      (expectedId !== undefined && session.id !== expectedId) ||
      session.object !== "checkout.session" || session.livemode !== livemode || session.mode !== "payment" ||
      session.client_reference_id !== attempt.id || session.amount_total !== attempt.amountCents ||
      (paymentMethod === "card" && attempt.stripeCustomerId != null && session.customer !== attempt.stripeCustomerId) ||
      session.currency !== "dkk" || session.expires_at !== attempt.expiresAtSeconds ||
      !Array.isArray(session.payment_method_types) || session.payment_method_types.length !== 1 ||
      session.payment_method_types[0] !== paymentMethod) {
    throw new Error(`Stripe did not confirm the expected ${livemode ? "live" : "sandbox"} checkout session.`);
  }
  const id = session.id;
  if (session.status === "complete" && session.payment_status === "paid" &&
      typeof session.payment_intent === "string" && /^pi_[A-Za-z0-9]+$/.test(session.payment_intent)) {
    return { id, state: "paid", paymentIntentId: session.payment_intent };
  }
  if (session.payment_status === "unpaid") {
    if (session.status === "complete") return { id, state: "processing" };
    if (session.status === "expired") return { id, state: "expired" };
    if (session.status === "open") {
      const url = stripeHostedCheckoutUrl(session.url, id);
      if (url) return { id, state: "open", url };
    }
  }
  throw new Error("Stripe returned an unexpected checkout outcome.");
}

export function stripePaymentKeyMatchesMode(config: StripePaymentConfig) {
  const pattern = config.livemode === true ? /^(sk|rk)_live_[A-Za-z0-9]+$/ : /^(sk|rk)_test_[A-Za-z0-9]+$/;
  return pattern.test(config.secretKey);
}

export async function stripePaymentRequest(config: StripePaymentConfig, request: typeof fetch, accountId: string, path: string, method: "GET" | "POST", body?: URLSearchParams, key?: string) {
  const mode = config.livemode === true ? "live" : "sandbox";
  if (!stripePaymentKeyMatchesMode(config) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new Error(`Invalid Stripe ${mode} checkout context.`);
  }
  const url = new URL(path, apiOrigin);
  if (!path.startsWith("/v1/") || url.origin !== apiOrigin || !url.pathname.startsWith("/v1/") || url.hash) {
    throw new Error(`Invalid Stripe ${mode} API path.`);
  }
  return request(url.href, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": "2026-11-18.endive",
      "Stripe-Account": accountId,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function stripeCheckoutRequest(...args: Parameters<typeof stripePaymentRequest>) {
  const response = await stripePaymentRequest(...args);
  const [config] = args;
  if (!response.ok) throw new Error(`Stripe ${config.livemode === true ? "live" : "sandbox"} checkout is temporarily unavailable.`);
  return response;
}

export function stripeSandboxRequest(config: SandboxPaymentConfig, ...args: [request: typeof fetch, accountId: string, path: string, method: "GET" | "POST", body?: URLSearchParams, key?: string]) {
  return stripeCheckoutRequest({ ...config, livemode: false }, ...args);
}

type PaymentMethodConfiguration = {
  object?: unknown;
  active?: unknown;
  is_default?: unknown;
  livemode?: unknown;
  parent?: unknown;
  mobilepay?: { available?: unknown } | null;
};

export async function stripeMobilePayAvailable(config: StripePaymentConfig, accountId: string, request: typeof fetch = fetch) {
  try {
    const response = await stripeCheckoutRequest(config, request, accountId, "/v1/payment_method_configurations", "GET");
    const list = await response.json() as { object?: unknown; has_more?: unknown; data?: (PaymentMethodConfiguration | null)[] } | null;
    if (list?.object !== "list" || list.has_more !== false || !Array.isArray(list.data)) return false;
    const defaults = list.data.filter((configuration) =>
      configuration?.object === "payment_method_configuration" && configuration.is_default === true &&
      configuration.active === true && configuration.livemode === (config.livemode === true) &&
      typeof configuration.parent === "string" && /^pmc_[A-Za-z0-9]+$/.test(configuration.parent));
    return defaults.length === 1 && defaults[0]?.mobilepay?.available === true;
  } catch {
    return false;
  }
}

export function stripeSandboxMobilePayAvailable(config: SandboxPaymentConfig, accountId: string, request: typeof fetch = fetch) {
  return stripeMobilePayAvailable({ ...config, livemode: false }, accountId, request);
}

export function stripeCheckout(config: StripePaymentConfig, request: typeof fetch = fetch) {
  const livemode = config.livemode === true;
  const mode = livemode ? "live" : "sandbox";
  const sessionIdPattern = livemode ? liveSessionId : sandboxSessionId;

  async function call(
    attempt: SandboxCheckoutAttempt,
    operation: "create" | "retrieve" | "expire",
    sessionId?: string,
    body?: URLSearchParams,
  ) {
    const paymentMethod = attempt.paymentMethod ?? "card";
    if (!attemptIdPattern.test(attempt.id) ||
        !Number.isInteger(attempt.amountCents) || attempt.amountCents <= 0 || attempt.amountCents > 10_000_000 ||
        !Number.isSafeInteger(attempt.expiresAtSeconds) || attempt.expiresAtSeconds <= 0 ||
        (paymentMethod !== "card" && paymentMethod !== "mobilepay") ||
        (sessionId !== undefined && !sessionIdPattern.test(sessionId))) {
      throw new Error(`Invalid Stripe ${mode} checkout context.`);
    }
    const sessionPath = sessionId ? `${checkoutSessions}/${sessionId}` : checkoutSessions;
    const response = await stripeCheckoutRequest(config, request, attempt.accountId, operation === "expire" ? `${sessionPath}/expire` : sessionPath,
      operation === "retrieve" ? "GET" : "POST", body, operation === "create" ? attempt.id : undefined);
    return verifySession(await response.json(), attempt, livemode, sessionId);
  }

  return {
    async findAfterExpiry(attempt: SandboxCheckoutAttempt) {
      const clockSkewSeconds = 120;
      const query = new URLSearchParams({
        "created[gte]": String(attempt.expiresAtSeconds - stripeCheckoutLifetimeSeconds - clockSkewSeconds),
        "created[lte]": String(attempt.expiresAtSeconds + clockSkewSeconds),
        limit: "100",
      });
      let found: SandboxCheckoutSession | null = null;
      // Never release a reservation based on a partial or inconsistent list.
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const response = await stripeCheckoutRequest(config, request, attempt.accountId, `${checkoutSessions}?${query}`, "GET");
        const page = await response.json() as { object?: unknown; has_more?: unknown; data?: SessionResponse[] } | null;
        if (page?.object !== "list" || typeof page.has_more !== "boolean" || !Array.isArray(page.data)) break;
        for (const session of page.data) {
          if (session?.object !== "checkout.session" || session.livemode !== livemode ||
              typeof session.id !== "string" || !sessionIdPattern.test(session.id)) {
            throw new Error("Stripe could not confirm the original checkout session.");
          }
          if (session.client_reference_id !== attempt.id) continue;
          if (found) throw new Error("Stripe returned more than one checkout session for the attempt.");
          found = verifySession(session, attempt, livemode);
        }
        if (!page.has_more) return found;
        const lastId = page.data.at(-1)?.id;
        if (typeof lastId !== "string" || !sessionIdPattern.test(lastId) || lastId === query.get("starting_after")) break;
        query.set("starting_after", lastId);
      }
      throw new Error("Stripe could not confirm the original checkout session.");
    },
    async findByPaymentIntent(accountId: string, paymentIntentId: string) {
      if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) throw new Error("Invalid Stripe payment intent.");
      const query = new URLSearchParams({ payment_intent: paymentIntentId, limit: "2" });
      const response = await stripeCheckoutRequest(config, request, accountId, `${checkoutSessions}?${query}`, "GET");
      const page = await response.json() as { object?: unknown; has_more?: unknown; data?: SessionResponse[] } | null;
      if (page?.object !== "list" || page.has_more !== false || !Array.isArray(page.data) || page.data.length > 1) {
        throw new Error("Stripe did not confirm a unique checkout session for the payment.");
      }
      if (page.data.length === 0) return null;
      const session = page.data[0];
      if (session?.object !== "checkout.session" || session.livemode !== livemode || session.mode !== "payment" ||
          session.payment_intent !== paymentIntentId || typeof session.id !== "string" || !sessionIdPattern.test(session.id)) {
        throw new Error("Stripe returned an unexpected checkout session for the payment.");
      }
      const attemptId = session.client_reference_id;
      return typeof attemptId === "string" && attemptIdPattern.test(attemptId) ? { id: session.id, attemptId } : null;
    },
    create(attempt: SandboxCheckoutAttempt) {
      const returnUrl = new URL(attempt.returnPath, config.origin);
      if (returnUrl.origin !== config.origin || returnUrl.username || returnUrl.password ||
          !attempt.returnPath.startsWith("/") || returnUrl.hash) {
        throw new Error("Invalid Stripe checkout return address.");
      }
      // Existing attempts retain the exact callback URLs sent with their original retry key.
      const cancelUrl = new URL(returnUrl);
      if (cancelUrl.searchParams.get("stripe") === "return") cancelUrl.searchParams.delete("stripe");
      const paymentMethod = attempt.paymentMethod ?? "card";
      const customer = paymentMethod === "card" ? attempt.stripeCustomerId : null;
      if (customer != null && !/^cus_[A-Za-z0-9]+$/.test(customer)) {
        throw new Error("Invalid Stripe checkout customer.");
      }
      const params = new URLSearchParams({
        mode: "payment",
        "allowed_payment_method_types[0]": paymentMethod,
        "adaptive_pricing[enabled]": "false",
        client_reference_id: attempt.id,
        expires_at: String(attempt.expiresAtSeconds),
        success_url: returnUrl.href,
        cancel_url: cancelUrl.href,
        "line_items[0][price_data][currency]": "dkk",
        "line_items[0][price_data][unit_amount]": String(attempt.amountCents),
        "line_items[0][price_data][product_data][name]": "Appointment checkout",
        "line_items[0][quantity]": "1",
      });
      if (customer) params.set("customer", customer);
      return call(attempt, "create", undefined, params);
    },
    retrieve(attempt: SandboxCheckoutAttempt, sessionId: string) {
      return call(attempt, "retrieve", sessionId);
    },
    async expire(attempt: SandboxCheckoutAttempt, sessionId: string) {
      const before = await call(attempt, "retrieve", sessionId);
      if (before.state !== "open") return before;
      try {
        const outcome = await call(attempt, "expire", sessionId);
        if (outcome.state === "expired") return outcome;
      } catch {
        // A payment may have completed while Stripe processed expiration.
        // Re-read the same session before allowing Waybook to release the balance.
      }
      const after = await call(attempt, "retrieve", sessionId);
      if (after.state === "open") throw new Error("Stripe could not close this checkout session.");
      return after;
    },
  };
}

export function stripeCheckoutSandbox(config: SandboxPaymentConfig, request: typeof fetch = fetch) {
  return stripeCheckout({ ...config, livemode: false }, request);
}
