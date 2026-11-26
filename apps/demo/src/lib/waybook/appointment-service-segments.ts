import "server-only";
import type { Sql } from "postgres";

export async function getAdditionalAppointmentServices(db: Sql, tenantId: string, bookingId: string) {
  const rows = await db<{ id: string; title: string; priceCents: number; provider: string | null; teamMemberId: string | null; startsAt: Date; endsAt: Date }[]>`
    SELECT segment.id, service.title, segment.booked_price_cents AS "priceCents", member.name AS provider, block.team_member_id AS "teamMemberId",
      block.starts_at AS "startsAt", block.ends_at AS "endsAt"
    FROM booking_service_segments segment
    JOIN services service ON service.tenant_id = segment.tenant_id AND service.id = segment.service_id
    JOIN booking_blocks block ON block.tenant_id = segment.tenant_id AND block.id = segment.booking_block_id
    LEFT JOIN team_members member ON member.tenant_id = block.tenant_id AND member.id = block.team_member_id
    WHERE segment.tenant_id = ${tenantId} AND segment.booking_id = ${bookingId}
    ORDER BY segment.position
  `;
  return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
}
