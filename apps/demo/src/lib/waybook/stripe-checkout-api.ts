import type { StripeSandboxConfig } from "./stripe-connect-api";

const checkoutSessions = "https://api.stripe.com/v1/checkout/sessions";
const sessionIdPattern = /^cs_test_[A-Za-z0-9]+$/;

export type SandboxCheckoutAttempt = {
  id: string;
  accountId: string;
  amountCents: number;
  expiresAtSeconds: number;
  returnPath: string;
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
  amount_total?: unknown;
  currency?: unknown;
  expires_at?: unknown;
  status?: unknown;
  payment_status?: unknown;
  payment_method_types?: unknown;
  payment_intent?: unknown;
  url?: unknown;
};

function verifySession(
  session: SessionResponse | null,
  attempt: SandboxCheckoutAttempt,
  expectedId?: string,
): SandboxCheckoutSession {
  if (typeof session?.id !== "string" || !sessionIdPattern.test(session.id) ||
      (expectedId !== undefined && session.id !== expectedId) ||
      session.object !== "checkout.session" || session.livemode !== false || session.mode !== "payment" ||
      session.client_reference_id !== attempt.id || session.amount_total !== attempt.amountCents ||
      session.currency !== "dkk" || session.expires_at !== attempt.expiresAtSeconds ||
      !Array.isArray(session.payment_method_types) || session.payment_method_types.length !== 1 ||
      session.payment_method_types[0] !== "card") {
    throw new Error("Stripe did not confirm the expected sandbox checkout session.");
  }
  const id = session.id;
  if (session.status === "complete" && session.payment_status === "paid" &&
      typeof session.payment_intent === "string" && /^pi_[A-Za-z0-9]+$/.test(session.payment_intent)) {
    return { id, state: "paid", paymentIntentId: session.payment_intent };
  }
  if (session.payment_status === "unpaid") {
    if (session.status === "complete") return { id, state: "processing" };
    if (session.status === "expired") return { id, state: "expired" };
    if (session.status === "open" && typeof session.url === "string" && URL.canParse(session.url)) {
      const url = new URL(session.url);
      if (url.origin === "https://checkout.stripe.com" && !url.username && !url.password &&
          url.pathname === `/c/pay/${id}`) return { id, state: "open", url: url.href };
    }
  }
  throw new Error("Stripe returned an unexpected checkout outcome.");
}

export function stripeCheckoutSandbox(config: StripeSandboxConfig, request: typeof fetch = fetch) {
  async function call(
    attempt: SandboxCheckoutAttempt,
    operation: "create" | "retrieve" | "expire",
    sessionId?: string,
    body?: URLSearchParams,
  ) {
    if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(config.secretKey) ||
        !/^acct_[A-Za-z0-9]+$/.test(attempt.accountId) ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attempt.id) ||
        !Number.isInteger(attempt.amountCents) || attempt.amountCents <= 0 || attempt.amountCents > 10_000_000 ||
        !Number.isSafeInteger(attempt.expiresAtSeconds) || attempt.expiresAtSeconds <= 0 ||
        (sessionId !== undefined && !sessionIdPattern.test(sessionId))) {
      throw new Error("Invalid Stripe sandbox checkout context.");
    }
    const sessionPath = sessionId ? `${checkoutSessions}/${sessionId}` : checkoutSessions;
    const response = await request(operation === "expire" ? `${sessionPath}/expire` : sessionPath, {
      method: operation === "retrieve" ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": "2026-11-18.endive",
        "Stripe-Account": attempt.accountId,
        ...(operation === "create" ? { "Idempotency-Key": attempt.id } : {}),
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Stripe sandbox checkout is temporarily unavailable.");
    return verifySession(await response.json(), attempt, sessionId);
  }

  return {
    create(attempt: SandboxCheckoutAttempt) {
      const returnUrl = new URL(attempt.returnPath, config.origin);
      if (returnUrl.origin !== config.origin || returnUrl.username || returnUrl.password ||
          !attempt.returnPath.startsWith("/") || returnUrl.hash) {
        throw new Error("Invalid Stripe checkout return address.");
      }
      return call(attempt, "create", undefined, new URLSearchParams({
        mode: "payment",
        "payment_method_types[0]": "card",
        "adaptive_pricing[enabled]": "false",
        client_reference_id: attempt.id,
        expires_at: String(attempt.expiresAtSeconds),
        success_url: returnUrl.href,
        cancel_url: returnUrl.href,
        "line_items[0][price_data][currency]": "dkk",
        "line_items[0][price_data][unit_amount]": String(attempt.amountCents),
        "line_items[0][price_data][product_data][name]": "Appointment checkout",
        "line_items[0][quantity]": "1",
      }));
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
