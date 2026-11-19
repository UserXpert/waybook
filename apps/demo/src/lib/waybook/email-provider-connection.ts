import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { decryptProviderSecret, encryptProviderSecret, type ProviderSecretEnvelope, type ProviderSecretKey } from "./provider-secret";
import { isResendOnboardingTestSender } from "./resend-onboarding-test";

const provider = "resend" as const;
const senderPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export type EmailConnectionInfo = { id: string; senderEmail: string; createdAt: Date };

/** Caller must authorize the manager before invoking this server-only operation. */
export async function replaceEmailConnection(db: Sql, tenantId: string, senderEmail: string, apiKey: string, key: ProviderSecretKey, actorId?: string): Promise<EmailConnectionInfo> {
  const sender = senderEmail.trim();
  const credential = apiKey.trim();
  if (!tenantId || !senderPattern.test(sender) || sender.length > 254 || !credential || /[\r\n]/.test(credential) || isResendOnboardingTestSender(sender)) throw new Error("Enter a valid sender address and provider credential.");
  const id = randomUUID();
  const envelope = encryptProviderSecret(credential, { tenantId, connectionId: id, provider }, key);
  return db.begin(async (transaction) => {
    await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`email-provider:${tenantId}`]);
    await transaction.unsafe("UPDATE email_provider_connections SET revoked_at=now() WHERE tenant_id=$1 AND revoked_at IS NULL", [tenantId]);
    const [row] = await transaction.unsafe<EmailConnectionInfo[]>(`INSERT INTO email_provider_connections (id,tenant_id,provider,sender_email,encrypted_secret)
      VALUES ($1,$2,$3,$4,$5::text::jsonb) RETURNING id,sender_email AS "senderEmail",created_at AS "createdAt"`, [id, tenantId, provider, sender, JSON.stringify(envelope)]);
    if (actorId) await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'email_provider.connected','email_provider',$3,$4::text::jsonb)", [tenantId, actorId, id, JSON.stringify({ provider })]);
    return row;
  });
}

export async function disconnectEmailConnection(db: Sql, tenantId: string, actorId?: string): Promise<boolean> {
  return db.begin(async (transaction) => {
    await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`email-provider:${tenantId}`]);
    const rows = await transaction.unsafe<{ id: string }[]>("UPDATE email_provider_connections SET revoked_at=now() WHERE tenant_id=$1 AND revoked_at IS NULL RETURNING id", [tenantId]);
    if (actorId && rows[0]) await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'email_provider.disconnected','email_provider',$3,$4::text::jsonb)", [tenantId, actorId, rows[0].id, JSON.stringify({ provider })]);
    return rows.length > 0;
  });
}

/** Only active connections for the expected tenant can supply a delivery credential. */
export async function activeEmailCredential(db: Sql, tenantId: string, connectionId: string, resolveKey: (id: string) => Buffer | undefined): Promise<{ senderEmail: string; apiKey: string } | null> {
  const [row] = await db.unsafe<Array<{ senderEmail: string; secret: ProviderSecretEnvelope }>>(`SELECT sender_email AS "senderEmail",encrypted_secret AS secret FROM email_provider_connections
    WHERE tenant_id=$1 AND id=$2 AND provider=$3 AND revoked_at IS NULL`, [tenantId, connectionId, provider]);
  if (!row) return null;
  return { senderEmail: row.senderEmail, apiKey: decryptProviderSecret(row.secret, { tenantId, connectionId, provider }, resolveKey) };
}
