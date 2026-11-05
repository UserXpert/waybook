"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { BookingConflictError, withSerializableRetry } from "@thebookingkit/server";
import { requireIdentity } from "@/lib/waybook/auth";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";

async function editableCalendarTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage calendars.");
  await requireFeature(tenant.id, "calendars");
  return tenant;
}

function revalidateCalendars() {
  revalidatePath("/app/calendars");
  revalidatePath("/app/bookings");
  revalidatePath("/book");
}

async function editableBooking(bookingId: string) {
  if (!bookingId) throw new Error("Booking is required.");
  const tenant = await editableCalendarTenant();
  const db = tenantDb(tenant);
  const [booking] = await db<{
    id: string; bookingBlockId: string; teamMemberId: string | null; serviceId: string; status: string; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number;
  }[]>`
    SELECT b.id, b.booking_block_id AS "bookingBlockId", b.team_member_id AS "teamMemberId", b.service_id AS "serviceId", b.status,
      s.duration_minutes AS "durationMinutes", s.buffer_before_minutes AS "bufferBeforeMinutes", s.buffer_after_minutes AS "bufferAfterMinutes"
    FROM bookings b JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
    WHERE b.id = ${bookingId} AND b.tenant_id = ${tenant.id} LIMIT 1
  `;
  if (!booking) throw new Error("Booking is unavailable.");
  return { tenant, db, booking };
}

export async function updateBookingDetails(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (!name || !email.includes("@")) throw new Error("Enter the customer name and a valid email.");
  const { tenant, db, booking } = await editableBooking(bookingId);
  await db.begin(async (transaction) => {
    const [customer] = await transaction.unsafe<{ id: string }[]>("SELECT customer_id AS id FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.id, tenant.id]);
    if (!customer) throw new Error("Booking is unavailable.");
    await transaction.unsafe("UPDATE customers SET name = $1, email = $2, phone = $3, updated_at = now() WHERE id = $4 AND tenant_id = $5", [name, email, phone, customer.id, tenant.id]);
    await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.edited', $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ fields: ["name", "email", "phone"] })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.edited', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ fields: ["name", "email", "phone"] })]);
  });
  revalidateCalendars();
}

export async function rescheduleBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const localStartsAt = String(formData.get("startsAt") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localStartsAt)) throw new Error("Choose a valid local appointment time.");
  const { tenant, db, booking } = await editableBooking(bookingId);
  if (!booking.teamMemberId || booking.status === "cancelled") throw new Error("Only an assigned active booking can be rescheduled.");
  const startsAt = fromZonedTime(localStartsAt, tenant.timezone);
  const endsAt = new Date(startsAt.getTime() + booking.durationMinutes * 60_000);
  const candidates = await availableSlots(tenant, booking.serviceId, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000), { excludeBookingBlockId: booking.bookingBlockId });
  const isAvailable = candidates.find((candidate) => candidate.teamMemberId === booking.teamMemberId)?.slots.some((slot) => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime());
  if (!isAvailable) throw new Error("That employee is not available at the selected time.");
  try {
    await withSerializableRetry(async () => db.begin(async (transaction) => {
      const effectiveStartsAt = new Date(startsAt.getTime() - booking.bufferBeforeMinutes * 60_000);
      const effectiveEndsAt = new Date(endsAt.getTime() + booking.bufferAfterMinutes * 60_000);
      const [block] = await transaction.unsafe<{ id: string }[]>("UPDATE booking_blocks SET starts_at = $1, ends_at = $2 WHERE id = $3 AND tenant_id = $4 AND state = 'confirmed' RETURNING id", [effectiveStartsAt, effectiveEndsAt, booking.bookingBlockId, tenant.id]);
      if (!block) throw new Error("Booking can no longer be rescheduled.");
      await transaction.unsafe("UPDATE bookings SET starts_at = $1, ends_at = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4", [startsAt, endsAt, booking.id, tenant.id]);
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.rescheduled', $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.rescheduled', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })]);
    }));
  } catch (error) {
    if (error instanceof BookingConflictError) throw new Error("That time was just taken. Choose another time.");
    throw error;
  }
  revalidateCalendars();
}

export async function updateBookingStatus(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["arrived", "completed", "no_show", "cancelled"].includes(status)) throw new Error("Choose a valid appointment status.");
  const { tenant, db, booking } = await editableBooking(bookingId);
  if (booking.status === "cancelled") throw new Error("A cancelled booking cannot be updated.");
  await db.begin(async (transaction) => {
    await transaction.unsafe("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [status, booking.id, tenant.id]);
    if (status === "cancelled") await transaction.unsafe("UPDATE booking_blocks SET state = 'cancelled' WHERE id = $1 AND tenant_id = $2", [booking.bookingBlockId, tenant.id]);
    await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)", [tenant.id, booking.id, `booking.${status}`, JSON.stringify({ previousStatus: booking.status })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking', $3, $4::jsonb)", [tenant.id, `booking.${status}`, booking.id, JSON.stringify({ previousStatus: booking.status })]);
  });
  revalidateCalendars();
}
