import "server-only";

import { getAvailableSlots, type AvailabilityOverrideInput, type AvailabilityRuleInput, type BookingInput } from "@thebookingkit/core";
import { withSerializableRetry } from "@thebookingkit/server";
import { createHash, randomBytes } from "node:crypto";
import type { TenantRecord } from "./database";
import { tenantDb } from "./database";
import { isPublicBookingStartAllowed } from "./public-booking-rules";

type Service = { id: string; durationMinutes: number };
type Location = { id: string; timezone: string };
type LocationHours = { dayOfWeek: number; startTime: string; endTime: string };

async function resolvedLocation(tenant: TenantRecord, requestedId?: string, db = tenantDb(tenant)) {
  const rows = requestedId ? await db<Location[]>`SELECT id, timezone FROM locations WHERE tenant_id=${tenant.id} AND id=${requestedId} AND is_active=TRUE AND is_online_bookable=TRUE` : await db<Location[]>`SELECT id, timezone FROM locations WHERE tenant_id=${tenant.id} AND slug='primary' AND is_active=TRUE AND is_online_bookable=TRUE LIMIT 1`;
  if (!rows[0]) throw new Error("Location is unavailable.");
  return rows[0];
}

async function resolvedLocationId(tenant: TenantRecord, requestedId?: string) {
  return (await resolvedLocation(tenant, requestedId)).id;
}

function localDateAndMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  return { localDate, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

/** True only when an entire appointment falls within configured local opening hours. */
export function isSlotWithinLocationHours(start: Date, end: Date, hours: LocationHours[], timezone: string) {
  const startLocal = localDateAndMinutes(start, timezone);
  const endLocal = localDateAndMinutes(end, timezone);
  if (startLocal.localDate !== endLocal.localDate) return false;
  const dayOfWeek = new Date(`${startLocal.localDate}T12:00:00Z`).getUTCDay();
  return hours.some((hour) => hour.dayOfWeek === dayOfWeek && startLocal.minutes >= Number(hour.startTime.slice(0, 2)) * 60 + Number(hour.startTime.slice(3, 5)) && endLocal.minutes <= Number(hour.endTime.slice(0, 2)) * 60 + Number(hour.endTime.slice(3, 5)));
}

/** Calculates tenant-scoped slots from persisted services, schedules, bookings, and active holds. */
export async function availableSlots(tenant: TenantRecord, serviceSlug: string, startsAt: Date, endsAt: Date, options?: { excludeBookingBlockId?: string; locationId?: string; slotInterval?: number; durationMinutes?: number }, db = tenantDb(tenant)) {
  const location = await resolvedLocation(tenant, options?.locationId, db);
  const locationId = location.id;
  const locationHours = await db<LocationHours[]>`SELECT day_of_week AS "dayOfWeek", start_time AS "startTime", end_time AS "endTime" FROM location_hours WHERE tenant_id = ${tenant.id} AND location_id = ${locationId}`;
  const closedDates = new Set((await db<{ localDate: string }[]>`SELECT local_date::text AS "localDate" FROM location_closed_dates WHERE tenant_id = ${tenant.id} AND location_id = ${locationId} AND local_date >= ${startsAt.toISOString().slice(0, 10)}::date AND local_date <= ${endsAt.toISOString().slice(0, 10)}::date`).map((row) => row.localDate));
  const [service] = await db<Service[]>`SELECT id, duration_minutes AS "durationMinutes" FROM services WHERE tenant_id = ${tenant.id} AND (slug = ${serviceSlug} OR id::text = ${serviceSlug}) AND is_active = true LIMIT 1`;
  if (!service) throw new Error("Service not found.");
  await db`UPDATE booking_blocks SET state = 'expired' WHERE tenant_id = ${tenant.id} AND state = 'held' AND expires_at <= now()`;
  const members = await db<{ id: string }[]>`SELECT tm.id FROM team_members tm JOIN service_team_members stm ON stm.team_member_id = tm.id AND stm.tenant_id = tm.tenant_id JOIN team_member_locations tml ON tml.team_member_id=tm.id AND tml.tenant_id=tm.tenant_id AND tml.location_id=${locationId} JOIN service_locations sl ON sl.service_id=stm.service_id AND sl.tenant_id=stm.tenant_id AND sl.location_id=${locationId} WHERE stm.tenant_id = ${tenant.id} AND stm.service_id = ${service.id} AND tm.is_active = true ORDER BY tm.id`;
  const durationMinutes = options?.durationMinutes ?? service.durationMinutes;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("Appointment duration is invalid.");
  const result = [];
  for (const member of members) {
    const rules = await db<AvailabilityRuleInput[]>`SELECT rrule, start_time AS "startTime", end_time AS "endTime", timezone, valid_from AS "validFrom", valid_until AS "validUntil" FROM availability_rules WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id}`;
    // `local_date` is a calendar date, not an instant. Construct midnight UTC explicitly so
    // core compares its UTC date components to the provider-local slot date consistently.
    const overrides = await db<AvailabilityOverrideInput[]>`SELECT (local_date::timestamp AT TIME ZONE 'UTC') AS date, start_time AS "startTime", end_time AS "endTime", is_unavailable AS "isUnavailable" FROM availability_overrides WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id}`;
    // Waybook reserves exactly the customer-facing appointment interval. Setup
    // or cleanup must never make a neighbouring customer slot disappear.
    // Blocks are the actual capacity reservation. Reading them directly keeps
    // active holds out of the advertised calendar, rather than discovering
    // the conflict only when PostgreSQL rejects the final write.
    const occupied = await db<BookingInput[]>`SELECT starts_at AS "startsAt", ends_at AS "endsAt", 'confirmed' AS status FROM booking_blocks WHERE tenant_id = ${tenant.id} AND team_member_id = ${member.id} AND state IN ('held', 'confirmed') AND (${options?.excludeBookingBlockId ?? null}::uuid IS NULL OR id <> ${options?.excludeBookingBlockId ?? null}::uuid)`;
    // Waybook intentionally has no setup/cleanup buffer concept. The booked
    // interval is the entire capacity reservation: 08:00–09:00 and 10:00–11:00
    // may sit beside a 09:00–10:00 appointment, while 08:30–09:30 correctly
    // remains unavailable because it genuinely overlaps that appointment.
    const slots = getAvailableSlots(rules, overrides, occupied, { start: startsAt, end: endsAt }, tenant.timezone, {
      duration: durationMinutes,
      slotInterval: options?.slotInterval,
      bufferBefore: 0,
      bufferAfter: 0,
    })
      .filter((slot) => !closedDates.has(localDateAndMinutes(new Date(slot.startTime), location.timezone).localDate) && isSlotWithinLocationHours(new Date(slot.startTime), new Date(slot.endTime), locationHours, location.timezone))
      // Resource allocation is deliberately post-booking. Staff time is the
      // sole availability reservation, so a room/equipment conflict never
      // hides an otherwise valid appointment slot.
      .map((slot) => ({ ...slot, resourceId: null }));
    result.push({ teamMemberId: member.id, slots });
  }
  return result;
}

/** Creates a ten-minute hold. PostgreSQL exclusion constraints remain authoritative for conflicts. */
export async function createBookingHold(input: { tenant: TenantRecord; serviceId: string; teamMemberId: string; startsAt: Date; endsAt: Date; locationId?: string }) {
  const db = tenantDb(input.tenant);
  const locationId = await resolvedLocationId(input.tenant, input.locationId);
  return withSerializableRetry(async () => db.begin(async (transaction) => {
    if (!isPublicBookingStartAllowed(input.startsAt)) throw new Error("The selected appointment time is no longer available.");
    await transaction.unsafe("UPDATE booking_blocks SET state = 'expired' WHERE tenant_id = $1 AND state = 'held' AND expires_at <= now()", [input.tenant.id]);
    const [service] = await transaction.unsafe<Service[]>(`
      SELECT id, duration_minutes AS "durationMinutes"
      FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true
    `, [input.serviceId, input.tenant.id]);
    if (!service) throw new Error("Service is unavailable.");
    const [assignment] = await transaction.unsafe<{ id: string; name: string }[]>(`
      SELECT tm.id, tm.name FROM team_members tm
      JOIN service_team_members stm ON stm.team_member_id = tm.id AND stm.tenant_id = tm.tenant_id
      JOIN team_member_locations tml ON tml.team_member_id=tm.id AND tml.tenant_id=tm.tenant_id AND tml.location_id=$4
      JOIN service_locations sl ON sl.service_id=stm.service_id AND sl.tenant_id=stm.tenant_id AND sl.location_id=$4
      WHERE tm.id = $1 AND stm.service_id = $2 AND tm.tenant_id = $3 AND tm.is_active = true
    `, [input.teamMemberId, service.id, input.tenant.id, locationId]);
    if (!assignment) throw new Error("Team member cannot provide this service.");
    if (input.endsAt.getTime() - input.startsAt.getTime() !== service.durationMinutes * 60_000) {
      throw new Error("The selected appointment duration is invalid.");
    }
    const [block] = await transaction.unsafe<{ id: string; expiresAt: Date }[]>(`
      INSERT INTO booking_blocks (tenant_id, team_member_id, resource_id, location_id, starts_at, ends_at, state, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'held', now() + interval '10 minutes')
      RETURNING id, expires_at AS "expiresAt"
    `, [input.tenant.id, input.teamMemberId, null, locationId, input.startsAt, input.endsAt]);
    const [hold] = await transaction.unsafe<{ id: string }[]>(`
      INSERT INTO booking_holds (tenant_id, booking_block_id, service_id, location_id, expires_at, scheduled_starts_at, scheduled_ends_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [input.tenant.id, block.id, input.serviceId, locationId, block.expiresAt, input.startsAt, input.endsAt]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'hold.created', 'booking_hold', $2, $3::jsonb)", [input.tenant.id, hold.id, JSON.stringify({ blockId: block.id })]);
    return { holdId: hold.id, expiresAt: block.expiresAt, teamMember: assignment };
  }));
}

type ConfirmedBooking = { id: string; bookingNumber: string; startsAt: Date; endsAt: Date };

/** Confirms one valid hold atomically and queues a local confirmation email. */
export async function confirmBookingFromHold(input: {
  tenant: TenantRecord;
  holdId: string;
  customer: { name: string; email: string; phone?: string | null };
  idempotencyKey: string;
  policyAcknowledgement?: { policyVersion: string; policyUrl: string | null; policyText?: string };
  verifiedEmbedSource?: string;
}) {
  const db = tenantDb(input.tenant);
  const normalizedEmail = input.customer.email.trim().toLowerCase();
  const name = input.customer.name.trim();
  if (!name || !normalizedEmail || !input.idempotencyKey) throw new Error("Customer details and idempotency key are required.");

  return withSerializableRetry(async () => db.begin(async (transaction) => {
    const [existing] = await transaction.unsafe<ConfirmedBooking[]>(`
      SELECT id, booking_number AS "bookingNumber", starts_at AS "startsAt", ends_at AS "endsAt"
      FROM bookings WHERE tenant_id = $1 AND idempotency_key = $2
    `, [input.tenant.id, input.idempotencyKey]);
    if (existing) return { booking: existing, managementToken: null, idempotent: true };

    const [hold] = await transaction.unsafe<{
      id: string; bookingBlockId: string; serviceId: string; locationId: string; expiresAt: Date; startsAt: Date; endsAt: Date; teamMemberId: string | null; resourceId: string | null; blockState: string;
    }[]>(`
      SELECT h.id, h.booking_block_id AS "bookingBlockId", h.service_id AS "serviceId", h.location_id AS "locationId", h.expires_at AS "expiresAt",
        h.scheduled_starts_at AS "startsAt", h.scheduled_ends_at AS "endsAt", b.team_member_id AS "teamMemberId", b.resource_id AS "resourceId", b.state AS "blockState"
      FROM booking_holds h JOIN booking_blocks b ON b.id = h.booking_block_id
      WHERE h.id = $1 AND h.tenant_id = $2 FOR UPDATE OF h, b
    `, [input.holdId, input.tenant.id]);
    if (!hold || hold.blockState !== "held" || hold.expiresAt <= new Date() || !hold.startsAt || !hold.endsAt || !isPublicBookingStartAllowed(hold.startsAt)) {
      throw new Error("This hold is no longer available.");
    }
    const [customer] = await transaction.unsafe<{ id: string }[]>(`
      INSERT INTO customers (tenant_id, email, name, phone)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, email) DO UPDATE SET email = customers.email
      RETURNING id
    `, [input.tenant.id, normalizedEmail, name, input.customer.phone?.trim() || null]);
    await transaction.unsafe("UPDATE booking_blocks SET state = 'confirmed', expires_at = NULL WHERE id = $1 AND tenant_id = $2", [hold.bookingBlockId, input.tenant.id]);
    const [service] = await transaction.unsafe<{ priceCents: number }[]>(`
      SELECT price_cents AS "priceCents" FROM services WHERE id = $1 AND tenant_id = $2 FOR SHARE
    `, [hold.serviceId, input.tenant.id]);
    if (!service) throw new Error("The selected service is unavailable.");
    const [booking] = await transaction.unsafe<ConfirmedBooking[]>(`
      INSERT INTO bookings (tenant_id, booking_block_id, hold_id, service_id, location_id, team_member_id, resource_id, customer_id, starts_at, ends_at, booked_price_cents, status, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12)
      RETURNING id, booking_number AS "bookingNumber", starts_at AS "startsAt", ends_at AS "endsAt"
    `, [input.tenant.id, hold.bookingBlockId, hold.id, hold.serviceId, hold.locationId, hold.teamMemberId, hold.resourceId, customer.id, hold.startsAt, hold.endsAt, service.priceCents, input.idempotencyKey]);
    const managementToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(managementToken).digest("hex");
    await transaction.unsafe(`
      INSERT INTO customer_management_tokens (tenant_id, booking_id, token_hash, action_scope, expires_at)
      VALUES ($1, $2, $3, 'view', now() + interval '30 days')
    `, [input.tenant.id, booking.id, tokenHash]);
    await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.confirmed', $3::text::jsonb)", [input.tenant.id, booking.id, JSON.stringify({ holdId: hold.id, source: "public" })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.confirmed', 'booking', $2, $3::text::jsonb)", [input.tenant.id, booking.id, JSON.stringify({ holdId: hold.id, source: "public" })]);
    if (input.policyAcknowledgement) await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.policy_acknowledged', 'booking', $2, $3::text::jsonb)", [input.tenant.id, booking.id, JSON.stringify(input.policyAcknowledgement)]);
    if (input.verifiedEmbedSource) await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.embed_source_verified', 'booking', $2, $3::text::jsonb)", [input.tenant.id, booking.id, JSON.stringify({ source: input.verifiedEmbedSource })]);
    await transaction.unsafe("INSERT INTO email_outbox (tenant_id, booking_id, message_type, recipient, payload) VALUES ($1, $2, 'confirmation', $3, $4::text::jsonb)", [input.tenant.id, booking.id, normalizedEmail, JSON.stringify({ bookingId: booking.id, bookingNumber: booking.bookingNumber, managementToken })]);
    return { booking, managementToken, idempotent: false };
  }));
}
