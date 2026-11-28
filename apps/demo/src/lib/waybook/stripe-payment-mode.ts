import "server-only";

import { controlDb, findTenantById } from "./database";
import { stripeLiveConfig, stripeSandboxConfig, type StripeLiveConfig, type StripeSandboxConfig } from "./stripe-connect-api";
import { stripeSandboxTenantForAccount } from "./stripe-sandbox";

export type StripePaymentConfig = (StripeSandboxConfig & { livemode?: false }) |
  (StripeLiveConfig & { livemode: true; allowNewPayments: boolean });

export function stripeLiveWebhookSecret(env: NodeJS.ProcessEnv) {
  const secret = env.WAYBOOK_STRIPE_LIVE_WEBHOOK_SECRET?.trim();
  return env.VERCEL_ENV === "production" && secret && /^whsec_[A-Za-z0-9]+$/.test(secret) &&
    secret !== env.WAYBOOK_STRIPE_SANDBOX_WEBHOOK_SECRET?.trim() ? secret : null;
}

export function stripeAppointmentPaymentConfig(env: NodeJS.ProcessEnv): StripePaymentConfig | null {
  if (env.VERCEL_ENV !== "production") return stripeSandboxConfig(env);
  const config = stripeLiveConfig(env);
  if (!config) return null;
  return {
    ...config,
    livemode: true,
    allowNewPayments: env.WAYBOOK_STRIPE_LIVE_COLLECTION_ENABLED === "true" && Boolean(stripeLiveWebhookSecret(env)),
  };
}

export function stripeCanStartPayment(config: StripePaymentConfig) {
  return config.livemode !== true || config.allowNewPayments;
}

export async function stripePaymentAccount(tenantId: string, config: StripePaymentConfig) {
  const [connection] = config.livemode
    ? await controlDb<{ accountId: string }[]>`
        SELECT account_id AS "accountId" FROM waybook_stripe_live_connections
        WHERE tenant_id = ${tenantId} AND account_id IS NOT NULL
      `
    : await controlDb<{ accountId: string }[]>`
        SELECT account_id AS "accountId" FROM waybook_stripe_sandbox_connections
        WHERE tenant_id = ${tenantId} AND account_id IS NOT NULL
      `;
  return connection?.accountId ?? null;
}

export async function stripePaymentTenantForAccount(accountId: string, config: StripePaymentConfig) {
  if (!config.livemode) return stripeSandboxTenantForAccount(accountId);
  const [connection] = await controlDb<{ tenantId: string }[]>`
    SELECT tenant_id AS "tenantId" FROM waybook_stripe_live_connections WHERE account_id = ${accountId}
  `;
  const tenant = connection ? await findTenantById(connection.tenantId) : null;
  return tenant?.lifecycleStatus === "active" ? tenant : null;
}
