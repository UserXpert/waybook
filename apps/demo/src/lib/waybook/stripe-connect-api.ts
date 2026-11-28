const apiOrigin = "https://api.stripe.com";
const apiVersion = "2026-11-18.endive";
const accountPath = "/v2/core/accounts";
const accountIdPattern = /^acct_[A-Za-z0-9]+$/;
const liveSecretKeyPattern = /^(sk|rk)_live_[a-zA-Z0-9]+$/;

export type StripeSandboxConfig = { secretKey: string; origin: string };
export type StripeLiveConfig = { secretKey: string; origin: string; allowedCountries: readonly string[] };
export type StripeMerchantStatus = "pending" | "ready" | "restricted" | "disconnected";

export function stripeSandboxConfig(env: NodeJS.ProcessEnv): StripeSandboxConfig | null {
  if (env.VERCEL_ENV === "production") return null;
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

/** Test connections exposed in workspace settings. Production sales never use this config. */
export function stripeWorkspaceSandboxConfig(env: NodeJS.ProcessEnv): StripeSandboxConfig | null {
  if (env.VERCEL_ENV !== "production") return stripeSandboxConfig(env);
  const origin = env.WAYBOOK_STRIPE_WORKSPACE_SANDBOX_ORIGIN?.trim();
  if (!origin?.startsWith("https://")) return null;
  return stripeSandboxConfig({
    NODE_ENV: env.NODE_ENV,
    WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: env.WAYBOOK_STRIPE_WORKSPACE_SANDBOX_SECRET_KEY,
    WAYBOOK_STRIPE_SANDBOX_ORIGIN: origin,
  });
}

export function stripeLiveConfig(env: NodeJS.ProcessEnv): StripeLiveConfig | null {
  if (env.VERCEL_ENV !== "production") return null;
  const secretKey = env.WAYBOOK_STRIPE_LIVE_SECRET_KEY?.trim();
  const origin = env.WAYBOOK_STRIPE_LIVE_ORIGIN?.trim();
  const countries = env.WAYBOOK_STRIPE_LIVE_COUNTRIES?.split(",").map((country) => country.trim());
  if (!secretKey || !liveSecretKeyPattern.test(secretKey) || !origin ||
      !countries?.every((country) => /^[A-Z]{2}$/.test(country))) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || (origin !== url.origin && origin !== `${url.origin}/`)) return null;
    return { secretKey, origin: url.origin, allowedCountries: [...new Set(countries)] };
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

function stripeConnect(config: StripeSandboxConfig, livemode: boolean, request: typeof fetch) {
  const mode = livemode ? "live" : "sandbox";
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
    if (!response.ok) throw new Error(`Stripe ${mode} is temporarily unavailable.`);
    return await response.json() as T;
  }

  function verifyAccount(account: StripeAccount | null, expectedId?: string): string {
    if (account?.object !== "v2.core.account" || account.livemode !== livemode ||
        typeof account.id !== "string" || !accountIdPattern.test(account.id) ||
        (expectedId !== undefined && account.id !== expectedId)) {
      throw new Error(`Stripe did not confirm the expected ${mode} account.`);
    }
    return account.id;
  }

  return {
    async createMerchant(creationKey: string, country: string) {
      const account = await call<StripeAccount>(accountPath, {
        dashboard: "full",
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        identity: { country },
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

    async merchantOnboardingLink(accountId: string, settingsPath: string, feedbackKey: "stripe" | "sandbox" = "stripe") {
      const settings = new URL(settingsPath, config.origin);
      if (settings.origin !== config.origin || !accountIdPattern.test(accountId) ||
          (livemode && (settings.username || settings.password || settings.hash))) {
        throw new Error("Invalid Stripe onboarding context.");
      }
      const refresh = new URL(settings);
      refresh.searchParams.set(feedbackKey, "resume");
      settings.searchParams.set(feedbackKey, "returned");
      const link = await call<{ account?: unknown; url?: unknown; livemode?: unknown }>("/v2/core/account_links", {
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            return_url: settings.href,
            refresh_url: refresh.href,
          },
        },
      });
      if (link?.livemode !== livemode || link.account !== accountId || typeof link.url !== "string") {
        throw new Error(`Stripe did not return a ${mode} onboarding link.`);
      }
      const url = new URL(link.url);
      if ((url.origin !== "https://accounts.stripe.com" && url.origin !== "https://connect.stripe.com") ||
          url.username || url.password) {
        throw new Error("Stripe returned an unexpected onboarding destination.");
      }
      return url.href;
    },
  };
}

export function stripeConnectSandbox(config: StripeSandboxConfig, request: typeof fetch = fetch) {
  const stripe = stripeConnect(config, false, request);
  return {
    ...stripe,
    createMerchant: (creationKey: string) => stripe.createMerchant(creationKey, "DK"),
  };
}

export function stripeConnectLive(config: StripeLiveConfig, request: typeof fetch = fetch) {
  if (!liveSecretKeyPattern.test(config.secretKey)) throw new Error("Invalid live Stripe key.");
  const stripe = stripeConnect(config, true, request);
  return {
    ...stripe,
    async createMerchant(creationKey: string, country: string) {
      if (!config.allowedCountries.includes(country)) throw new Error("This country is not enabled for live Stripe onboarding.");
      return stripe.createMerchant(creationKey, country);
    },
  };
}
