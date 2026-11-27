import "server-only";

import type { tenantDb } from "./database";
import { appointmentStripeAccount, appointmentStripeConfig } from "./stripe-appointment-checkout";
import { stripeCardSetupSandbox } from "./stripe-card-setup-api";
import { stripeConnectSandbox, type StripeSandboxConfig } from "./stripe-connect-api";

type ClientContext = { db: ReturnType<typeof tenantDb>; tenantId: string; customerId: string };
type CardContext = ClientContext & { accountId: string };
type CardRow = {
  stripeCustomerId: string | null;
  creationKey: string;
  createdAt: Date;
  setupId: string | null;
  returnUrl: string | null;
  expiresAt: number | null;
  sessionId: string | null;
  brand: string | null;
  last4: string | null;
};

async function readCard({ db, tenantId, customerId, accountId }: CardContext) {
  const [card] = await db<CardRow[]>`
    SELECT stripe_customer_id AS "stripeCustomerId", creation_key AS "creationKey", created_at AS "createdAt",
      setup_id AS "setupId", setup_return_url AS "returnUrl", setup_expires_at AS "expiresAt",
      setup_session_id AS "sessionId", card_brand AS brand, card_last4 AS "last4"
    FROM stripe_sandbox_client_cards
    WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND account_id = ${accountId}
  `;
  return card;
}

export async function appointmentClientCard(client: ClientContext) {
  if (!appointmentStripeConfig()) return null;
  const accountId = await appointmentStripeAccount(client.tenantId);
  if (!accountId) return null;
  const card = await readCard({ ...client, accountId });
  return card?.brand && card.last4
    ? { brand: card.brand, last4: card.last4, pending: false }
    : { brand: null, last4: null, pending: Boolean(card?.setupId) };
}

export async function runClientCardSetup(
  context: CardContext,
  config: StripeSandboxConfig,
  input: { action: "open" | "return"; actorId: string; returnUrl: string },
) {
  const { db, tenantId, customerId, accountId } = context;
  const provider = stripeCardSetupSandbox(config, accountId);
  let row = await readCard(context);
  if (row?.brand) return { state: "saved" } as const;
  if (input.action === "open") {
    if (await stripeConnectSandbox(config).merchantStatus(accountId) !== "ready") {
      throw new Error("Finish Stripe setup in Settings before adding a credit card.");
    }
    if (!row) {
      await db`
        INSERT INTO stripe_sandbox_client_cards (tenant_id, customer_id, account_id)
        VALUES (${tenantId}, ${customerId}, ${accountId}) ON CONFLICT DO NOTHING
      `;
      row = await readCard(context);
    }
    if (!row) throw new Error("Could not start the client's card setup.");
    if (!row.stripeCustomerId) {
      // Stripe may discard idempotency keys after 24 hours. Don't replay an ambiguous creation after that window.
      if (Date.now() - row.createdAt.getTime() >= 23 * 60 * 60_000) {
        throw new Error("This client's Stripe setup needs to be reviewed before retrying.");
      }
      const stripeCustomerId = await provider.createCustomer(row.creationKey);
      await db`
        UPDATE stripe_sandbox_client_cards SET stripe_customer_id = ${stripeCustomerId}
        WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND account_id = ${accountId}
          AND stripe_customer_id IS NULL
      `;
    }
    await db`
      UPDATE stripe_sandbox_client_cards SET setup_id = gen_random_uuid(), setup_return_url = ${input.returnUrl},
        setup_expires_at = floor(extract(epoch FROM now()))::int + 7200, setup_actor_id = ${input.actorId}
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND account_id = ${accountId}
        AND setup_id IS NULL AND card_brand IS NULL
    `;
    row = await readCard(context);
  }
  if (row?.brand) return { state: "saved" } as const;
  if (!row?.setupId || !row.returnUrl || !row.stripeCustomerId || !row.expiresAt ||
      (input.action === "return" && !row.sessionId)) return { state: "waiting" } as const;

  const setup = { id: row.setupId, customer: row.stripeCustomerId, expiresAt: row.expiresAt, returnUrl: row.returnUrl };
  const expiredWithoutSession = !row.sessionId && Date.now() >= setup.expiresAt * 1000;
  if (!row.sessionId && !expiredWithoutSession && setup.expiresAt * 1000 - Date.now() < 31 * 60_000) {
    return { state: "waiting" } as const;
  }
  const outcome = expiredWithoutSession ? null : row.sessionId
    ? await provider.retrieve(setup, row.sessionId)
    : await provider.create(setup);

  if (outcome?.state === "open" || outcome?.state === "processing") {
    const [savedSession] = await db<{ id: string }[]>`
      UPDATE stripe_sandbox_client_cards SET setup_session_id = ${outcome.id}
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND account_id = ${accountId}
        AND setup_id = ${setup.id} AND (setup_session_id IS NULL OR setup_session_id = ${outcome.id})
      RETURNING setup_id AS id
    `;
    if (!savedSession || outcome.state === "processing") return { state: "waiting" } as const;
    return outcome;
  }

  const saved = outcome?.state === "saved";
  if (saved) await provider.allowCardRedisplay(setup, outcome.paymentMethodId);
  const card = saved ? outcome.card : null;
  const [updated] = await db<{ brand: string | null }[]>`
    UPDATE stripe_sandbox_client_cards SET card_brand = ${card?.brand ?? null}, card_last4 = ${card?.last4 ?? null},
      consented_by = CASE WHEN ${saved} THEN setup_actor_id END,
      consented_at = CASE WHEN ${saved} THEN to_timestamp(setup_expires_at - 7200) END,
      setup_id = NULL, setup_return_url = NULL, setup_expires_at = NULL, setup_actor_id = NULL, setup_session_id = NULL
    WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND account_id = ${accountId}
      AND setup_id = ${setup.id}
    RETURNING card_brand AS brand
  `;
  if (updated?.brand || (!updated && (await readCard(context))?.brand)) return { state: "saved" } as const;
  return { state: "expired" } as const;
}
