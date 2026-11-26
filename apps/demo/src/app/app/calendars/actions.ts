"use server";

import { activeAppointmentPayments, manualPaymentMethods } from "@/lib/waybook/appointment-payment-records";
import { getAppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { revalidatePath } from "next/cache";
import { assertNoOperationalFreeText } from "@/lib/waybook/operations-only-fields";
import { refundGiftCardOnCancellation } from "@/lib/waybook/gift-card-cancellation";
import { fromZonedTime } from "date-fns-tz";
import { BookingConflictError, withSerializableRetry } from "@/lib/waybook/transaction-conflicts";
import { requireIdentity } from "@/lib/waybook/auth";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { canManageAppointment, staffPermissionContext, type StaffPermissionContext } from "@/lib/waybook/staff-permissions";
import { promptEmailDelivery } from "@/lib/waybook/email-delivery-trigger";
import {
  assertMovableAppointmentStatus,
  canChangeAttendanceNow,
  isMovableAppointmentStatus,
} from "@/lib/waybook/appointment-lifecycle";

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
  revalidatePath("/app/customers");
  revalidatePath("/app/reports");
  revalidatePath("/app/sales");
  revalidatePath("/book");
  revalidatePath("/app/resources");
}

/** Assigns a compatible resource after staff time has already been booked. */
export async function assignBookingResource(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const resourceId = String(formData.get("resourceId") ?? "");
  const { tenant, db, booking } = await editableBooking(bookingId, "manager");
  const identity = await requireIdentity();
  await withSerializableRetry(() => db.begin(async (transaction) => {
    if (!resourceId) {
      const [released] = await transaction.unsafe<{ id: string }[]>(
        "UPDATE booking_resource_assignments SET released_at=now(),release_reason='manual_unassign' WHERE tenant_id=$1 AND booking_id=$2 AND released_at IS NULL RETURNING id",
        [tenant.id, booking.id],
      );
      if (released) await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'resource.unassigned',$4::jsonb)", [tenant.id, booking.id, identity.id, JSON.stringify({ assignmentId: released.id })]);
      return;
    }
    await transaction.unsafe(
      "INSERT INTO booking_resource_assignments (tenant_id,booking_id,resource_id,assigned_by_identity_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,booking_id) DO UPDATE SET resource_id=EXCLUDED.resource_id,assigned_by_identity_id=EXCLUDED.assigned_by_identity_id,assigned_at=now(),released_at=NULL,release_reason=NULL",
      [tenant.id, booking.id, resourceId, identity.id],
    );
    await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,'resource.assigned',$4::jsonb)", [tenant.id, booking.id, identity.id, JSON.stringify({ resourceId })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'resource.assigned','booking',$3,$4::jsonb)", [tenant.id, identity.id, booking.id, JSON.stringify({ resourceId })]);
  }));
  revalidateCalendars();
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

/** Load one visible appointment without rebuilding the calendar. */
export async function getCalendarAppointment(bookingId: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId)) throw new Error("Booking is unavailable.");
  const { tenant, permissions } = await calendarPermissionContext();
  const canViewTeam = permissions.isManager || permissions.canViewTeamCalendar;
  if (!canViewTeam && !permissions.teamMemberId) throw new Error("You do not have permission to view this calendar.");
  const db = tenantDb(tenant);
  const [booking] = await db<{ id: string; bookingNumber: string; serviceId: string; locationId: string; resourceId: string | null; startsAt: Date; endsAt: Date; status: string; customerName: string; customerEmail: string; customerPhone: string | null; serviceTitle: string; teamMemberName: string; teamMemberId: string }[]>`
    SELECT b.id,b.booking_number AS "bookingNumber",b.service_id AS "serviceId",b.location_id AS "locationId",
      bra.resource_id AS "resourceId",b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.status,
      c.name AS "customerName",c.email AS "customerEmail",c.phone AS "customerPhone",s.title AS "serviceTitle",tm.name AS "teamMemberName",tm.id AS "teamMemberId"
    FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
    JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
    JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id
    LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL
    WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId} AND (${canViewTeam} OR b.team_member_id=${permissions.teamMemberId ?? null}::uuid) LIMIT 1
  `;
  if (!booking) throw new Error("Booking is unavailable.");
  const { teamMemberId, ...detail } = booking;
  const canManageSchedule = canManageAppointment(permissions, teamMemberId);
  const [resources, paymentBalance] = await Promise.all([
    permissions.isManager ? db<{ id: string; name: string; isMutuallyExclusive: boolean }[]>`
    SELECT r.id,r.name,r.is_mutually_exclusive AS "isMutuallyExclusive" FROM resources r
    JOIN resource_locations rl ON rl.tenant_id=r.tenant_id AND rl.resource_id=r.id AND rl.location_id=${booking.locationId}
    JOIN service_resources sr ON sr.tenant_id=r.tenant_id AND sr.resource_id=r.id AND sr.service_id=${booking.serviceId}
    WHERE r.tenant_id=${tenant.id} AND r.is_active=TRUE ORDER BY r.name
  ` : [],
    permissions.isManager ? getAppointmentPaymentBalance(db, tenant.id, bookingId) : null,
  ]);
  const today = localDateKey(new Date(), tenant.timezone);
  const days = canManageSchedule
    ? Array.from({ length: 7 }, (_, index) => { const value = new Date(`${today}T12:00:00Z`); value.setUTCDate(value.getUTCDate()+index); return value.toISOString().slice(0,10); })
    : [];
  const slots = canManageSchedule && isMovableAppointmentStatus(booking.status)
    ? (await getRescheduleBookingAvailability({ bookingId, startDate: today })).slots : [];
  return {
    ...detail,
    // Status-only staff need the appointment identity and current state, but
    // never contact or resource data used by the manager editing surface.
    customerEmail: permissions.isManager ? booking.customerEmail : "",
    customerPhone: permissions.isManager ? booking.customerPhone : null,
    resourceId: permissions.isManager ? booking.resourceId : null,
    serviceId: permissions.isManager ? booking.serviceId : "",
    locationId: permissions.isManager ? booking.locationId : "",
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    canManage: permissions.isManager,
    canManageSchedule,
    canChangeAttendanceNow: canChangeAttendanceNow(booking),
    canUpdateStatus: permissions.isManager || permissions.canUpdateAppointmentStatus,
    resources,
    paymentBalance,
    days,
    slots,
    timezone: tenant.timezone,
  };
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
    return { slots: [] };
  }
  const { tenant, permissions } = await calendarPermissionContext();
  if (!permissions.isManager && !permissions.canManageOwnAppointments && !permissions.canManageTeamAppointments) {
    return { slots: [] };
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
  };
}

/** Availability for an existing appointment's seven-day reschedule window.
 * The same server-side availability contract is used again by the write action. */
export async function getRescheduleBookingAvailability(input: {
  bookingId: string;
  startDate: string;
}) {
  if (!input.bookingId || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { slots: [] };
  const { tenant, db, booking, permissions } = await editableBooking(input.bookingId);
  if (!booking.teamMemberId || !isMovableAppointmentStatus(booking.status)) return { slots: [] };
  const today = localDateKey(new Date(), tenant.timezone);
  if (input.startDate < today) return { slots: [] };
  const durationMinutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
  if (durationMinutes <= 0) return { slots: [] };
  const locationHours = await db<{ dayOfWeek: number; startTime: string; endTime: string }[]>`
    SELECT day_of_week AS "dayOfWeek", start_time AS "startTime", end_time AS "endTime"
    FROM location_hours WHERE tenant_id = ${tenant.id} AND location_id = ${booking.locationId}
  `;
  const staff = await db<{ id: string }[]>`
    SELECT tm.id FROM team_members tm
    JOIN team_member_locations tml ON tml.tenant_id = tm.tenant_id AND tml.team_member_id = tm.id
    WHERE tm.tenant_id = ${tenant.id} AND tm.is_active = TRUE AND tml.location_id = ${booking.locationId}
  `;
  const targets: CalendarMoveTarget[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const localDate = new Date(`${input.startDate}T12:00:00Z`);
    localDate.setUTCDate(localDate.getUTCDate() + offset);
    const date = localDate.toISOString().slice(0, 10);
    for (const hour of locationHours.filter((item) => item.dayOfWeek === localDate.getUTCDay())) {
      const start = fromZonedTime(`${date}T${hour.startTime}`, tenant.timezone);
      const end = fromZonedTime(`${date}T${hour.endTime}`, tenant.timezone);
      for (let cursor = start.getTime(); cursor + durationMinutes * 60_000 <= end.getTime(); cursor += 30 * 60_000) {
        const startsAt = new Date(cursor);
        if (startsAt.getTime() < Date.now()) continue;
        for (const member of staff) targets.push({ teamMemberId: member.id, startsAt, endsAt: new Date(cursor + durationMinutes * 60_000) });
      }
    }
  }
  const openTargets = await openCalendarMoveTargets({ tenant, db, booking, permissions }, targets);
  const slotByTime = new Map<string, CalendarMoveTarget>();
  for (const target of openTargets) {
    const key = target.startsAt.toISOString();
    const current = slotByTime.get(key);
    if (!current || target.teamMemberId === booking.teamMemberId) slotByTime.set(key, target);
  }
  return {
    slots: [...slotByTime.values()].map((target) => ({ teamMemberId: target.teamMemberId, startTime: target.startsAt.toISOString(), endTime: target.endsAt.toISOString() })),
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
  if (!booking.teamMemberId || !isMovableAppointmentStatus(booking.status)) return { error: "Only confirmed or arrived assigned appointments can be moved." };
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
    if (!booking.teamMemberId || !isMovableAppointmentStatus(booking.status)) {
      return { targets: [], error: "Only confirmed or arrived assigned appointments can be moved." };
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

export type BookingDetailsResult = { error: string | null };

export async function updateBookingDetails(formData: FormData): Promise<BookingDetailsResult> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (!name || !email.includes("@")) throw new Error("Enter the customer name and a valid email.");
  const { tenant, db, booking } = await editableBooking(bookingId, "manager");
  const identity = await requireIdentity();
  try {
    await db.begin(async (transaction) => {
      const [customer] = await transaction.unsafe<{ id: string; status: string }[]>("SELECT customer_id AS id, status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.id, tenant.id]);
      if (!customer) throw new Error("Booking is unavailable.");
      // The drawer intentionally permits edits for completed appointments and keeps
      // their payment ledger available. Cancellation is the one explicit read-only state.
      if (customer.status === "cancelled") throw new Error("Cancelled appointments cannot be edited.");
      await transaction.unsafe("UPDATE customers SET name = $1, email = $2, phone = $3, updated_at = now() WHERE id = $4 AND tenant_id = $5", [name, email, phone, customer.id, tenant.id]);
      if (formData.has("resourceId")) {
        const resourceId = String(formData.get("resourceId") ?? "");
        const [current] = await transaction.unsafe<{ resourceId: string }[]>("SELECT resource_id AS \"resourceId\" FROM booking_resource_assignments WHERE tenant_id=$1 AND booking_id=$2 AND released_at IS NULL FOR UPDATE", [tenant.id, booking.id]);
        if ((current?.resourceId ?? "") !== resourceId) {
          if (resourceId) {
            await transaction.unsafe("INSERT INTO booking_resource_assignments (tenant_id,booking_id,resource_id,assigned_by_identity_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,booking_id) DO UPDATE SET resource_id=EXCLUDED.resource_id,assigned_by_identity_id=EXCLUDED.assigned_by_identity_id,assigned_at=now(),released_at=NULL,release_reason=NULL", [tenant.id, booking.id, resourceId, identity.id]);
          } else {
            await transaction.unsafe("UPDATE booking_resource_assignments SET released_at=now(),release_reason='manual_unassign' WHERE tenant_id=$1 AND booking_id=$2 AND released_at IS NULL", [tenant.id, booking.id]);
          }
          const metadata = JSON.stringify({ resourceId: resourceId || null });
          const action = resourceId ? "resource.assigned" : "resource.unassigned";
          await transaction.unsafe("INSERT INTO booking_events (tenant_id,booking_id,actor_identity_id,event_type,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)", [tenant.id, booking.id, identity.id, action, metadata]);
          await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,$3,'booking',$4,$5::jsonb)", [tenant.id, identity.id, action, booking.id, metadata]);
        }
      }
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.edited', $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ fields: ["name", "email", "phone"] })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.edited', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ fields: ["name", "email", "phone"] })]);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001"
      && error.message === "exclusive resource is already assigned for this appointment time") {
      return { error: "This resource is already assigned for this appointment time." };
    }
    throw error;
  }
  revalidateCalendars();
  return { error: null };
}

export async function rescheduleBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const localStartsAt = String(formData.get("startsAt") ?? "");
  const teamMemberId = String(formData.get("teamMemberId") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localStartsAt)) throw new Error("Choose a valid local appointment time.");
  const initial = await editableBooking(bookingId);
  if (!initial.booking.teamMemberId || !isMovableAppointmentStatus(initial.booking.status)) throw new Error("Only confirmed or arrived assigned appointments can be rescheduled.");
  const nextTeamMemberId = teamMemberId || initial.booking.teamMemberId;
  const move = await checkCalendarMove({ bookingId, startsAt: localStartsAt, teamMemberId: nextTeamMemberId });
  if (move.error || !move.context || !move.startsAt || !move.endsAt) throw new Error(move.error ?? "That appointment can no longer be moved.");
  const { tenant, db, booking } = move.context;
  const { startsAt, endsAt } = move;
  try {
    const outboxId = await withSerializableRetry(async () => db.begin(async (transaction) => {
      // Keep the block/booking lock order aligned with status changes. The status
      // is re-read after the locks so a final transition after preflight wins.
      const [block] = await transaction.unsafe<{ state: string }[]>("SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.bookingBlockId, tenant.id]);
      if (!block || block.state !== "confirmed") throw new Error("Booking can no longer be rescheduled.");
      const [current] = await transaction.unsafe<{ status: string }[]>("SELECT status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.id, tenant.id]);
      if (!current) throw new Error("Booking is unavailable.");
      assertMovableAppointmentStatus(current.status);
      await transaction.unsafe("UPDATE booking_blocks SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = NULL WHERE id = $4 AND tenant_id = $5", [nextTeamMemberId, startsAt, endsAt, booking.bookingBlockId, tenant.id]);
      await transaction.unsafe("UPDATE bookings SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = NULL, updated_at = now() WHERE id = $4 AND tenant_id = $5", [nextTeamMemberId, startsAt, endsAt, booking.id, tenant.id]);
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.rescheduled', $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), teamMemberId: nextTeamMemberId, source: "appointment_drawer" })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.rescheduled', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, JSON.stringify({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), teamMemberId: nextTeamMemberId, source: "appointment_drawer" })]);
      if (!booking.customerEmail) return null;
      const [entry] = await transaction.unsafe<{ id: string }[]>("INSERT INTO email_outbox (tenant_id,booking_id,message_type,recipient,payload) VALUES ($1,$2,'confirmation',$3,$4::text::jsonb) RETURNING id", [tenant.id, booking.id, booking.customerEmail, JSON.stringify({ bookingId: booking.id, startsAt: startsAt.toISOString() })]);
      return entry.id;
    }));
    promptEmailDelivery(tenant, outboxId);
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
    const outboxId = await withSerializableRetry(async () => db.begin(async (transaction) => {
      // Lock block then booking, matching cancellation/status transitions. This
      // turns a concurrent final status transition into a rejected move.
      const [block] = await transaction.unsafe<{ state: string }[]>("SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.bookingBlockId, tenant.id]);
      if (!block || block.state !== "confirmed") throw new Error("Booking can no longer be moved.");
      const [current] = await transaction.unsafe<{ status: string }[]>("SELECT status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.id, tenant.id]);
      if (!current) throw new Error("Booking is unavailable.");
      assertMovableAppointmentStatus(current.status);
      await transaction.unsafe("UPDATE booking_blocks SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = $4 WHERE id = $5 AND tenant_id = $6", [input.teamMemberId, startsAt, endsAt, resourceId, booking.bookingBlockId, tenant.id]);
      await transaction.unsafe("UPDATE bookings SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = $4, updated_at = now() WHERE id = $5 AND tenant_id = $6", [input.teamMemberId, startsAt, endsAt, resourceId, booking.id, tenant.id]);
      const metadata = JSON.stringify({ startsAt: startsAt.toISOString(), teamMemberId: input.teamMemberId, resourceId, source: "calendar_drag" });
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, 'booking.rescheduled', $3::jsonb)", [tenant.id, booking.id, metadata]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'booking.drag_moved', 'booking', $2, $3::jsonb)", [tenant.id, booking.id, metadata]);
      if (!booking.customerEmail) return null;
      const [entry] = await transaction.unsafe<{ id: string }[]>("INSERT INTO email_outbox (tenant_id,booking_id,message_type,recipient,payload) VALUES ($1,$2,'confirmation',$3,$4::text::jsonb) RETURNING id", [tenant.id, booking.id, booking.customerEmail, JSON.stringify({ bookingId: booking.id, startsAt: startsAt.toISOString() })]);
      return entry.id;
    }));
    promptEmailDelivery(tenant, outboxId);
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
  const actor = status === "cancelled" ? await requireIdentity() : null;
  if (status === "cancelled" && booking.status === "completed") throw new Error("Completed appointments cannot be cancelled.");
  const outboxId = await withSerializableRetry(() => db.begin(async (transaction) => {
    // Keep the block/booking lock order aligned with moves so a cancel cannot race them.
    const [block] = await transaction.unsafe<{ state: string }[]>(
      "SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [booking.bookingBlockId, tenant.id],
    );
    if (!block) throw new Error("Booking availability is unavailable.");

    const [current] = await transaction.unsafe<{ status: string; startsAt: Date; endsAt: Date }[]>(
      'SELECT status, starts_at AS "startsAt", ends_at AS "endsAt" FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [booking.id, tenant.id],
    );
    if (!current) throw new Error("Booking is unavailable.");
    // A repeated click or an in-flight duplicate cancellation is a safe no-op.
    if (current.status === "cancelled" && status === "cancelled") return null;
    if (["completed", "cancelled"].includes(current.status)) {
      throw new Error("This appointment has a final status and cannot be changed.");
    }
    if (status !== "cancelled" && !canChangeAttendanceNow(current)) {
      throw new Error("Attendance cannot be updated before the appointment is eligible.");
    }
    const allowedTransitions: Record<string, string[]> = {
      confirmed: ["arrived", "completed", "no_show", "cancelled"],
      arrived: ["completed", "no_show", "cancelled"],
      no_show: ["completed"],
    };
    if (!allowedTransitions[current.status]?.includes(status)) {
      throw new Error("That appointment status change is not allowed.");
    }

    await transaction.unsafe("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [status, booking.id, tenant.id]);
    let cancellationOutboxId: string | null = null;
    if (status === "cancelled") {
      await refundGiftCardOnCancellation(transaction as unknown as ReturnType<typeof tenantDb>, tenant.id, booking.id, actor?.id ?? null);
      await transaction.unsafe("UPDATE booking_blocks SET state = 'cancelled' WHERE id = $1 AND tenant_id = $2", [booking.bookingBlockId, tenant.id]);
      const [entry] = await transaction.unsafe<{ id: string }[]>("INSERT INTO email_outbox (tenant_id, booking_id, message_type, recipient, payload) VALUES ($1, $2, 'cancellation', $3, $4::text::jsonb) RETURNING id", [tenant.id, booking.id, booking.customerEmail, JSON.stringify({ bookingId: booking.id })]);
      cancellationOutboxId = entry.id;
    }
    await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, $3, $4::text::jsonb)", [tenant.id, booking.id, `booking.${status}`, JSON.stringify({ previousStatus: current.status })]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking', $3, $4::text::jsonb)", [tenant.id, `booking.${status}`, booking.id, JSON.stringify({ previousStatus: current.status })]);
    return cancellationOutboxId;
  }));
  promptEmailDelivery(tenant, outboxId);
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
export async function recordPayment(formData: FormData): Promise<PaymentState> {
  const kind = String(formData.get("kind") ?? "");
  try {
    if (kind !== "payment" && kind !== "refund") throw new Error("Select a payment action.");
    const entryId = String(formData.get("entryId") ?? "");
    const bookingId = String(formData.get("bookingId") ?? "");
    const method = String(formData.get("method") ?? "card");
    const amount = Number(String(formData.get("amountDkk") ?? "").replace(",", "."));
    if (!bookingId || !manualPaymentMethods.some((item) => item === method) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > 10_000_000) {
      throw new Error("Enter a valid positive amount and payment method.");
    }
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entryId)) throw new Error("The payment entry could not be identified.");
    const { tenant, db, booking } = await editableBooking(bookingId, "manager");
    assertNoOperationalFreeText(formData, "notes");
    const identity = await requireIdentity();
    const amountCents = Math.round(amount * 100);
    await db.begin(async (transaction) => {
      // Use the ledger trigger's booking lock to serialize simultaneous retries.
      const [locked] = await transaction.unsafe<{ status: string }[]>(
        "SELECT status FROM bookings WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenant.id, booking.id],
      );
      if (!locked) throw new Error("Booking is unavailable.");
      const [existing] = await transaction.unsafe<{ bookingId: string; kind: string; method: string; amountCents: number; actorId: string | null }[]>(`
        SELECT booking_id AS "bookingId", kind, method, amount_cents AS "amountCents", recorded_by_identity_id AS "actorId"
        FROM payment_records WHERE tenant_id = $1 AND id = $2
      `, [tenant.id, entryId]);
      if (existing) {
        if (existing.bookingId !== booking.id || existing.actorId !== identity.id || existing.kind !== kind || existing.method !== method || existing.amountCents !== amountCents) {
          throw new Error("The recorded payment entry does not match this request.");
        }
        return;
      }
      if (kind === "payment") {
        if (locked.status === "cancelled") throw new Error("Cancelled appointments cannot receive a payment record.");
        if ((await activeAppointmentPayments(transaction, tenant.id, booking.id)).length) {
          throw new Error("A payment is already recorded. Edit or delete it before recording another.");
        }
      }
      const [payment] = await transaction.unsafe<{ id: string }[]>(
        "INSERT INTO payment_records (id, tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [entryId, tenant.id, booking.id, kind, amountCents, method, identity.id],
      );
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)", [tenant.id, booking.id, identity.id, `payment.${kind}`, { paymentId: payment.id, amountCents, method }]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, 'payment_record', $4, $5::jsonb)", [tenant.id, identity.id, `payment.${kind}_recorded`, payment.id, { bookingId: booking.id, amountCents, method }]);
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record this payment.", success: null };
  }
  revalidateCalendars();
  return { error: null, success: kind === "refund" ? "Refund recorded." : "Payment recorded." };
}

/** Corrects a manually recorded receipt without changing original transactions. */
export async function correctAppointmentPayment(formData: FormData): Promise<PaymentState> {
  const op = String(formData.get("operation") ?? "");
  const operationId = String(formData.get("operationId") ?? "");
  const bookingId = String(formData.get("bookingId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const revision = String(formData.get("revision") ?? "") || null;
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const method = op === "edit" ? String(formData.get("method") ?? "") : null;
  const amount = op === "edit" ? Number(String(formData.get("amountDkk") ?? "").replace(",", ".")) : 0;
  const amountCents = Math.round(amount * 100);

  try {
    if (!["edit", "delete"].includes(op) || ![bookingId, paymentId, operationId].every((id) => uuid.test(id))) {
      throw new Error("The payment could not be identified.");
    }
    if (op === "edit" && (!manualPaymentMethods.some((item) => item === method) || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > 10_000_000)) {
      throw new Error("Enter a valid positive amount and payment method.");
    }
    const { tenant, db, booking } = await editableBooking(bookingId, "manager");
    const actor = await requireIdentity();
    const event = op === "edit" ? "payment.corrected" : "payment.deleted";
    await db.begin(async (transaction) => {
      const [locked] = await transaction.unsafe<{ status: string }[]>(
        "SELECT status FROM bookings WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenant.id, booking.id],
      );
      if (!locked) throw new Error("Booking is unavailable.");
      const [previous] = await transaction.unsafe<{ matches: boolean }[]>(`
        SELECT event_type = $4 AND actor_identity_id = $5 AND metadata->>'paymentId' = $6
          AND (metadata->>'amountCents')::int = $7 AND (metadata->>'method') IS NOT DISTINCT FROM $8 AS matches
        FROM booking_events WHERE tenant_id=$1 AND booking_id=$2 AND id=$3
      `, [tenant.id, booking.id, operationId, event, actor.id, paymentId, amountCents, method]);
      if (previous?.matches) return;
      if (previous) throw new Error("This payment correction does not match the original request.");

      const payments = await activeAppointmentPayments(transaction, tenant.id, booking.id);
      const payment = payments.find((item) => item.id === paymentId);
      if (!payment || payment.revision !== revision) throw new Error("This payment has changed. Reopen the appointment and try again.");
      if (payment.method === "gift_card") throw new Error("Gift-card payments use the original card’s refund workflow.");

      const [balance] = await transaction.unsafe<{ available: number }[]>(`
        SELECT coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0)::int AS available
        FROM payment_records WHERE tenant_id=$1 AND booking_id=$2 AND method <> 'gift_card'
      `, [tenant.id, booking.id]);
      const onlyManualPayment = payments.filter((item) => item.method !== "gift_card").length === 1;
      const delta = op === "delete" && onlyManualPayment ? -Math.max(balance.available, 0) : amountCents - payment.amountCents;
      if (delta < -balance.available && delta < 0) {
        throw new Error("This change exceeds the collected balance after refunds.");
      }
      if (op === "edit" && locked.status === "cancelled") throw new Error("Cancelled appointments cannot have payments edited.");
      const ledgerMethod = delta < 0 ? payment.method : method;
      const adjustmentId = delta === 0 ? null : crypto.randomUUID();
      if (adjustmentId) {
        await transaction.unsafe(`
          INSERT INTO payment_records (id,tenant_id,booking_id,kind,amount_cents,method,recorded_by_identity_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [adjustmentId, tenant.id, booking.id, delta < 0 ? "refund" : "payment", Math.abs(delta), ledgerMethod, actor.id]);
      }
      const metadata = JSON.stringify({ paymentId, adjustmentId, amountCents, method, previousAmountCents: payment.amountCents, previousMethod: payment.method });
      await transaction.unsafe(`
        INSERT INTO booking_events (id,tenant_id,booking_id,actor_identity_id,event_type,metadata,created_at)
        VALUES ($1,$2,$3,$4,$5,$6::text::jsonb,clock_timestamp())
      `, [operationId, tenant.id, booking.id, actor.id, event, metadata]);
      await transaction.unsafe(`
        INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata)
        VALUES ($1,$2,$3,'payment_record',$4,($5::text::jsonb || jsonb_build_object('bookingId',$6::uuid)))
      `, [tenant.id, actor.id, event, paymentId, metadata, booking.id]);
    });
    revalidateCalendars();
    return { error: null, success: op === "delete" ? "Payment deleted." : "Payment updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the payment.", success: null };
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
      `, [tenant.id, teamMemberId, null, locationId, startsAt, endsAt]);
      const [booking] = await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO bookings (tenant_id, booking_block_id, service_id, location_id, team_member_id, resource_id, customer_id, starts_at, ends_at, booked_price_cents, status, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', 'tenant')
        RETURNING id
      `, [tenant.id, block.id, service.id, locationId, teamMemberId, null, customer.id, startsAt, endsAt, service.priceCents]);
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
