import "server-only";

import { controlDb } from "./database";
import { stripeConnectLive, type StripeLiveConfig } from "./stripe-connect-api";

type LiveConnection = {
  country: string;
  accountId: string | null;
  creationKey: string;
  retryable: boolean;
};

async function liveConnection(tenantId: string): Promise<LiveConnection | undefined> {
  const [connection] = await controlDb<LiveConnection[]>`
    SELECT country, account_id AS "accountId", creation_key AS "creationKey",
           creation_started_at > now() - interval '29 days' AS retryable
    FROM waybook_stripe_live_connections
    WHERE tenant_id = ${tenantId}
  `;
  return connection;
}

export async function liveMerchantStatus(tenantId: string, config: StripeLiveConfig) {
  const connection = await liveConnection(tenantId);
  if (!connection) return "unconnected";
  if (!connection.accountId) {
    return connection.retryable && config.allowedCountries.includes(connection.country) ? "pending" : "unresolved";
  }

  try {
    return await stripeConnectLive(config).merchantStatus(connection.accountId);
  } catch {
    return "unavailable";
  }
}

export async function liveOnboardingUrl(
  tenantId: string,
  config: StripeLiveConfig,
  settingsPath: string,
  country: string | null,
) {
  const requestedCountry = country?.trim() || null;
  let connection = await liveConnection(tenantId);
  if (!connection) {
    if (!requestedCountry || !config.allowedCountries.includes(requestedCountry)) {
      throw new Error("Select a supported business country to start Stripe setup.");
    }
    await controlDb`
      INSERT INTO waybook_stripe_live_connections (tenant_id, country)
      VALUES (${tenantId}, ${requestedCountry})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    connection = await liveConnection(tenantId);
    if (!connection) throw new Error("The live Stripe connection was not saved.");
  }
  if (requestedCountry && requestedCountry !== connection.country) {
    throw new Error("Stripe setup already started with a different business country.");
  }

  const stripe = stripeConnectLive(config);
  if (connection.accountId) return stripe.merchantOnboardingLink(connection.accountId, settingsPath);
  // Stop before the Stripe Accounts v2 idempotency window closes.
  if (!connection.retryable) throw new Error("The earlier Stripe setup must be reconciled before it can continue.");

  const accountId = await stripe.createMerchant(connection.creationKey, connection.country);
  const [saved] = await controlDb<{ accountId: string }[]>`
    UPDATE waybook_stripe_live_connections SET account_id = ${accountId}
    WHERE tenant_id = ${tenantId}
      AND creation_key = ${connection.creationKey} AND country = ${connection.country}
      AND (account_id IS NULL OR account_id = ${accountId})
    RETURNING account_id AS "accountId"
  `;
  if (saved?.accountId !== accountId) throw new Error("The live Stripe account could not be confirmed.");
  return stripe.merchantOnboardingLink(accountId, settingsPath);
}
