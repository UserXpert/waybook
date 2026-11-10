import "server-only";

import { withSerializableRetry } from "@thebookingkit/server";
import { availableSlots } from "./booking";
import { tenantDb, type TenantRecord } from "./database";

type Sql = ReturnType<typeof tenantDb>;
type Booking = { id: string; bookingBlockId: string; serviceId: string; serviceTitle: string; locationId: string; locationName: string; startsAt: Date; endsAt: Date; status: string; email: string; hasFinancialActivity: boolean };
export type Credentials = { bookingId: string; email: string };

/** No details are returned unless both credentials match inside the resolved tenant. */
async function findBooking(db: Sql, tenantId: string, credentials: Credentials): Promise<Booking | null> {
  const [booking] = await db<Booking[]>`
    SELECT b.id, b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId",
      s.title AS "serviceTitle", b.location_id AS "locationId", l.name AS "locationName",
      b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.email,
      (EXISTS (SELECT 1 FROM payment_records pr WHERE pr.tenant_id=b.tenant_id AND pr.booking_id=b.id)
       OR EXISTS (SELECT 1 FROM commerce_sales cs JOIN commerce_sale_transactions st ON st.sale_id=cs.id AND st.tenant_id=cs.tenant_id WHERE cs.tenant_id=b.tenant_id AND cs.booking_id=b.id)
       OR EXISTS (SELECT 1 FROM commerce_entitlement_entries ce WHERE ce.tenant_id=b.tenant_id AND ce.booking_id=b.id)) AS "hasFinancialActivity"
    FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
    JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
    JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id
    WHERE b.tenant_id=${tenantId} AND (b.booking_number=upper(${credentials.bookingId}) OR b.id::text=lower(${credentials.bookingId})) AND lower(c.email)=lower(${credentials.email.trim()})
    LIMIT 1`;
  return booking ?? null;
}

function canChange(booking: Booking) {
  return booking.status === "confirmed" && new Date(booking.startsAt).getTime() > Date.now();
}

export async function lookupManagedBooking(tenant: TenantRecord, credentials: Credentials) {
  const booking = await findBooking(tenantDb(tenant), tenant.id, credentials);
  if (!booking) return null;
  return { service: booking.serviceTitle, location: booking.locationName, startsAt: booking.startsAt, endsAt: booking.endsAt, status: booking.status, canChange: canChange(booking), canCancel: canChange(booking) && !booking.hasFinancialActivity };
}

export async function managedAvailability(tenant: TenantRecord, credentials: Credentials, start: Date, end: Date) {
  const booking = await findBooking(tenantDb(tenant), tenant.id, credentials);
  if (!booking || !canChange(booking)) return null;
  const durationMinutes = (new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 60_000;
  return availableSlots(tenant, booking.serviceId, start, end, { locationId: booking.locationId, excludeBookingBlockId: booking.bookingBlockId, durationMinutes });
}

/** Lock order is block then booking, matching the staff calendar actions. */
async function lockBooking(db: Sql, tenant: TenantRecord, credentials: Credentials) {
  const initial = await findBooking(db, tenant.id, credentials);
  if (!initial) return null;
  await db`SELECT id FROM booking_blocks WHERE tenant_id=${tenant.id} AND id=${initial.bookingBlockId} FOR UPDATE`;
  await db`SELECT id FROM bookings WHERE tenant_id=${tenant.id} AND id=${initial.id} FOR UPDATE`;
  return findBooking(db, tenant.id, credentials);
}

export async function cancelManagedBooking(tenant: TenantRecord, credentials: Credentials) {
  const sql = tenantDb(tenant);
  return withSerializableRetry(() => sql.begin(async tx => {
    // READ COMMITTED gives the post-lock financial check a fresh snapshot.
    // Payment and package redemption writers lock this same booking row.
    const db = tx as unknown as Sql;
    const booking = await lockBooking(db, tenant, credentials);
    if (!booking) return "not_found" as const;
    if (booking.status === "cancelled") return "cancelled" as const;
    if (!canChange(booking)) return "unavailable" as const;
    // Refunds and entitlement reversals require the business's existing sales workflow.
    if (booking.hasFinancialActivity) return "financial" as const;
    await db`UPDATE bookings SET status='cancelled', updated_at=now() WHERE tenant_id=${tenant.id} AND id=${booking.id}`;
    await db`UPDATE booking_blocks SET state='cancelled' WHERE tenant_id=${tenant.id} AND id=${booking.bookingBlockId}`;
    const metadata = JSON.stringify({ source: "customer_management", previousStatus: booking.status });
    await db`INSERT INTO booking_events (tenant_id,booking_id,event_type,metadata) VALUES (${tenant.id},${booking.id},'booking.cancelled',${metadata}::text::jsonb)`;
    await db`INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES (${tenant.id},'booking.cancelled','booking',${booking.id},${metadata}::text::jsonb)`;
    await db`INSERT INTO email_outbox (tenant_id,booking_id,message_type,recipient,payload) VALUES (${tenant.id},${booking.id},'cancellation',${booking.email},${JSON.stringify({ bookingId: booking.id })}::text::jsonb)`;
    return "cancelled" as const;
  }));
}

export async function rescheduleManagedBooking(tenant: TenantRecord, credentials: Credentials, startsAt: Date) {
  const sql = tenantDb(tenant);
  return withSerializableRetry(() => sql.begin(async tx => {
    await tx.unsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const db = tx as unknown as Sql;
    const booking = await lockBooking(db, tenant, credentials);
    if (!booking) return "not_found" as const;
    if (!canChange(booking) || startsAt.getTime() <= Date.now()) return "unavailable" as const;
    const durationMinutes = (new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 60_000;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const providers = await availableSlots(tenant, booking.serviceId, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000), { locationId: booking.locationId, excludeBookingBlockId: booking.bookingBlockId, durationMinutes }, db);
    const member = providers.find(provider => provider.slots.some(slot => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime()));
    if (!member) return "unavailable" as const;
    await db`UPDATE booking_blocks SET team_member_id=${member.teamMemberId}, starts_at=${startsAt}, ends_at=${endsAt}, resource_id=NULL WHERE tenant_id=${tenant.id} AND id=${booking.bookingBlockId} AND state='confirmed'`;
    await db`UPDATE bookings SET team_member_id=${member.teamMemberId}, starts_at=${startsAt}, ends_at=${endsAt}, resource_id=NULL, updated_at=now() WHERE tenant_id=${tenant.id} AND id=${booking.id}`;
    const metadata = JSON.stringify({ source: "customer_management", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), teamMemberId: member.teamMemberId });
    await db`INSERT INTO booking_events (tenant_id,booking_id,event_type,metadata) VALUES (${tenant.id},${booking.id},'booking.rescheduled',${metadata}::text::jsonb)`;
    await db`INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES (${tenant.id},'booking.rescheduled','booking',${booking.id},${metadata}::text::jsonb)`;
    return "rescheduled" as const;
  }));
}
