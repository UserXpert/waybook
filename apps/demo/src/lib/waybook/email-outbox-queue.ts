import type { Sql } from "postgres";
import type { ResendMessage, ResendResult } from "./resend-delivery";

export type EmailDeliverySnapshot = { provider: "resend"; connectionId: string; bookingStartsAt: string; message: ResendMessage };
export type ClaimedEmail = { id: string; snapshot: EmailDeliverySnapshot | null; firstAttemptAt: Date | null; attemptCount: number };

/** Claim one tenant's message; expired claims can be recovered by another worker. */
export async function claimEmail(db: Sql, tenantId: string, claimToken: string, outboxId?: string): Promise<ClaimedEmail | null> {
  const [row] = await db.unsafe<ClaimedEmail[]>(`
    UPDATE email_outbox SET delivery_claim_token=$2, delivery_claim_until=now()+interval '2 minutes'
    WHERE id=(SELECT id FROM email_outbox
      WHERE tenant_id=$1 AND status='queued'
        AND ($3::uuid IS NULL OR id=$3::uuid)
        AND (delivery_next_attempt_at IS NULL OR delivery_next_attempt_at<=now())
        AND (delivery_claim_until IS NULL OR delivery_claim_until<=now())
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      AND tenant_id=$1
    RETURNING id,delivery_snapshot AS snapshot,delivery_first_attempt_at AS "firstAttemptAt",delivery_attempt_count AS "attemptCount"`, [tenantId, claimToken, outboxId ?? null]);
  return row ?? null;
}

/** Persist an immutable request before network I/O. A retry must use that same request. */
export async function prepareEmailAttempt(db: Sql, tenantId: string, id: string, claimToken: string, snapshot: EmailDeliverySnapshot): Promise<{ snapshot: EmailDeliverySnapshot; firstAttemptAt: Date } | null> {
  const [row] = await db.unsafe<Array<{ snapshot: EmailDeliverySnapshot; firstAttemptAt: Date }>>(`
    UPDATE email_outbox SET delivery_snapshot=coalesce(delivery_snapshot,$4::text::jsonb),
      delivery_first_attempt_at=coalesce(delivery_first_attempt_at,now()),delivery_attempt_count=delivery_attempt_count+1
    WHERE tenant_id=$1 AND id=$2 AND status='queued' AND delivery_claim_token=$3 AND delivery_claim_until>now()
      AND (delivery_snapshot IS NULL OR delivery_snapshot=$4::text::jsonb)
    RETURNING delivery_snapshot AS snapshot,delivery_first_attempt_at AS "firstAttemptAt"`, [tenantId, id, claimToken, JSON.stringify(snapshot)]);
  return row ?? null;
}

/** A malformed or superseded message must not be retried forever. */
export async function failUnpreparedEmail(db: Sql, tenantId: string, id: string, claimToken: string, reason: "invalid_message" | "superseded"): Promise<boolean> {
  const [row] = await db.unsafe<{ id: string }[]>(`UPDATE email_outbox SET status='failed',delivery_result=$4,
    delivery_claim_token=NULL,delivery_claim_until=NULL
    WHERE tenant_id=$1 AND id=$2 AND status='queued' AND delivery_claim_token=$3 AND delivery_snapshot IS NULL
    RETURNING id`, [tenantId, id, claimToken, reason]);
  return Boolean(row);
}

/** Only the current claimant may complete a message. Accepted is not delivered. */
export async function finishEmailAttempt(db: Sql, tenantId: string, id: string, claimToken: string, result: ResendResult): Promise<boolean> {
  const status = result.kind === "accepted" ? "sent" : result.kind === "retry" ? "queued" : "failed";
  const providerId = result.kind === "accepted" ? result.providerId : null;
  const wait = result.kind === "retry" ? Math.max(60, Math.min(result.retryAfterSeconds ?? 60, 3600)) : 0;
  const [row] = await db.unsafe<{ id: string }[]>(`
    UPDATE email_outbox SET status=$4,delivery_result=$5,delivery_provider_id=$6,
      delivery_next_attempt_at=CASE WHEN $4='queued' THEN now()+($7::int * interval '1 second') ELSE NULL END,
      delivery_claim_token=NULL,delivery_claim_until=NULL
    WHERE tenant_id=$1 AND id=$2 AND status='queued' AND delivery_claim_token=$3
      AND delivery_snapshot IS NOT NULL AND delivery_first_attempt_at IS NOT NULL
    RETURNING id`, [tenantId, id, claimToken, status, result.kind, providerId, wait]);
  return Boolean(row);
}
