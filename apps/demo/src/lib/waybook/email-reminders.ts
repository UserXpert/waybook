import type { Sql } from "postgres";
import { resendOnboardingTestSender } from "./resend-onboarding-test";

/** The unique index makes overlapping scheduler runs safe. Only future confirmed bookings qualify. */
export async function queueDueReminders(db: Sql, tenantId: string): Promise<number> {
  const rows = await db.unsafe<{ id: string }[]>(`
    INSERT INTO email_outbox (tenant_id,booking_id,message_type,recipient,payload)
    SELECT b.tenant_id,b.id,'reminder',c.email,
      jsonb_build_object('bookingId',b.id,'startsAt',to_char(b.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
    JOIN email_reminder_settings settings ON settings.tenant_id=b.tenant_id AND settings.enabled
    JOIN email_provider_connections pc ON pc.tenant_id=b.tenant_id AND pc.provider='resend' AND pc.revoked_at IS NULL AND pc.verified_at IS NOT NULL AND lower(pc.sender_email)<>$2
    WHERE b.tenant_id=$1 AND b.status='confirmed' AND b.starts_at>now()
      AND b.starts_at<=now()+(settings.lead_hours * interval '1 hour') AND c.email IS NOT NULL AND btrim(c.email)<>''
      AND NOT EXISTS (SELECT 1 FROM email_outbox existing WHERE existing.tenant_id=b.tenant_id AND existing.booking_id=b.id
        AND existing.message_type='reminder' AND NOT (existing.payload ? 'retryOf')
        AND existing.payload->>'startsAt'=to_char(b.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    ORDER BY b.starts_at,b.id LIMIT 500
    ON CONFLICT DO NOTHING RETURNING id`, [tenantId, resendOnboardingTestSender]);
  return rows.length;
}
