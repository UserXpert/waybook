import type { Sql } from "postgres";

/** Only a definite provider rejection can be retried as a new request. */
export async function queueRejectedEmail(db: Sql, tenantId: string, emailId: string): Promise<string | null> {
  return db.begin(async (tx) => {
    const [original] = await tx.unsafe<Array<{ id: string; bookingId: string; messageType: string; recipient: string; payload: unknown }>>(`SELECT id,booking_id AS "bookingId",message_type AS "messageType",recipient,payload FROM email_outbox WHERE tenant_id=$1 AND id=$2 AND status='failed' AND delivery_result='rejected' AND message_type IN ('confirmation','cancellation','reminder') AND booking_id IS NOT NULL FOR UPDATE`, [tenantId, emailId]);
    if (!original) return null;
    const [entry] = await tx.unsafe<{ id: string }[]>(`INSERT INTO email_outbox (tenant_id,booking_id,message_type,recipient,payload) VALUES ($1,$2,$3,$4,$5::text::jsonb || jsonb_build_object('retryOf',$6::text)) RETURNING id`, [tenantId, original.bookingId, original.messageType, original.recipient, JSON.stringify(original.payload), original.id]);
    await tx.unsafe(`UPDATE email_outbox SET delivery_result='retried' WHERE tenant_id=$1 AND id=$2`, [tenantId, original.id]);
    await tx.unsafe(`INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES ($1,'email.retry_queued','email',$2,$3::text::jsonb)`, [tenantId, original.id, JSON.stringify({ retryId: entry.id })]);
    return entry.id;
  });
}
