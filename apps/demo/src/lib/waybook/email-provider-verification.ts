import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { activeEmailCredential } from "./email-provider-connection";
import { sendWithResend } from "./resend-delivery";

type Send = typeof sendWithResend;
type Claimed = { id: string; attemptId: string; startedAt: Date; sender: string };
export type VerificationOutcome = "accepted" | "busy" | "not_available" | "retry" | "rejected" | "review";

/** Called only by an authorized manager who requested a test email to their sender. */
export async function sendEmailProviderTest(db: Sql, tenantId: string, resolveKey: (id: string) => Buffer | undefined, send: Send = sendWithResend): Promise<VerificationOutcome> {
  const claim = randomUUID(), newAttempt = randomUUID();
  const [row] = await db.unsafe<Claimed[]>(`UPDATE email_provider_connections SET
      verification_attempt_id=CASE WHEN verification_started_at IS NULL OR verification_started_at<now()-interval '23 hours' THEN $3 ELSE verification_attempt_id END,
      verification_started_at=CASE WHEN verification_started_at IS NULL OR verification_started_at<now()-interval '23 hours' THEN now() ELSE verification_started_at END,
      verification_claim_token=$2,verification_claim_until=now()+interval '2 minutes'
    WHERE tenant_id=$1 AND revoked_at IS NULL AND verified_at IS NULL AND verification_accepted_at IS NULL
      AND (verification_claim_until IS NULL OR verification_claim_until<=now())
    RETURNING id,verification_attempt_id AS "attemptId",verification_started_at AS "startedAt",sender_email AS sender`, [tenantId, claim, newAttempt]);
  if (!row) {
    const [existing] = await db.unsafe<{ busy: boolean }[]>(`SELECT verification_claim_until>now() AS busy FROM email_provider_connections WHERE tenant_id=$1 AND revoked_at IS NULL AND verified_at IS NULL AND verification_accepted_at IS NULL`, [tenantId]);
    return existing?.busy ? "busy" : "not_available";
  }
  let result: Awaited<ReturnType<Send>>;
  try {
    const credential = await activeEmailCredential(db, tenantId, row.id, resolveKey);
    if (!credential || credential.senderEmail !== row.sender) result = { kind: "review" };
    else result = await send({ apiKey: credential.apiKey, idempotencyKey: `waybook-verification/${row.attemptId}`, firstAttemptAt: row.startedAt,
      message: { from: row.sender, to: row.sender, subject: "Waybook email connection test", text: "This is a test of your Waybook email connection. If you received it, return to Waybook and confirm receipt." } });
  } catch { result = { kind: "review" }; }
  const [updated] = await db.unsafe<{ id: string }[]>(`UPDATE email_provider_connections SET verification_claim_token=NULL,verification_claim_until=NULL,
      verification_accepted_at=CASE WHEN $4='accepted' THEN now() ELSE verification_accepted_at END,
      verification_provider_id=CASE WHEN $4='accepted' THEN $5 ELSE verification_provider_id END
    WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL AND verification_claim_token=$3 RETURNING id`, [tenantId, row.id, claim, result.kind, result.kind === "accepted" ? result.providerId : null]);
  return updated ? result.kind : "not_available";
}

/** Receipt confirmation is deliberate; provider acceptance alone is not delivery. */
export async function confirmEmailProviderTest(db: Sql, tenantId: string, actorId: string): Promise<boolean> {
  return db.begin(async (tx) => {
    const [row] = await tx.unsafe<{ id: string }[]>(`UPDATE email_provider_connections SET verified_at=now()
      WHERE tenant_id=$1 AND revoked_at IS NULL AND verified_at IS NULL AND verification_accepted_at IS NOT NULL RETURNING id`, [tenantId]);
    if (!row) return false;
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'email_provider.verified','email_provider',$3,$4::text::jsonb)", [tenantId, actorId, row.id, JSON.stringify({ provider: "resend" })]);
    return true;
  });
}
