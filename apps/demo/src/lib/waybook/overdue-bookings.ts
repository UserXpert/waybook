import "server-only";

import { tenantDb, type TenantRecord } from "./database";

/** Close ended, unarrived appointments using the same block-first lock order as manual status changes. */
export async function closeOverdueConfirmedBookings(tenant: TenantRecord, limit = 100): Promise<number> {
  const db = tenantDb(tenant);
  let changed = 0;
  // One booking per transaction keeps retries idempotent and avoids holding many locks.
  for (let processed = 0; processed < limit; processed++) {
    const updated = await db.begin(async (tx) => {
      const [block] = await tx.unsafe<{ id: string }[]>(
        `SELECT bb.id FROM booking_blocks bb JOIN bookings b ON b.booking_block_id=bb.id AND b.tenant_id=bb.tenant_id
         WHERE b.tenant_id=$1 AND b.status='confirmed' AND b.ends_at <= now()
         ORDER BY b.ends_at,b.id LIMIT 1 FOR UPDATE OF bb SKIP LOCKED`, [tenant.id]);
      if (!block) return false;
      const [booking] = await tx.unsafe<{ id: string }[]>(
        `UPDATE bookings SET status='no_show',updated_at=now()
         WHERE tenant_id=$1 AND booking_block_id=$2 AND status='confirmed' AND ends_at <= now() RETURNING id`, [tenant.id, block.id]);
      if (!booking) return true; // A concurrent change won; look for the next candidate.
      const metadata = JSON.stringify({ previousStatus: "confirmed", automatic: true, reason: "appointment_ended" });
      await tx.unsafe("INSERT INTO booking_events (tenant_id,booking_id,event_type,metadata) VALUES ($1,$2,'booking.no_show',$3::jsonb)", [tenant.id, booking.id, metadata]);
      await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES ($1,'booking.no_show','booking',$2,$3::jsonb)", [tenant.id, booking.id, metadata]);
      changed++;
      return true;
    });
    if (!updated) return changed;
  }
  return changed;
}
