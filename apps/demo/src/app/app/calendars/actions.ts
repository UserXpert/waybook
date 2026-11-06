"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { BookingConflictError, withSerializableRetry } from "@thebookingkit/server";
import { requireIdentity } from "@/lib/waybook/auth";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { canManageAppointment, staffPermissionContext, type StaffPermissionContext } from "@/lib/waybook/staff-permissions";

async function editableCalendarTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage calendars.");
  await requireFeature(tenant.id, "calendars");
  return tenant;
}

async function calendarPermissionContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "calendars");
  return { tenant, permissions: await staffPermissionContext(tenant, membership) };
}

function assertAppointmentPermission(
  permissions: StaffPermissionContext,
  ...teamMemberIds: Array<string | null>
) {
  if (!canManageAppointment(permissions, ...teamMemberIds)) {
    throw new Error("You do not have permission to change this appointment.");
  }
}

function revalidateCalendars() {
  revalidatePath("/app");
  revalidatePath("/app/calendars");
  revalidatePath("/app/bookings");
  revalidatePath("/app/reports");
  revalidatePath("/book");
}

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localDateTimeKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Availability used by the operator appointment drawer. The write action
 * repeats this check inside its transaction, so this is guidance—not trust. */
export async function getManualBookingAvailability(input: {
  locationId: string;
  serviceId: string;
  date: string;
}) {
  if (
    !input.locationId ||
    !input.serviceId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
  ) {
    return { slots: [], resources: [] };
  }
  const { tenant, permissions } = await calendarPermissionContext();
  if (!permissions.isManager && !permissions.canManageOwnAppointments && !permissions.canManageTeamAppointments) {
    return { slots: [], resources: [] };
  }
  const db = tenantDb(tenant);
  const dayStart = fromZonedTime(`${input.date}T00:00:00`, tenant.timezone);
  const candidates = await availableSlots(
    tenant,
    input.serviceId,
    new Date(dayStart.getTime() - 86_400_000),
    new Date(dayStart.getTime() + 172_800_000),
    { locationId: input.locationId, slotInterval: 30 },
  );
  const resources = await db.unsafe<
    { id: string; name: string; resourceType: string; capacity: number }[]
  >(
    "SELECT r.id, r.name, r.resource_type AS \"resourceType\", r.capacity FROM resources r JOIN service_resources sr ON sr.resource_id = r.id AND sr.tenant_id = r.tenant_id JOIN resource_locations rl ON rl.resource_id = r.id AND rl.tenant_id = r.tenant_id WHERE r.tenant_id = $1 AND sr.service_id = $2 AND rl.location_id = $3 AND r.is_active = TRUE ORDER BY r.name",
    [tenant.id, input.serviceId, input.locationId],
  );
  const visibleCandidates =
    permissions.isManager || permissions.canManageTeamAppointments
      ? candidates
      : candidates.filter((candidate) => candidate.teamMemberId === permissions.teamMemberId);
  return {
    slots: visibleCandidates.flatMap((candidate) =>
      candidate.slots
        .filter(
          (slot) =>
            localDateKey(new Date(slot.startTime), tenant.timezone) ===
            input.date,
        )
        .map((slot) => ({
          teamMemberId: candidate.teamMemberId,
          startTime: slot.startTime,
          endTime: slot.endTime,
          resourceId: slot.resourceId ?? null,
        })),
    ),
    resources,
  };
}

async function editableBooking(bookingId: string, purpose: "appointment" | "status" | "manager" = "appointment") {
  if (!bookingId) throw new Error("Booking is required.");
  const privilegedTenant = purpose === "manager" ? await editableCalendarTenant() : null;
  const { tenant, permissions } = privilegedTenant
    ? { tenant: privilegedTenant, permissions: { isManager: true } as StaffPermissionContext }
    : await calendarPermissionContext();
  const db = tenantDb(tenant);
  const [booking] = await db<{
    id: string; bookingBlockId: string; teamMemberId: string | null; resourceId: string | null; serviceId: string; locationId: string; customerEmail: string; status: string; startsAt: Date; endsAt: Date; durationMinutes: number;
  }[]>`
    SELECT b.id, b.booking_block_id AS "bookingBlockId", b.team_member_id AS "teamMemberId", b.resource_id AS "resourceId", b.service_id AS "serviceId", b.location_id AS "locationId", c.email AS "customerEmail", b.status, b.starts_at AS "startsAt", b.ends_at AS "endsAt",
      s.duration_minutes AS "durationMinutes"
    FROM bookings b JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
    WHERE b.id = ${bookingId} AND b.tenant_id = ${tenant.id} LIMIT 1
  `;
  if (!booking) throw new Error("Booking is unavailable.");
  if (purpose === "manager") {
    // The tenant role check above is the authorization boundary for payments.
  } else if (purpose === "status") {
    if (!permissions.isManager && !permissions.canUpdateAppointmentStatus) {
      throw new Error("You do not have permission to change appointment status.");
    }
  } else {
    assertAppointmentPermission(permissions, booking.teamMemberId);
  }
  return { tenant, db, booking, permissions };
}

type CalendarMoveInput = { bookingId: string; startsAt: string; teamMemberId: string };
type EditableBooking = Awaited<ReturnType<typeof editableBooking>>;
type CalendarMoveCheck = { error: string | null; startsAt?: Date; endsAt?: Date; resourceId?: string | null; context?: EditableBooking };
type CalendarMoveTarget = { teamMemberId: string; startsAt: Date; endsAt: Date };

/**
 * Dragging a calendar card is an operational reschedule: it is intentionally
 * less restrictive than creating a new public appointment. The board shows a
 * staff member's free time, so every active staff member at the location can
 * receive the booking. Only a real overlapping appointment blocks a target.
 */
async function openCalendarMoveTargets(
  context: EditableBooking,
  targets: CalendarMoveTarget[],
) {
  const { tenant, db, booking, permissions } = context;
  if (!targets.length) return [];
  const eligibleStaff = await db<{ id: string }[]>`
    SELECT tm.id
    FROM team_members tm
    JOIN team_member_locations tml
      ON tml.tenant_id = tm.tenant_id AND tml.team_member_id = tm.id
    WHERE tm.tenant_id = ${tenant.id}
      AND tm.is_active = TRUE
      AND tml.location_id = ${booking.locationId}
  `;
  const eligibleIds = new Set(eligibleStaff.map((staff) => staff.id));
  const permitted = targets.filter((target) =>
    eligibleIds.has(target.teamMemberId) &&
    canManageAppointment(permissions, booking.teamMemberId, target.teamMemberId),
  );
  if (!permitted.length) return [];
  const earliest = Math.min(...permitted.map((target) => target.startsAt.getTime()));
  const latest = Math.max(...permitted.map((target) => target.endsAt.getTime()));
  const blocks = await db<{
    teamMemberId: string;
    startsAt: Date;
    endsAt: Date;
  }[]>`
    SELECT team_member_id AS "teamMemberId", starts_at AS "startsAt", ends_at AS "endsAt"
    FROM booking_blocks
    WHERE tenant_id = ${tenant.id}
      AND team_member_id = ANY(${[...new Set(permitted.map((target) => target.teamMemberId))]})
      AND state IN ('held', 'confirmed')
      AND id <> ${booking.bookingBlockId}
      AND starts_at < ${new Date(latest)}
      AND ends_at > ${new Date(earliest)}
  `;
  return permitted.filter((target) =>
    !blocks.some(
      (block) =>
        block.teamMemberId === target.teamMemberId &&
        block.startsAt < target.endsAt &&
        block.endsAt > target.startsAt,
    ),
  );
}

/**
 * Resolves a calendar drop against the calendar's operational free-time
 * contract. Public booking availability remains stricter and is not reused
 * here, so reception can move an existing appointment to any unbooked staff
 * interval shown on the day board.
 */
async function checkCalendarMove(input: CalendarMoveInput): Promise<CalendarMoveCheck> {
  if (!input.bookingId || !input.teamMemberId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.startsAt)) {
    return { error: "Choose a valid staff member and appointment time." };
  }
  const { tenant, db, booking, permissions } = await editableBooking(input.bookingId);
  assertAppointmentPermission(permissions, booking.teamMemberId, input.teamMemberId);
  if (booking.status === "cancelled" || !booking.teamMemberId) return { error: "Only an active assigned appointment can be moved." };
  const startsAt = fromZonedTime(input.startsAt, tenant.timezone);
  const durationMinutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
  if (durationMinutes <= 0) return { error: "This appointment has an invalid duration." };
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  if (startsAt.getTime() < Date.now()) return { error: "Appointments cannot be moved into the past." };
  if (booking.teamMemberId === input.teamMemberId && startsAt.getTime() === booking.startsAt.getTime()) {
    return { error: "That appointment is already in this slot." };
  }
  const context = { tenant, db, booking, permissions };
  const [target] = await openCalendarMoveTargets(context, [{ teamMemberId: input.teamMemberId, startsAt, endsAt }]);
  if (target) return { error: null, context, startsAt, endsAt, resourceId: null };
  return { error: "That staff member already has an appointment at this time." };
}

/** Lightweight drag-hover preflight; the write action repeats the check transactionally. */
export async function previewCalendarBookingMove(input: CalendarMoveInput): Promise<{ error: string | null }> {
  try {
    const result = await checkCalendarMove(input);
    return { error: result.error };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not check that time." };
  }
}

/**
 * Returns every free staff interval rendered in the current day board. The
 * write action repeats this check transactionally before it moves the record.
 */
export async function getCalendarBookingMoveTargets(input: {
  bookingId: string;
  targets: Array<{ teamMemberId: string; startsAt: string }>;
}): Promise<{ targets: string[]; error: string | null }> {
  try {
    if (!input.bookingId || !Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > 500) {
      return { targets: [], error: "Could not prepare calendar destinations." };
    }
    const requested = new Map<string, { teamMemberId: string; startsAt: string }>();
    for (const target of input.targets) {
      if (!target || !target.teamMemberId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(target.startsAt)) {
        return { targets: [], error: "Could not prepare calendar destinations." };
      }
      requested.set(`${target.teamMemberId}|${target.startsAt}`, target);
    }
    const { tenant, booking, permissions } = await editableBooking(input.bookingId);
    if (!booking.teamMemberId || booking.status === "cancelled") {
      return { targets: [], error: "Only an active assigned appointment can be moved." };
    }
    const durationMinutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
    if (durationMinutes <= 0) return { targets: [], error: "This appointment has an invalid duration." };
    const openTargets = await openCalendarMoveTargets(
      { tenant, db: tenantDb(tenant), booking, permissions },
      [...requested.values()].map((target) => {
        const startsAt = fromZonedTime(target.startsAt, tenant.timezone);
        return {
          teamMemberId: target.teamMemberId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
        };
      }),
    );
    return {
      targets: openTargets
        .filter(
          (target) =>
            target.teamMemberId !== booking.teamMemberId ||
            target.startsAt.getTime() !== booking.startsAt.getTime(),
        )
        .map(
          (target) => `${target.teamMemberId}|${localDateTimeKey(target.startsAt, tenant.timezone)}`,
        ),
      error: null,
    };
  } catch (error) {
    return { targets: [], error: error instanceof Error ? error.message : "Could not prepare calendar destinations." };
  }
}

export async function updateBookingDetails(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (!name || !email.includes("@")) throw new Error("Enter the customer name and a valid email.");
  const { tenant, db, booking } = await editableBooking(bookingId, "manager");
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
  if (booking.status === "completed") throw new Error("Completed appointments cannot be rescheduled.");
  const startsAt = fromZonedTime(localStartsAt, tenant.timezone);
  const durationMinutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
  if (durationMinutes <= 0) throw new Error("This appointment has an invalid duration.");
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const candidates = await availableSlots(tenant, booking.serviceId, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000), { excludeBookingBlockId: booking.bookingBlockId, locationId: booking.locationId, slotInterval: 30, durationMinutes });
  const availableSlot = candidates.find((candidate) => candidate.teamMemberId === booking.teamMemberId)?.slots.find((slot) => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime());
  if (!availableSlot) throw new Error("That employee or required resource is not available at the selected time.");
  try {
    await withSerializableRetry(async () => db.begin(async (transaction) => {
      const [block] = await transaction.unsafe<{ id: string }[]>("UPDATE booking_blocks SET starts_at = $1, ends_at = $2, resource_id = $3 WHERE id = $4 AND tenant_id = $5 AND state = 'confirmed' RETURNING id", [startsAt, endsAt, availableSlot.resourceId ?? null, booking.bookingBlockId, tenant.id]);
      if (!block) throw new Error("Booking can no longer be rescheduled.");
      await transaction.unsafe("UPDATE bookings SET starts_at = $1, ends_at = $2, resource_id = $3, updated_at = now() WHERE id = $4 AND tenant_id = $5", [startsAt, endsAt, availableSlot.resourceId ?? null, booking.id, tenant.id]);
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.rescheduled', $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), resourceId: availableSlot.resourceId ?? null })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.rescheduled', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), resourceId: availableSlot.resourceId ?? null })]);
    }));
  } catch (error) {
    if (error instanceof BookingConflictError) throw new Error("That time was just taken. Choose another time.");
    throw error;
  }
  revalidateCalendars();
}

/** Moves an appointment from a calendar drag gesture, including an eligible staff reassignment. */
export async function moveBookingOnCalendar(input: { bookingId: string; startsAt: string; teamMemberId: string }): Promise<{ error: string | null }> {
  try {
    const checked = await checkCalendarMove(input);
    if (checked.error || !checked.context || !checked.startsAt || !checked.endsAt) throw new Error(checked.error ?? "Could not confirm that appointment move.");
    const { tenant, db, booking } = checked.context;
    const { startsAt, endsAt } = checked;
    const resourceId = checked.resourceId ?? null;
    await withSerializableRetry(async () => db.begin(async (transaction) => {
      const [block] = await transaction.unsafe<{ id: string }[]>("UPDATE booking_blocks SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = $4 WHERE id = $5 AND tenant_id = $6 AND state = 'confirmed' RETURNING id", [input.teamMemberId, startsAt, endsAt, resourceId, booking.bookingBlockId, tenant.id]);
      if (!block) throw new Error("Booking can no longer be moved.");
      await transaction.unsafe("UPDATE bookings SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = $4, updated_at = now() WHERE id = $5 AND tenant_id = $6", [input.teamMemberId, startsAt, endsAt, resourceId, booking.id, tenant.id]);
      const metadata = JSON.stringify({ startsAt: startsAt.toISOString(), teamMemberId: input.teamMemberId, resourceId, source: "calendar_drag" });
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.rescheduled', $3::jsonb)", [tenant.id, booking.id, metadata]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.drag_moved', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, metadata]);
    }));
    revalidateCalendars();
    return { error: null };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { error: "That time was just taken. Choose another time." };
    }
    return { error: error instanceof Error ? error.message : "Could not move that appointment." };
  }
}

export async function updateBookingStatus(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["arrived", "completed", "no_show", "cancelled"].includes(status)) throw new Error("Choose a valid appointment status.");
  const { tenant, db, booking } = await editableBooking(bookingId, status === "cancelled" ? "appointment" : "status");
  if (status === "cancelled" && booking.status === "completed") throw new Error("Completed appointments cannot be cancelled.");
  await withSerializableRetry(() => db.begin(async (transaction) => {
    // Keep the block/booking lock order aligned with moves so a cancel cannot race them.
    const [block] = await transaction.unsafe<{ state: string }[]>(
      "SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [booking.bookingBlockId, tenant.id],
    );
    if (!block) throw new Error("Booking availability is unavailable.");

    const [current] = await transaction.unsafe<{ status: string }[]>(
      "SELECT status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [booking.id, tenant.id],
    );
    if (!current) throw new Error("Booking is unavailable.");
    // A repeated click or an in-flight duplicate cancellation is a safe no-op.
    if (current.status === "cancelled") return;

    await transaction.unsafe("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [status, booking.id, tenant.id]);
    if (status === "cancelled") {
      await transaction.unsafe("UPDATE booking_blocks SET state = 'cancelled' WHERE id = $1 AND tenant_id = $2", [booking.bookingBlockId, tenant.id]);
      await transaction.unsafe("INSERT INTO email_outbox (tenant_id, booking_id, message_type, recipient, payload) VALUES ($1, $2, 'cancellation', $3, $4::jsonb)", [tenant.id, booking.id, booking.customerEmail, JSON.stringify({ bookingId: booking.id })]);
    }
    await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)", [tenant.id, booking.id, `booking.${status}`, JSON.stringify({ previousStatus: current.status })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking', $3, $4::jsonb)", [tenant.id, `booking.${status}`, booking.id, JSON.stringify({ previousStatus: current.status })]);
  }));
  revalidateCalendars();
}

export type CancellationResult = { error: string | null };

export async function cancelAppointment(formData: FormData): Promise<CancellationResult> {
  try {
    formData.set("status", "cancelled");
    await updateBookingStatus(formData);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The appointment could not be cancelled." };
  }
}

export type PaymentState = { error: string | null; success: string | null };

/** Appends a tenant-recorded payment or refund; corrections are never destructive. */
export async function recordPayment(_previousState: PaymentState, formData: FormData): Promise<PaymentState> {
  try {
    const bookingId = String(formData.get("bookingId") ?? "");
    const kind = String(formData.get("kind") ?? "payment");
    const method = String(formData.get("method") ?? "card");
    const amount = Number(String(formData.get("amountDkk") ?? "").replace(",", "."));
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!bookingId || !["payment", "refund"].includes(kind) || !["card", "cash", "bank_transfer", "other"].includes(method) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > 10_000_000 || (notes?.length ?? 0) > 500) {
      throw new Error("Enter a valid positive amount, payment method, and optional note.");
    }
    const { tenant, db, booking } = await editableBooking(bookingId, "manager");
    if (booking.status === "cancelled") throw new Error("Cancelled appointments cannot receive a payment record.");
    const identity = await requireIdentity();
    const amountCents = Math.round(amount * 100);
    await db.begin(async (transaction) => {
      const [payment] = await transaction.unsafe<{ id: string }[]>(
        "INSERT INTO payment_records (tenant_id, booking_id, kind, amount_cents, method, notes, recorded_by_identity_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [tenant.id, booking.id, kind, amountCents, method, notes, identity.id],
      );
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)", [tenant.id, booking.id, identity.id, `payment.${kind}`, JSON.stringify({ paymentId: payment.id, amountCents, method })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, 'payment_record', $4, $5::jsonb)", [tenant.id, identity.id, `payment.${kind}_recorded`, payment.id, JSON.stringify({ bookingId: booking.id, amountCents, method })]);
    });
    revalidateCalendars();
    return { error: null, success: kind === "refund" ? "Refund recorded in the immutable sales ledger." : "Payment recorded in the immutable sales ledger." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record this payment.", success: null };
  }
}

export type ManualBookingState = { error: string | null; success: string | null };

/** Creates a staff-entered appointment after the same availability and exclusion checks as public booking. */
async function createManualBookingRecord(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  const teamMemberId = String(formData.get("teamMemberId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const localDate = String(formData.get("appointmentDate") ?? "");
  const localTime = String(formData.get("appointmentTime") ?? "");
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (!locationId || !teamMemberId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{2}:\d{2}$/.test(localTime) || !name || !email.includes("@")) {
    throw new Error("Choose a location, staff member, service, local appointment time, and valid client details.");
  }
  const { tenant, permissions } = await calendarPermissionContext();
  assertAppointmentPermission(permissions, teamMemberId);
  const db = tenantDb(tenant);
  const [service] = await db<{ id: string; durationMinutes: number; priceCents: number }[]>`
    SELECT s.id, s.duration_minutes AS "durationMinutes", s.price_cents AS "priceCents"
    FROM services s
    JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id
    JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id
    JOIN team_member_locations tml ON tml.team_member_id = stm.team_member_id AND tml.tenant_id = s.tenant_id AND tml.location_id = sl.location_id
    JOIN team_members tm ON tm.id = stm.team_member_id AND tm.tenant_id = s.tenant_id
    JOIN locations l ON l.id = sl.location_id AND l.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenant.id} AND s.id = ${serviceId} AND stm.team_member_id = ${teamMemberId} AND sl.location_id = ${locationId}
      AND s.is_active = TRUE AND tm.is_active = TRUE AND l.is_active = TRUE
    LIMIT 1
  `;
  if (!service) throw new Error("That staff member cannot deliver this service at the selected location.");
  const startsAt = fromZonedTime(`${localDate}T${localTime}`, tenant.timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const candidates = await availableSlots(tenant, service.id, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000), { locationId, slotInterval: 30 });
  const availableSlot = candidates.find((candidate) => candidate.teamMemberId === teamMemberId)?.slots.find((slot) => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime());
  if (!availableSlot) throw new Error("That staff member is not available at the selected time.");
  // Resource availability is resolved together with the advertised slot. Do
  // not trust a separately submitted resource id: it can be stale or refer to
  // a different, occupied resource while the displayed slot is still valid.
  const resolvedResourceId = availableSlot.resourceId ?? null;
  const identity = await requireIdentity();
  try {
    await withSerializableRetry(async () => db.begin(async (transaction) => {
      const [customer] = await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO customers (tenant_id, name, email, phone)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
        RETURNING id
      `, [tenant.id, name, email, phone]);
      const [block] = await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO booking_blocks (tenant_id, team_member_id, resource_id, location_id, starts_at, ends_at, state)
        VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
        RETURNING id
      `, [tenant.id, teamMemberId, resolvedResourceId, locationId, startsAt, endsAt]);
      const [booking] = await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO bookings (tenant_id, booking_block_id, service_id, location_id, team_member_id, resource_id, customer_id, starts_at, ends_at, booked_price_cents, status, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', 'tenant')
        RETURNING id
      `, [tenant.id, block.id, service.id, locationId, teamMemberId, resolvedResourceId, customer.id, startsAt, endsAt, service.priceCents]);
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata) VALUES ($1, $2, $3, 'booking.created_by_tenant', $4::jsonb)", [tenant.id, booking.id, identity.id, JSON.stringify({ source: "tenant" })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking.created_by_tenant', 'booking', $3, $4::jsonb)", [tenant.id, identity.id, booking.id, JSON.stringify({ source: "tenant" })]);
    }));
  } catch (error) {
    if (error instanceof BookingConflictError) throw new Error("That time was just taken. Choose another time.");
    throw error;
  }
  revalidateCalendars();
}

/** Expected validation and availability failures stay inside the calendar form rather than becoming a page error. */
export async function createManualBooking(_previousState: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  try {
    await createManualBookingRecord(formData);
    return { error: null, success: "Appointment confirmed and added to the calendar." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not confirm this appointment.", success: null };
  }
}
