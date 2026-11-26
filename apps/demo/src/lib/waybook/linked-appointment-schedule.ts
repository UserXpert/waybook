import "server-only";

import type { Sql } from "postgres";
import { staffAvailableSlots } from "./booking";
import type { TenantRecord } from "./database";

export async function getAppointmentReservations(db: Sql, tenantId: string, bookingId: string) {
  return db<{ id: string; serviceId: string; teamMemberId: string | null; startsAt: Date; endsAt: Date; position: number; state: string }[]>`
    SELECT block.id, segment.service_id AS "serviceId", block.team_member_id AS "teamMemberId",
      block.starts_at AS "startsAt", block.ends_at AS "endsAt", segment.position, block.state
    FROM (
      SELECT tenant_id, booking_block_id, service_id, 1 AS position
      FROM bookings WHERE tenant_id=${tenantId} AND id=${bookingId}
      UNION ALL
      SELECT tenant_id, booking_block_id, service_id, position
      FROM booking_service_segments WHERE tenant_id=${tenantId} AND booking_id=${bookingId}
    ) segment
    JOIN booking_blocks block ON block.tenant_id=segment.tenant_id AND block.id=segment.booking_block_id
    ORDER BY segment.position
  `;
}

type Reservation = Awaited<ReturnType<typeof getAppointmentReservations>>[number];

export async function linkedAppointmentOpenings(
  db: Sql,
  tenant: TenantRecord,
  locationId: string,
  reservations: Reservation[],
  from: Date,
  until: Date,
  primaryInterval: number,
) {
  const primary = reservations[0];
  if (reservations.length < 2 || primary.position !== 1
    || reservations.some((item) => item.state !== "confirmed" || !item.teamMemberId)) return [];
  const toMilliseconds = (reservation: Reservation) => reservation.startsAt.getTime() - primary.startsAt.getTime();
  const excludedBlocks = reservations.map(({ id }) => id);
  const openings = await Promise.all(reservations.map(async (reservation) => {
    const offset = toMilliseconds(reservation);
    const duration = reservation.endsAt.getTime() - reservation.startsAt.getTime();
    const [provider] = await staffAvailableSlots(
      tenant, reservation.serviceId, new Date(from.getTime() + offset), new Date(until.getTime() + offset + duration),
      { locationId, teamMemberId: reservation.teamMemberId ?? undefined, durationMinutes: duration / 60_000,
        slotInterval: reservation.position === 1 ? primaryInterval : 1, excludeBookingBlockIds: excludedBlocks },
      db,
    ).catch((error: unknown) => {
      if (error instanceof Error && ["Service not found.", "Location is unavailable."].includes(error.message)) return [];
      throw error;
    });
    return new Set((provider?.slots ?? []).map(({ startTime }) => Date.parse(startTime) - offset));
  }));
  return [...openings[0]]
    .filter((startsAt) => startsAt >= from.getTime() && startsAt < until.getTime() && startsAt >= Date.now()
      && startsAt !== primary.startsAt.getTime() && openings.every((section) => section.has(startsAt)))
    .map((startsAt) => ({ teamMemberId: primary.teamMemberId ?? undefined, startTime: new Date(startsAt).toISOString(),
      endTime: new Date(startsAt + reservations.at(-1)!.endsAt.getTime() - primary.startsAt.getTime()).toISOString() }));
}
