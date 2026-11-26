import "server-only";

import type { Sql } from "postgres";

export async function arrivalAlertsEnabled(db: Sql, tenantId: string) {
  const [settings] = await db<{ enabled: boolean }[]>`
    SELECT provider_arrival_alerts_enabled AS enabled FROM tenant_settings WHERE tenant_id = ${tenantId}
  `;
  return settings?.enabled ?? false;
}

export async function canReceiveArrivalAlerts(db: Sql, tenantId: string, identityId: string) {
  const [row] = await db<{ enabled: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM tenant_settings settings
      JOIN team_members member ON member.tenant_id = settings.tenant_id
      WHERE settings.tenant_id = ${tenantId} AND settings.provider_arrival_alerts_enabled
        AND member.identity_id = ${identityId} AND member.is_active AND member.role <> 'read-only'
    ) AS enabled
  `;
  return row.enabled;
}

export function unnotifiedArrivalProviders(db: Sql, tenantId: string, bookingId: string, providers: Array<string | null>) {
  return db`
    SELECT member.id FROM team_members member
    WHERE member.tenant_id = ${tenantId} AND member.id = ANY(${providers.filter(Boolean)}::uuid[])
      AND member.is_active AND member.identity_id IS NOT NULL AND member.role <> 'read-only'
      AND NOT EXISTS (SELECT 1 FROM provider_arrival_alerts alert
        WHERE alert.tenant_id = member.tenant_id AND alert.booking_id = ${bookingId} AND alert.team_member_id = member.id)
  `;
}

export function providerArrivalInbox(db: Sql, tenantId: string, identityId: string) {
  return db`
    FROM provider_arrival_alerts alert
    JOIN bookings b ON b.tenant_id = alert.tenant_id AND b.id = alert.booking_id
    JOIN customers client ON client.tenant_id = b.tenant_id AND client.id = b.customer_id
    JOIN team_members member ON member.tenant_id = alert.tenant_id AND member.id = alert.team_member_id
    WHERE alert.tenant_id = ${tenantId} AND member.identity_id = ${identityId} AND member.is_active AND member.role <> 'read-only'
      AND b.attendance_stage = 'waiting_room' AND b.status = 'arrived'
      AND (b.team_member_id = member.id OR EXISTS (
        SELECT 1 FROM booking_service_segments segment
        JOIN booking_blocks block ON block.tenant_id = segment.tenant_id AND block.id = segment.booking_block_id
        WHERE segment.tenant_id = b.tenant_id AND segment.booking_id = b.id AND block.team_member_id = member.id
      ))
      AND EXISTS (SELECT 1 FROM tenant_settings settings WHERE settings.tenant_id = b.tenant_id AND settings.provider_arrival_alerts_enabled)
  `;
}

export async function providerArrivalAlertPending(db: Sql, tenantId: string, identityId: string) {
  const [row] = await db<{ pending: boolean }[]>`
    SELECT EXISTS (SELECT 1 ${providerArrivalInbox(db, tenantId, identityId)} AND alert.read_at IS NULL) AS pending
  `;
  return row.pending;
}
