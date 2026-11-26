const apiOrigin = "https://api.stripe.com";
const apiVersion = "2026-11-18.endive";
const accountPath = "/v2/core/accounts";
const accountIdPattern = /^acct_[A-Za-z0-9]+$/;

export type StripeSandboxConfig = { secretKey: string; origin: string };
export type StripeMerchantStatus = "pending" | "ready" | "restricted" | "disconnected";

export function stripeSandboxConfig(env: NodeJS.ProcessEnv): StripeSandboxConfig | null {
  const secretKey = env.WAYBOOK_STRIPE_SANDBOX_SECRET_KEY?.trim();
  const origin = env.WAYBOOK_STRIPE_SANDBOX_ORIGIN?.trim();
  if (!secretKey || !/^(sk|rk)_test_[a-zA-Z0-9]+$/.test(secretKey) || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return { secretKey, origin: url.origin };
  } catch {
    return null;
  }
}

type StripeAccount = {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  closed?: unknown;
  configuration?: { merchant?: { capabilities?: { card_payments?: {
    status?: unknown;
    status_details?: { code?: unknown }[];
  } } } };
};

export function stripeConnectSandbox(config: StripeSandboxConfig, request: typeof fetch = fetch) {
  async function call<T>(path: string, body?: object, idempotencyKey?: string): Promise<T | null> {
    const response = await request(apiOrigin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": apiVersion,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!body && response.status === 404) return null;
    if (!response.ok) throw new Error("Stripe sandbox is temporarily unavailable.");
    return await response.json() as T;
  }

  function verifyAccount(account: StripeAccount | null, expectedId?: string): string {
    if (account?.object !== "v2.core.account" || account.livemode !== false ||
        typeof account.id !== "string" || !accountIdPattern.test(account.id) ||
        (expectedId !== undefined && account.id !== expectedId)) {
      throw new Error("Stripe did not confirm the expected sandbox account.");
    }
    return account.id;
  }

  return {
    async createMerchant(creationKey: string) {
      const account = await call<StripeAccount>(accountPath, {
        dashboard: "full",
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        identity: { country: "DK" },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      }, creationKey);
      return verifyAccount(account);
    },

    async merchantStatus(accountId: string): Promise<StripeMerchantStatus> {
      if (!accountIdPattern.test(accountId)) throw new Error("Invalid Stripe account.");
      const account = await call<StripeAccount>(`${accountPath}/${accountId}?include%5B0%5D=configuration.merchant`);
      if (!account) return "disconnected";
      verifyAccount(account, accountId);
      if (account.closed === true) return "disconnected";
      const cards = account.configuration?.merchant?.capabilities?.card_payments;
      if (cards?.status === "active") return "ready";
      if (cards?.status === "restricted" && cards.status_details?.some(({ code }) => code !== "requirements_past_due" && code !== "requirements_pending_verification")) return "restricted";
      return "pending";
    },

    async merchantOnboardingLink(accountId: string, settingsPath: string) {
      const settings = new URL(settingsPath, config.origin);
      if (settings.origin !== config.origin || !accountIdPattern.test(accountId)) throw new Error("Invalid Stripe onboarding context.");
      const refresh = new URL(settings);
      refresh.searchParams.set("stripe", "resume");
      const link = await call<{ account?: unknown; url?: unknown; livemode?: unknown }>("/v2/core/account_links", {
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            return_url: settings.href,
            refresh_url: refresh.href,
          },
        },
      });
      if (link?.livemode !== false || link.account !== accountId || typeof link.url !== "string") {
        throw new Error("Stripe did not return a sandbox onboarding link.");
      }
      const url = new URL(link.url);
      if (url.origin !== "https://accounts.stripe.com" || url.username || url.password) {
        throw new Error("Stripe returned an unexpected onboarding destination.");
      }
      return url.href;
    },
  };
}
