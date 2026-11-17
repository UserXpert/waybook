import type { Sql } from "postgres";
import { decryptProviderSecret, encryptProviderSecret, type ProviderSecretEnvelope, type ProviderSecretKey } from "./provider-secret";

/** Re-encrypt one tenant atomically while serializing connection changes. */
export async function rotateTenantProviderKeys(db: Sql, tenantId: string, active: ProviderSecretKey, resolve: (id: string) => Buffer | undefined): Promise<number> {
  return db.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`email-provider:${tenantId}`]);
    const rows = await tx.unsafe<Array<{ id: string; provider: string; secret: ProviderSecretEnvelope }>>(`SELECT id,provider,encrypted_secret AS secret FROM email_provider_connections WHERE tenant_id=$1 AND encrypted_secret->>'keyId' IS DISTINCT FROM $2 ORDER BY id FOR UPDATE`, [tenantId, active.id]);
    for (const row of rows) {
      const context = { tenantId, connectionId: row.id, provider: row.provider };
      const secret = decryptProviderSecret(row.secret, context, resolve);
      const encrypted = encryptProviderSecret(secret, context, active);
      await tx.unsafe("UPDATE email_provider_connections SET encrypted_secret=$1::text::jsonb WHERE tenant_id=$2 AND id=$3", [JSON.stringify(encrypted), tenantId, row.id]);
    }
    if (rows.length) await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES ($1,'email_provider.keys_rotated','email_provider',$2,$3::text::jsonb)", [tenantId, tenantId, JSON.stringify({ keyId: active.id, count: rows.length })]);
    return rows.length;
  });
}
