import "server-only";

import type { TransactionSql } from "postgres";

/** Call with the appointment locked and its checkout balance settled. */
export async function completeSettledAppointment(
  transaction: TransactionSql,
  tenantId: string,
  bookingId: string,
  actorId: string | null,
) {
  const [completed] = await transaction.unsafe<{ id: string }[]>(`
    UPDATE bookings SET status = 'completed', updated_at = now()
    WHERE tenant_id = $1 AND id = $2 AND status = 'arrived' AND attendance_stage = 'checking_out'
    RETURNING id
  `, [tenantId, bookingId]);
  if (!completed) throw new Error("Open checkout from the appointment before finishing it.");

  const metadata = JSON.stringify({ previousStatus: "arrived" });
  await transaction.unsafe(`
    INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
    VALUES ($1, $2, $3, 'booking.completed', $4::text::jsonb)
  `, [tenantId, bookingId, actorId, metadata]);
  await transaction.unsafe(`
    INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
    VALUES ($1, $2, 'booking.completed', 'booking', $3, $4::text::jsonb)
  `, [tenantId, actorId, bookingId, metadata]);
}
