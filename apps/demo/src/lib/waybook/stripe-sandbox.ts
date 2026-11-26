import "server-only";

import { controlDb } from "./database";
import { stripeConnectSandbox, type StripeSandboxConfig } from "./stripe-connect-api";

type Connection = { accountId: string | null; creationKey: string; retryable: boolean };

async function sandboxConnection(tenantId: string) {
  const [connection] = await controlDb<Connection[]>`
    SELECT account_id AS "accountId", creation_key AS "creationKey",
           creation_started_at > now() - interval '29 days' AS retryable
    FROM waybook_stripe_sandbox_connections WHERE tenant_id = ${tenantId}
  `;
  return connection;
}

export async function sandboxMerchantStatus(tenantId: string, config: StripeSandboxConfig) {
  const connection = await sandboxConnection(tenantId);
  if (!connection) return "unconnected";
  if (!connection.accountId) return connection.retryable ? "pending" : "unresolved";
  try {
    return await stripeConnectSandbox(config).merchantStatus(connection.accountId);
  } catch {
    return "unavailable";
  }
}

export async function sandboxOnboardingUrl(tenantId: string, config: StripeSandboxConfig, settingsPath: string) {
  await controlDb`
    INSERT INTO waybook_stripe_sandbox_connections (tenant_id) VALUES (${tenantId})
    ON CONFLICT (tenant_id) DO NOTHING
  `;
  const connection = await sandboxConnection(tenantId);
  if (!connection) throw new Error("The Stripe sandbox connection was not saved.");
  const stripe = stripeConnectSandbox(config);
  if (connection.accountId) return stripe.merchantOnboardingLink(connection.accountId, settingsPath);
  // Never submit a new create request after Stripe's safe replay window.
  if (!connection.retryable) throw new Error("The earlier Stripe setup must be reconciled before it can continue.");
  const accountId = await stripe.createMerchant(connection.creationKey);
  const [saved] = await controlDb<{ accountId: string }[]>`
    UPDATE waybook_stripe_sandbox_connections SET account_id = ${accountId}
    WHERE tenant_id = ${tenantId} AND creation_key = ${connection.creationKey}
      AND (account_id IS NULL OR account_id = ${accountId})
    RETURNING account_id AS "accountId"
  `;
  if (saved?.accountId !== accountId) throw new Error("The Stripe sandbox account could not be confirmed.");
  return stripe.merchantOnboardingLink(accountId, settingsPath);
}
