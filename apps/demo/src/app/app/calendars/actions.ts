"use server";

import { activeAppointmentPayments, hasNonGiftCardPayment, manualPaymentMethods } from "@/lib/waybook/appointment-payment-records";
import { canCompleteNoShow, getAppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TransactionSql } from "postgres";
import { assertNoOperationalFreeText } from "@/lib/waybook/operations-only-fields";
import { refundGiftCardOnCancellation } from "@/lib/waybook/gift-card-cancellation";
import { fromZonedTime } from "date-fns-tz";
import { BookingConflictError, withSerializableRetry } from "@/lib/waybook/transaction-conflicts";
import { requireIdentity } from "@/lib/waybook/auth";
import { staffAvailableSlots } from "@/lib/waybook/booking";
import { appointmentHasSettlement, calendarBookingVisibility, getAdditionalAppointmentServices } from "@/lib/waybook/appointment-service-segments";
import { getAppointmentReservations, linkedAppointmentOpenings } from "@/lib/waybook/linked-appointment-schedule";
import { tenantDb } from "@/lib/waybook/database";
import { arrivalAlertsEnabled, unnotifiedArrivalProviders } from "@/lib/waybook/provider-arrival-alerts";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { appointmentClientCard, runClientCardSetup } from "@/lib/waybook/stripe-client-card";
import { appointmentStripeAccount, appointmentStripeConfig, runAppointmentStripeCheckout } from "@/lib/waybook/stripe-appointment-checkout";
import { runStripeAppointmentRefund } from "@/lib/waybook/stripe-appointment-refunds";
import { requireFeature } from "@/lib/waybook/features";
import { appointmentCheckoutAccess } from "@/lib/waybook/appointment-checkout-access";
import { canManageAppointment, canUpdateAppointmentAttendance, staffPermissionContext, type StaffPermissionContext } from "@/lib/waybook/staff-permissions";
import { promptEmailDelivery } from "@/lib/waybook/email-delivery-trigger";
import {
  activeAppointmentStage,
  type AppointmentAttendanceStage,
  assertMovableAppointmentStatus,
  canBeginAppointmentAttendance,
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
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId)) return null;
  const { tenant, permissions } = await calendarPermissionContext();
  const canViewTeam = permissions.isManager || permissions.canViewTeamCalendar;
  if (!canViewTeam && !permissions.teamMemberId) return null;
  const db = tenantDb(tenant);
  const [booking] = await db<{ id: string; bookingNumber: string; serviceId: string; locationId: string; locationName: string | null; customerId: string; customerCreatedAt: Date; createdAt: Date; updatedAt: Date; source: "public" | "tenant"; resourceId: string | null; startsAt: Date; endsAt: Date; status: string; attendanceStage: AppointmentAttendanceStage | null; customerName: string; customerEmail: string; customerPhone: string | null; serviceTitle: string; teamMemberName: string | null; teamMemberId: string | null; revision: string; priceCents: number; hasSettlement: boolean; canCheckout: boolean }[]>`
    SELECT b.id,b.booking_number AS "bookingNumber",b.service_id AS "serviceId",b.location_id AS "locationId",
      l.name AS "locationName", c.id AS "customerId", c.created_at AS "customerCreatedAt",
      b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.source,
      bra.resource_id AS "resourceId",b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.status,b.attendance_stage AS "attendanceStage",
      c.name AS "customerName",c.email AS "customerEmail",c.phone AS "customerPhone",s.title AS "serviceTitle",tm.name AS "teamMemberName",tm.id AS "teamMemberId",
      b.updated_at::text AS revision, b.booked_price_cents AS "priceCents", ${appointmentHasSettlement(db)} AS "hasSettlement",
      (${appointmentCheckoutAccess(db, permissions)}) AS "canCheckout"
    FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
    JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
    LEFT JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id
    LEFT JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id
    LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL
    WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId} AND ${calendarBookingVisibility(db, canViewTeam, permissions.teamMemberId)} LIMIT 1
  `;
  if (!booking) return null;
  const { teamMemberId, revision, priceCents, hasSettlement, customerId, customerCreatedAt, createdAt, updatedAt, source, ...detail } = booking;
  const [resources, paymentBalance, additionalServices, bookingActors, clientCard] = await Promise.all([
    permissions.isManager ? db<{ id: string; name: string; isMutuallyExclusive: boolean }[]>`
    SELECT r.id,r.name,r.is_mutually_exclusive AS "isMutuallyExclusive" FROM resources r
    JOIN resource_locations rl ON rl.tenant_id=r.tenant_id AND rl.resource_id=r.id AND rl.location_id=${booking.locationId}
    JOIN service_resources sr ON sr.tenant_id=r.tenant_id AND sr.resource_id=r.id AND sr.service_id=${booking.serviceId}
    WHERE r.tenant_id=${tenant.id} AND r.is_active=TRUE ORDER BY r.name
  ` : [],
    permissions.isManager ? getAppointmentPaymentBalance(db, tenant.id, bookingId) : null,
    getAdditionalAppointmentServices(db, tenant.id, bookingId),
    permissions.isManager ? db<{ event: "created" | "updated"; name: string }[]>`
      SELECT DISTINCT ON (activity.event) activity.event, member.name
      FROM booking_events e
      CROSS JOIN LATERAL (
        SELECT CASE WHEN e.event_type = 'booking.created_by_tenant' THEN 'created' ELSE 'updated' END AS event
      ) activity
      JOIN team_members member ON member.tenant_id=e.tenant_id AND member.identity_id=e.actor_identity_id
      WHERE e.tenant_id=${tenant.id} AND e.booking_id=${bookingId}
        AND (e.event_type = 'booking.created_by_tenant'
          OR (e.event_type LIKE 'booking.%' AND e.created_at::text = ${revision}))
      ORDER BY activity.event, e.created_at DESC, e.id, member.id
    ` : [],
    permissions.isManager ? appointmentClientCard({ db, tenantId: tenant.id, customerId }) : null,
  ]);
  const providers = [teamMemberId, ...additionalServices.map((item) => item.teamMemberId)];
  const ownSegment = !canViewTeam && teamMemberId !== permissions.teamMemberId
    ? additionalServices.find((item) => item.teamMemberId === permissions.teamMemberId)
    : undefined;
  if (!canViewTeam && teamMemberId !== permissions.teamMemberId && !ownSegment) return null;
  const visibleAdditionalServices = additionalServices
    .filter((item) => item.id !== ownSegment?.id && (canViewTeam || item.teamMemberId === permissions.teamMemberId))
    .map(({ id, provider, title, startsAt, endsAt, priceCents }) => ({
      id, provider, title, startsAt, endsAt, priceCents: permissions.isManager ? priceCents : null,
    }));
  const canManageSchedule = canManageAppointment(permissions, ...providers) &&
    (canViewTeam || providers.length === 1 || providers.every((id) => id === permissions.teamMemberId));
  const canUpdateStatus = canUpdateAppointmentAttendance(permissions, providers);
  const canNotifyProviders = booking.status === "arrived" && booking.attendanceStage === "waiting_room" &&
    canUpdateStatus && await arrivalAlertsEnabled(db, tenant.id) &&
    (await db`${unnotifiedArrivalProviders(db, tenant.id, booking.id, providers)} LIMIT 1`).length > 0;
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
    clientCard,
    clientRecord: permissions.isManager ? { id: customerId, createdAt: customerCreatedAt.toISOString() } : null,
    activity: permissions.isManager ? {
      source, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
      bookedBy: bookingActors.find((event) => event.event === "created")?.name,
      updatedBy: bookingActors.find((event) => event.event === "updated")?.name,
    } : null,
    resourceId: permissions.isManager ? booking.resourceId : null,
    serviceId: permissions.isManager ? booking.serviceId : "",
    locationId: permissions.isManager ? booking.locationId : "",
    serviceTitle: ownSegment?.title ?? booking.serviceTitle,
    teamMemberName: ownSegment?.provider ?? booking.teamMemberName ?? "",
    startsAt: ownSegment?.startsAt ?? booking.startsAt.toISOString(),
    endsAt: ownSegment?.endsAt ?? booking.endsAt.toISOString(),
    canManage: permissions.isManager,
    canManageSchedule,
    canCheckIn: canBeginAppointmentAttendance(booking.startsAt, tenant.timezone),
    canChangeAttendanceNow: canChangeAttendanceNow(booking),
    canUpdateStatus,
    canNotifyProviders,
    resources,
    paymentBalance,
    days,
    slots,
    primaryServicePriceCents: permissions.isManager ? priceCents : null,
    additionalServices: visibleAdditionalServices,
    serviceEditor: permissions.isManager && !hasSettlement && isMovableAppointmentStatus(booking.status)
      ? { revision, primary: { id: null, serviceId: booking.serviceId, title: booking.serviceTitle, teamMemberId,
          provider: booking.teamMemberName, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), priceCents },
        additional: additionalServices }
      : null,
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
  const candidates = await staffAvailableSlots(
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
  if (booking.hasLinkedServices) {
    const reservations = await getAppointmentReservations(db, tenant.id, booking.id);
    assertAppointmentPermission(permissions, ...reservations.map((item) => item.teamMemberId));
    const endDate = new Date(`${input.startDate}T12:00:00Z`);
    if (!Number.isFinite(endDate.getTime())) return { slots: [] };
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    const from = fromZonedTime(`${input.startDate}T00:00:00`, tenant.timezone);
    const until = fromZonedTime(`${endDate.toISOString().slice(0, 10)}T00:00:00`, tenant.timezone);
    return { slots: await linkedAppointmentOpenings(db, tenant, booking.locationId, reservations, from, until, 30) };
  }
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

async function editableBooking(bookingId: string, purpose: "appointment" | "status" | "manager" | "checkout" = "appointment") {
  if (!bookingId) throw new Error("Booking is required.");
  const privilegedTenant = purpose === "manager" ? await editableCalendarTenant() : null;
  const { tenant, permissions } = privilegedTenant
    ? { tenant: privilegedTenant, permissions: { isManager: true } as StaffPermissionContext }
    : await calendarPermissionContext();
  const db = tenantDb(tenant);
  const [booking] = await db<{
    id: string; bookingBlockId: string; teamMemberId: string | null; resourceId: string | null; serviceId: string; locationId: string; customerId: string; customerEmail: string; status: string; startsAt: Date; endsAt: Date; durationMinutes: number; hasLinkedServices: boolean;
  }[]>`
    SELECT b.id, b.booking_block_id AS "bookingBlockId", b.team_member_id AS "teamMemberId", b.resource_id AS "resourceId", b.service_id AS "serviceId", b.location_id AS "locationId", c.id AS "customerId", c.email AS "customerEmail", b.status, b.starts_at AS "startsAt", b.ends_at AS "endsAt",
      s.duration_minutes AS "durationMinutes",
      EXISTS (SELECT 1 FROM booking_service_segments segment WHERE segment.tenant_id = b.tenant_id AND segment.booking_id = b.id) AS "hasLinkedServices"
    FROM bookings b JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
    WHERE b.id = ${bookingId} AND b.tenant_id = ${tenant.id}
      AND ${purpose === "checkout" ? appointmentCheckoutAccess(db, permissions) : db`TRUE`} LIMIT 1
  `;
  if (!booking) throw new Error("Booking is unavailable.");
  const linkedProviders = booking.hasLinkedServices && !permissions.isManager
    ? (await getAppointmentReservations(db, tenant.id, booking.id)).filter((item) => item.position > 1).map((item) => item.teamMemberId)
    : [];
  const providers = [booking.teamMemberId, ...linkedProviders];
  if (purpose === "manager" || purpose === "checkout") {
    // Manager and scoped checkout access were checked above.
  } else if (purpose === "status") {
    if (!canUpdateAppointmentAttendance(permissions, providers)) {
      throw new Error("You do not have permission to change appointment status.");
    }
  } else {
    if (booking.hasLinkedServices && !permissions.isManager && !permissions.canViewTeamCalendar
      && providers.some((id) => id !== permissions.teamMemberId)) {
      throw new Error("You do not have permission to change this appointment.");
    }
    assertAppointmentPermission(permissions, ...providers);
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
  if (booking.hasLinkedServices) return { error: "Linked services must be rescheduled together." };
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
    if (booking.hasLinkedServices) return { targets: [], error: "Linked services must be rescheduled together." };
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

export type BookingDetailsResult = { error: string | null; paymentRequired?: boolean };

class NoShowPaymentRequired extends Error {
  constructor() {
    super("Record a payment before marking this no-show as completed.");
  }
}

const attendanceStatuses = ["arrived", "completed", "no_show"];
type ManualPayment = { amountCents: number; method: string; entryId: string; actorId: string };

function parseDrawerPayment(data: FormData) {
  const amount = String(data.get("paymentAmount") ?? "").trim().replace(",", ".");
  if (!amount) return null;
  const method = String(data.get("paymentMethod") ?? "");
  const amountCents = Math.round(Number(amount) * 100);
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !manualPaymentMethods.some(item => item === method) ||
    amountCents < 1 || amountCents > 10_000_000) throw new Error("Enter a valid payment amount and method.");
  return { amountCents, method, entryId: crypto.randomUUID() };
}

export async function updateBookingDetails(formData: FormData): Promise<BookingDetailsResult> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status && !attendanceStatuses.includes(status)) return { error: "Choose an attendance status." };
  const editDetails = formData.get("editDetails") !== "false";
  const paymentEntered = String(formData.get("paymentAmount") ?? "").trim() !== "";
  if (!editDetails && !status && !paymentEntered) return { error: null };
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (editDetails && (!name || !email.includes("@"))) throw new Error("Enter the customer name and a valid email.");
  const context = await editableBooking(bookingId, "manager");
  const { tenant, db, booking } = context;
  const identity = await requireIdentity();
  try {
    const payment = parseDrawerPayment(formData);
    await withSerializableRetry(() => db.begin(async (transaction) => {
      if (status || payment) await persistBookingStatus(transaction, context, status, formData.get("expectedStatus"), null,
        { noShowPayment: payment ? { ...payment, actorId: identity.id } : undefined });

      if (!editDetails) return;
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
    }));
  } catch (error) {
    if (error instanceof NoShowPaymentRequired) return { error: error.message, paymentRequired: true };
    if (error instanceof Error && "code" in error && error.code === "P0001"
      && error.message === "exclusive resource is already assigned for this appointment time") {
      return { error: "This resource is already assigned for this appointment time." };
    }
    return { error: error instanceof Error ? error.message : "Could not save appointment changes." };
  }
  revalidateCalendars();
  return { error: null };
}

async function rescheduleBookingRecord(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const localStartsAt = String(formData.get("startsAt") ?? "");
  const teamMemberId = String(formData.get("teamMemberId") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localStartsAt)) throw new Error("Choose a valid local appointment time.");
  const initial = await editableBooking(bookingId);
  if (!initial.booking.teamMemberId || !isMovableAppointmentStatus(initial.booking.status)) throw new Error("Only confirmed or arrived assigned appointments can be rescheduled.");
  const nextTeamMemberId = teamMemberId || initial.booking.teamMemberId;
  const move = initial.booking.hasLinkedServices
    ? {
        error: null, context: initial, startsAt: fromZonedTime(localStartsAt, initial.tenant.timezone),
        endsAt: undefined,
      }
    : await checkCalendarMove({ bookingId, startsAt: localStartsAt, teamMemberId: nextTeamMemberId });
  if (move.error || !move.context || !move.startsAt) throw new Error(move.error ?? "That appointment can no longer be moved.");
  const { tenant, db, booking, permissions } = move.context;
  const { startsAt } = move;
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() < Date.now() || localDateTimeKey(startsAt, tenant.timezone) !== localStartsAt) {
    throw new Error("Choose a valid future appointment time.");
  }
  const endsAt = move.endsAt ?? new Date(startsAt.getTime() + booking.endsAt.getTime() - booking.startsAt.getTime());
  try {
    const outboxId = await withSerializableRetry(async () => db.begin(async (transaction) => {
      if (booking.hasLinkedServices) await transaction.unsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      // Keep the block/booking lock order aligned with status changes. The status
      // is re-read after the locks so a final transition after preflight wins.
      const [block] = await transaction.unsafe<{ state: string }[]>("SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [booking.bookingBlockId, tenant.id]);
      if (!block || block.state !== "confirmed") throw new Error("Booking can no longer be rescheduled.");
      const [current] = await transaction.unsafe<{ status: string; startsAt: Date }[]>('SELECT status, starts_at AS "startsAt" FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [booking.id, tenant.id]);
      if (!current) throw new Error("Booking is unavailable.");
      assertMovableAppointmentStatus(current.status);
      const expectedStart = formData.get("expectedStartsAt");
      if ((expectedStart && current.startsAt.toISOString() !== expectedStart) || current.startsAt.getTime() !== booking.startsAt.getTime()) {
        throw new Error("This appointment has moved. Reopen it to see the latest schedule.");
      }
      if (booking.hasLinkedServices) {
        if (nextTeamMemberId !== booking.teamMemberId) throw new Error("Rescheduling keeps the provider assigned to each service.");
        const connection = transaction as unknown as typeof db;
        const reservations = await getAppointmentReservations(connection, tenant.id, booking.id);
        assertAppointmentPermission(permissions, ...reservations.map((item) => item.teamMemberId));
        const openings = await linkedAppointmentOpenings(connection, tenant, booking.locationId, reservations, startsAt, new Date(startsAt.getTime() + 1), 1);
        if (!openings.length) throw new Error("That time is no longer available for every service. Choose another time.");
        const delta = startsAt.getTime() - current.startsAt.getTime();
        const ids = reservations.map(({ id }) => id);
        // All original blocks must leave the exclusion constraint together before
        // re-entering it, because a small move can overlap the adjacent old block.
        await transaction.unsafe("UPDATE booking_blocks SET state = 'released' WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenant.id, ids]);
        await transaction.unsafe(`
          UPDATE booking_blocks SET starts_at = starts_at + ($1::bigint * interval '1 millisecond'),
            ends_at = ends_at + ($1::bigint * interval '1 millisecond'), state = 'confirmed'
          WHERE tenant_id = $2 AND id = ANY($3::uuid[])
        `, [delta, tenant.id, ids]);
      } else {
        await transaction.unsafe("UPDATE booking_blocks SET team_member_id = $1, starts_at = $2, ends_at = $3, resource_id = NULL WHERE id = $4 AND tenant_id = $5", [nextTeamMemberId, startsAt, endsAt, booking.bookingBlockId, tenant.id]);
      }
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

export async function rescheduleBooking(formData: FormData): Promise<{ error: string | null }> {
  try {
    await rescheduleBookingRecord(formData);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not reschedule this appointment. Choose another time." };
  }
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

async function persistBookingStatus(
  transaction: TransactionSql,
  { tenant, booking }: EditableBooking,
  status: string,
  expectedStatus: FormDataEntryValue | null,
  actorId: string | null,
  { noShowPayment, finishCheckout }: { noShowPayment?: ManualPayment; finishCheckout?: boolean } = {},
) {
  // Keep the block/booking lock order aligned with moves so a cancel cannot race them.
  const [block] = await transaction.unsafe<{ state: string }[]>(
    "SELECT state FROM booking_blocks WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
    [booking.bookingBlockId, tenant.id],
  );
  if (!block) throw new Error("Booking availability is unavailable.");

  const [current] = await transaction.unsafe<{ status: string; startsAt: Date; endsAt: Date; stage: AppointmentAttendanceStage | null }[]>(
    'SELECT status, starts_at AS "startsAt", ends_at AS "endsAt", attendance_stage AS stage FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [booking.id, tenant.id],
  );
  if (!current) throw new Error("Booking is unavailable.");
  if (status !== "cancelled" && current.status !== expectedStatus) {
    throw new Error("The appointment status has changed. Reopen the appointment and try again.");
  }
  // A repeated click or an in-flight duplicate cancellation is a safe no-op.
  if (current.status === "cancelled" && status === "cancelled") return null;
  if (["completed", "cancelled"].includes(current.status)) {
    throw new Error("This appointment has a final status and cannot be changed.");
  }
  const completingCheckout = current.stage === "checking_out" && status === "completed";
  if (status !== "cancelled" && !(completingCheckout && finishCheckout) && !canChangeAttendanceNow(current)) {
    throw new Error("Attendance cannot be updated before the appointment is eligible.");
  }
  const allowedTransitions: Record<string, string[]> = {
    confirmed: ["arrived", "completed", "no_show", "cancelled"],
    arrived: ["completed", "no_show", "cancelled"],
    no_show: ["completed"],
  };
  if (status && !allowedTransitions[current.status]?.includes(status)) {
    throw new Error("That appointment status change is not allowed.");
  }

  if (noShowPayment) {
    if (current.status !== "no_show") throw new Error("This payment can only be entered for a no-show.");
    if ((await activeAppointmentPayments(transaction, tenant.id, booking.id)).length) {
      throw new Error("A payment is already recorded. Edit or delete it before recording another.");
    }
    const [cart] = await transaction.unsafe<{ canAddFee: boolean }[]>(`
      SELECT chargeable_cents = 0 AND NOT package_redeemed AS "canAddFee"
      FROM appointment_checkout_amounts($1, $2)
    `, [tenant.id, booking.id]);
    if (cart?.canAddFee) {
      await transaction.unsafe("UPDATE bookings SET no_show_charge_cents=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [noShowPayment.amountCents, tenant.id, booking.id]);
    }
    await insertManualPaymentEntry(transaction, tenant.id, booking.id, "payment", noShowPayment);
  }
  if (!status) return null;

  if (current.status === "no_show" && status === "completed" && !(await canCompleteNoShow(transaction, tenant.id, booking.id))) {
    throw new NoShowPaymentRequired();
  }
  if (completingCheckout) {
    const [settlement] = await transaction.unsafe<{ paid: boolean }[]>(`
      SELECT cart.chargeable_cents = coalesce((
        SELECT sum(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END)
        FROM payment_records WHERE tenant_id = $1 AND booking_id = $2
      ), 0) OR EXISTS (
        SELECT 1 FROM payment_records p
        JOIN booking_events e ON e.tenant_id = p.tenant_id AND e.booking_id = p.booking_id
          AND e.event_type = 'payment.payment' AND e.metadata->>'paymentId' = p.id::text
          AND e.metadata->>'source' = 'stripe_sandbox'
        WHERE p.tenant_id = $1 AND p.booking_id = $2 AND p.kind = 'payment'
          AND p.amount_cents = cart.chargeable_cents
      ) AS paid FROM appointment_checkout_amounts($1, $2) cart
    `, [tenant.id, booking.id]);
    if (!settlement?.paid) throw new Error("Settle the checkout balance before completing the appointment.");
  }

  await transaction.unsafe("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [status, booking.id, tenant.id]);
  let cancellationOutboxId: string | null = null;
  if (status === "cancelled") {
    await refundGiftCardOnCancellation(transaction as unknown as ReturnType<typeof tenantDb>, tenant.id, booking.id, actorId);
    await transaction.unsafe("UPDATE booking_blocks SET state = 'cancelled' WHERE id = $1 AND tenant_id = $2", [booking.bookingBlockId, tenant.id]);
    const [entry] = await transaction.unsafe<{ id: string }[]>("INSERT INTO email_outbox (tenant_id, booking_id, message_type, recipient, payload) VALUES ($1, $2, 'cancellation', $3, $4::text::jsonb) RETURNING id", [tenant.id, booking.id, booking.customerEmail, JSON.stringify({ bookingId: booking.id })]);
    cancellationOutboxId = entry.id;
  }
  await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, event_type, metadata) VALUES ($1, $2, $3, $4::text::jsonb)", [tenant.id, booking.id, `booking.${status}`, JSON.stringify({ previousStatus: current.status })]);
  await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking', $3, $4::text::jsonb)", [tenant.id, `booking.${status}`, booking.id, JSON.stringify({ previousStatus: current.status })]);
  return cancellationOutboxId;
}

async function updateBookingStatus(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["arrived", "completed", "no_show", "cancelled"].includes(status)) throw new Error("Choose a valid appointment status.");
  const context = await editableBooking(bookingId, status === "cancelled" ? "appointment" : "status");
  const { tenant, db, booking } = context;
  const actor = status === "cancelled" ? await requireIdentity() : null;
  if (status === "cancelled" && booking.status === "completed") throw new Error("Completed appointments cannot be cancelled.");
  const outboxId = await withSerializableRetry(() => db.begin((transaction) =>
    persistBookingStatus(transaction, context, status, formData.get("expectedStatus"), actor?.id ?? null),
  ));
  promptEmailDelivery(tenant, outboxId);
  revalidateCalendars();
}

export type AttendanceResult = BookingDetailsResult;

export async function notifyWaitingRoomProviders(bookingId: string) {
  try {
    const { tenant, db, booking, permissions } = await editableBooking(bookingId, "status");
    const actor = await requireIdentity();
    const count = await withSerializableRetry(() => db.begin(async (transaction) => {
      const connection = transaction as unknown as typeof db;
      await connection`SELECT id FROM booking_blocks WHERE tenant_id = ${tenant.id} AND id = ${booking.bookingBlockId} FOR UPDATE`;
      const [current] = await connection`
        SELECT b.id FROM bookings b
        WHERE b.tenant_id = ${tenant.id} AND b.id = ${booking.id}
          AND b.status = 'arrived' AND b.attendance_stage = 'waiting_room'
          AND ${calendarBookingVisibility(connection, permissions.isManager || permissions.canViewTeamCalendar, permissions.teamMemberId)}
        FOR UPDATE
      `;
      if (!current) throw new Error("This appointment is no longer in the waiting room.");
      const reservations = await getAppointmentReservations(connection, tenant.id, booking.id);
      const providers = reservations.map((item) => item.teamMemberId);
      if (!canUpdateAppointmentAttendance(permissions, providers)) {
        throw new Error("You do not have permission to notify providers for this appointment.");
      }
      const [settings] = await connection`
        SELECT tenant_id FROM tenant_settings
        WHERE tenant_id = ${tenant.id} AND provider_arrival_alerts_enabled FOR SHARE
      `;
      if (!settings) throw new Error("Waiting room alerts are turned off.");
      const alerts = await connection`
        WITH recipients AS (${unnotifiedArrivalProviders(connection, tenant.id, booking.id, providers)})
        INSERT INTO provider_arrival_alerts (tenant_id, booking_id, team_member_id)
        SELECT ${tenant.id}, ${booking.id}, id FROM recipients ON CONFLICT DO NOTHING
        RETURNING team_member_id
      `;
      if (alerts.length) {
        const event = "booking.waiting_room_providers_notified";
        const metadata = JSON.stringify({ providerCount: alerts.length });
        await connection`INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
          VALUES (${tenant.id}, ${booking.id}, ${actor.id}, ${event}, ${metadata}::text::jsonb)`;
      }
      return alerts.length;
    }));
    revalidatePath("/app/notifications");
    return { count, error: null };
  } catch (error) {
    return { count: 0, error: error instanceof Error && !("severity" in error) ? error.message : "Could not notify providers. Please try again." };
  }
}

export async function setAppointmentAttendanceStage(bookingId: string, stage: AppointmentAttendanceStage): Promise<AttendanceResult> {
  try {
    if (!["waiting_room", "in_service", "checking_out"].includes(stage)) throw new Error("Choose a valid next step.");
    const { tenant, db, booking, permissions } = await editableBooking(bookingId, stage === "checking_out" ? "checkout" : "status");
    const actor = await requireIdentity();
    await withSerializableRetry(() => db.begin(async (transaction) => {
      const connection = transaction as unknown as typeof db;
      await connection`SELECT id FROM booking_blocks WHERE tenant_id = ${tenant.id} AND id = ${booking.bookingBlockId} FOR UPDATE`;
      const canViewTeam = permissions.isManager || permissions.canViewTeamCalendar;
      const [current] = await connection<{ status: string; startsAt: Date; attendanceStage: AppointmentAttendanceStage | null }[]>`
        SELECT b.status, b.starts_at AS "startsAt", b.attendance_stage AS "attendanceStage"
        FROM bookings b WHERE b.tenant_id = ${tenant.id} AND b.id = ${booking.id}
          AND ${stage === "checking_out"
            ? appointmentCheckoutAccess(connection, permissions)
            : calendarBookingVisibility(connection, canViewTeam, permissions.teamMemberId ?? null)}
        FOR UPDATE
      `;
      if (!current) throw new Error("Appointment is unavailable.");
      if (!permissions.isManager && stage !== "checking_out") {
        const providers = await getAppointmentReservations(connection, tenant.id, booking.id);
        if (!canUpdateAppointmentAttendance(permissions, providers.map((item) => item.teamMemberId))) {
          throw new Error("You do not have permission to change attendance for this appointment.");
        }
      }
      const previousStage = activeAppointmentStage(current.status, current.attendanceStage);
      if (previousStage === stage) return;
      const isCheckIn = current.status === "confirmed" && stage !== "checking_out";
      const isStartService = previousStage === "waiting_room" && stage === "in_service";
      const isCheckout = previousStage === "in_service" && stage === "checking_out";
      if (!isCheckIn && !isStartService && !isCheckout) throw new Error("This appointment has changed. Reopen it before continuing.");
      if (!isCheckout && !canBeginAppointmentAttendance(current.startsAt, tenant.timezone)) {
        throw new Error("Check-in is available on the appointment date.");
      }
      await connection`UPDATE bookings SET status = 'arrived', attendance_stage = ${stage}, updated_at = now()
        WHERE tenant_id = ${tenant.id} AND id = ${booking.id}`;
      const event = `booking.${stage}`;
      const metadata = JSON.stringify({ previousStatus: current.status, previousStage });
      await connection`INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
        VALUES (${tenant.id}, ${booking.id}, ${actor.id}, ${event}, ${metadata}::text::jsonb)`;
      await connection`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
        VALUES (${tenant.id}, ${actor.id}, ${event}, 'booking', ${booking.id}, ${metadata}::text::jsonb)`;
    }));
    revalidateCalendars();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not update the appointment. Please try again." };
  }
}

export async function finishAppointmentCheckout(bookingId: string): Promise<AttendanceResult> {
  try {
    const context = await editableBooking(bookingId, "checkout");
    const { tenant, db, booking, permissions } = context;
    const actor = await requireIdentity();
    await withSerializableRetry(() => db.begin(async (transaction) => {
      await transaction.unsafe("SELECT id FROM booking_blocks WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenant.id, booking.bookingBlockId]);
      const connection = transaction as unknown as typeof db;
      const [current] = await connection<{ status: string; stage: string | null }[]>`
        SELECT b.status, b.attendance_stage AS stage FROM bookings b
        WHERE b.tenant_id = ${tenant.id} AND b.id = ${booking.id}
          AND ${appointmentCheckoutAccess(connection, permissions)}
        FOR UPDATE
      `;
      if (current?.status === "completed") return;
      if (current?.status !== "arrived" || current.stage !== "checking_out") throw new Error("Open checkout from the appointment before finishing it.");
      await persistBookingStatus(transaction, context, "completed", "arrived", actor.id, { finishCheckout: true });
    }));
    revalidateCalendars();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not finish checkout. Please try again." };
  }
}

export async function saveAppointmentAttendance(formData: FormData): Promise<AttendanceResult> {
  try {
    if (!attendanceStatuses.includes(String(formData.get("status")))) {
      throw new Error("Choose an attendance status.");
    }
    await updateBookingStatus(formData);
    return { error: null };
  } catch (error) {
    if (error instanceof NoShowPaymentRequired) return { error: error.message, paymentRequired: true };
    return { error: error instanceof Error ? error.message : "Could not save appointment status." };
  }
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

export async function updateStripeAppointmentRefund(_state: PaymentState, formData: FormData): Promise<PaymentState> {
  try {
    const config = appointmentStripeConfig();
    const action = formData.get("action");
    const bookingId = String(formData.get("bookingId") ?? "");
    const id = String(formData.get("requestId") ?? "");
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (!config || (action !== "start" && action !== "check") || !uuid.test(bookingId) || !uuid.test(id)) {
      throw new Error("Stripe sandbox refund is unavailable.");
    }
    const amount = String(formData.get("amountDkk") ?? "").replace(",", ".");
    if (action === "start" && !/^\d{1,6}(?:\.\d{1,2})?$/.test(amount)) throw new Error("Enter a valid refund amount.");
    const { tenant, db } = await editableBooking(bookingId, "manager");
    await requireFeature(tenant.id, "booking-essentials");
    const actor = await requireIdentity();
    const result = await runStripeAppointmentRefund({ db, tenantId: tenant.id, bookingId }, config, {
      action, id, amountCents: Math.round(Number(amount) * 100),
      expectedCents: Number(formData.get("expectedCents")), actorId: actor.id,
    });
    const message = {
      succeeded: "Stripe sandbox refund recorded.",
      pending: "Stripe is processing the refund. Check its status again shortly.",
      failed: "Stripe declined the refund. Review the payment before trying again.",
      canceled: "Stripe cancelled the refund.",
    };
    revalidateCalendars();
    return { error: result === "failed" ? message.failed : null, success: !result ? "There is no pending Stripe refund." : result === "failed" ? null : message[result] };
  } catch (error) {
    revalidateCalendars();
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not verify the Stripe refund. Check its status before trying again.", success: null };
  }
}

export async function updateAppointmentClientCard(_state: PaymentState, formData: FormData): Promise<PaymentState> {
  let destination: string | null = null;
  try {
    const config = appointmentStripeConfig();
    if (!config) throw new Error("Stripe card setup is unavailable.");
    const bookingId = String(formData.get("bookingId") ?? "");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId)) throw new Error("Appointment is unavailable.");
    const action = formData.get("action");
    if (action !== "open" && action !== "return") throw new Error("Choose a card setup action.");
    if (action === "open" && formData.get("clientConsent") !== "on") {
      throw new Error("Confirm the client agreed to save this card.");
    }
    const { tenant, db, booking } = await editableBooking(bookingId, "manager");
    await requireFeature(tenant.id, "booking-essentials");
    const [identity, slug, accountId] = await Promise.all([
      requireIdentity(), currentTenantRouteSlug(tenant.slug), appointmentStripeAccount(tenant.id),
    ]);
    if (!accountId) throw new Error("Connect Stripe in Settings before adding a credit card.");
    const search = new URLSearchParams({ booking: booking.id, day: localDateKey(booking.startsAt, tenant.timezone) });
    const appointmentUrl = new URL(tenantPath(slug, `/app/calendars?${search}`), config.origin);
    const returnUrl = new URL(appointmentUrl);
    returnUrl.searchParams.set("cardSetup", "return");

    const outcome = await runClientCardSetup({ db, tenantId: tenant.id, customerId: booking.customerId, accountId }, config, {
      action, actorId: identity.id, returnUrl: returnUrl.href,
    });
    if (outcome.state === "saved") {
      revalidateCalendars();
      destination = appointmentUrl.href;
    } else if (outcome.state === "open" && action === "open") {
      destination = outcome.url;
    } else {
      return {
        error: outcome.state === "expired" ? "This card setup expired. Open a new setup to try again." : "Stripe has not confirmed a saved card. Try checking again shortly.",
        success: null,
      };
    }
  } catch (error) {
    return { error: error instanceof Error && !(error instanceof TypeError) && !("severity" in error)
      ? error.message : "Could not verify card setup. Please try again.", success: null };
  }
  if (destination) redirect(destination);
  return { error: null, success: null };
}

export async function updateStripeAppointmentPayment(_state: PaymentState, formData: FormData): Promise<PaymentState> {
  let destination: string | null = null;
  let success: string | null = null;
  try {
    const config = appointmentStripeConfig();
    if (!config) throw new Error("Stripe sandbox checkout is unavailable.");
    const action = formData.get("action");
    const bookingId = String(formData.get("bookingId") ?? "");
    const expectedCents = Number(formData.get("expectedCents"));
    if (action !== "open" && action !== "check" && action !== "cancel" && action !== "return") throw new Error("Choose a payment action.");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId)) throw new Error("Appointment is unavailable.");
    const { tenant, db } = await editableBooking(bookingId, "manager");
    await requireFeature(tenant.id, "booking-essentials");
    const [identity, slug] = await Promise.all([requireIdentity(), currentTenantRouteSlug(tenant.slug)]);
    const reviewPath = tenantPath(slug, `/app/sales?booking=${bookingId}`);
    const outcome = await runAppointmentStripeCheckout({ db, tenantId: tenant.id, bookingId }, config, {
      action, expectedCents, actorId: identity.id, returnPath: `${reviewPath}&step=payment&stripe=return`,
    });
    if (outcome.state === "open" && action === "open") destination = outcome.url;
    if (outcome.state === "paid") destination = reviewPath;
    if (outcome.state === "expired") success = "Stripe checkout is closed. You can choose a payment method.";
    if (outcome.state === "open") success = "Stripe is waiting for the card payment.";
    if (outcome.state === "processing") success = "Stripe is processing the payment. Check again shortly.";
  } catch (error) {
    revalidateCalendars();
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not verify the Stripe payment. Check again before taking payment.", success: null };
  }
  revalidateCalendars();
  if (destination) redirect(destination);
  return { error: null, success };
}

/** Appends a tenant-recorded payment or refund; corrections are never destructive. */
async function insertManualPaymentEntry(
  transaction: TransactionSql,
  tenantId: string,
  bookingId: string,
  kind: "payment" | "refund",
  { entryId, amountCents, method, actorId }: ManualPayment,
) {
  const [payment] = await transaction.unsafe<{ id: string }[]>(
    "INSERT INTO payment_records (id, tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [entryId, tenantId, bookingId, kind, amountCents, method, actorId],
  );
  await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)", [tenantId, bookingId, actorId, `payment.${kind}`, { paymentId: payment.id, amountCents, method }]);
  await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, 'payment_record', $4, $5::jsonb)", [tenantId, actorId, `payment.${kind}_recorded`, payment.id, { bookingId: bookingId, amountCents, method }]);
}

export async function recordPayment(formData: FormData): Promise<PaymentState> {
  const kind = String(formData.get("kind") ?? "");
  try {
    if (kind !== "payment" && kind !== "refund") throw new Error("Select a payment action.");
    const expectedBalance = formData.get("expectedBalanceCents");
    const entryId = String(formData.get("entryId") ?? "");
    const bookingId = String(formData.get("bookingId") ?? "");
    const method = String(formData.get("method") ?? "card");
    const amount = Number(String(formData.get("amountDkk") ?? "").replace(",", "."));
    if (!bookingId || !manualPaymentMethods.some((item) => item === method) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > 10_000_000) {
      throw new Error("Enter a valid positive amount and payment method.");
    }
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entryId)) throw new Error("The payment entry could not be identified.");
    const { tenant, db, booking, permissions } = await editableBooking(bookingId, kind === "payment" ? "checkout" : "manager");
    assertNoOperationalFreeText(formData, "notes");
    const identity = await requireIdentity();
    const amountCents = Math.round(amount * 100);
    await db.begin(async (transaction) => {
      if (!permissions.isManager) {
        // Schedule edits take the same block lock before changing providers.
        await transaction.unsafe("SELECT id FROM booking_blocks WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenant.id, booking.bookingBlockId]);
      }
      // Use the ledger trigger's booking lock to serialize simultaneous retries.
      const connection = transaction as unknown as typeof db;
      const [locked] = await connection<{ status: string; stage: string | null }[]>`
        SELECT b.status, b.attendance_stage AS stage FROM bookings b
        WHERE b.tenant_id = ${tenant.id} AND b.id = ${booking.id}
          AND ${appointmentCheckoutAccess(connection, permissions)}
        FOR UPDATE
      `;
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
        if (!permissions.isManager && (locked.status !== "arrived" || locked.stage !== "checking_out" || expectedBalance === null)) {
          throw new Error("Open checkout from the appointment before recording a payment.");
        }
        if (locked.status === "cancelled") throw new Error("Cancelled appointments cannot receive a payment record.");
        const payments = await activeAppointmentPayments(transaction, tenant.id, booking.id);
        if (hasNonGiftCardPayment(payments)) {
          throw new Error("A payment is already recorded. Edit or delete it before recording another.");
        }
        if (expectedBalance !== null || payments.length > 0) {
          const [cart] = await transaction.unsafe<{ balance: string }[]>(`
            SELECT greatest(cart.chargeable_cents - coalesce((
              SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)
              FROM payment_records WHERE tenant_id=$1 AND booking_id=$2
            ), 0), 0)::text AS balance
            FROM appointment_checkout_amounts($1, $2) cart
          `, [tenant.id, booking.id]);
          if (!cart || (expectedBalance !== null && cart.balance !== expectedBalance)) {
            throw new Error("The checkout balance changed. Go back to checkout and review the total.");
          }
          if (amountCents !== Number(cart.balance)) {
            if (payments.length > 0) throw new Error("Record the full balance remaining after the gift-card payment.");
            if (!permissions.isManager) throw new Error("Record the full balance due for this appointment.");
          }
        }
      }
      await insertManualPaymentEntry(transaction, tenant.id, booking.id, kind,
        { entryId, amountCents, method, actorId: identity.id });
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
      if (payment.stripeSandbox) throw new Error("Stripe sandbox payments must be reconciled through Stripe.");

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

export type ManualBookingState = {
  error: string | null;
  success: string | null;
  booking?: { id: string; date: string; locationId: string };
};

type AdditionalServiceInput = { serviceId: string; teamMemberId: string; time: string; segmentId?: string };
type AdditionalServiceBooking = {
  serviceId: string;
  teamMemberId: string;
  startsAt: Date;
  endsAt: Date;
  priceCents: number;
  title: string;
};

function additionalServiceInputs(value: FormDataEntryValue | null, maximum = 5): AdditionalServiceInput[] {
  if (value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 3000) throw new Error("Choose services, providers, and times for this appointment.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Choose services, providers, and times for this appointment."); }
  if (!Array.isArray(parsed) || parsed.length > maximum) throw new Error("An appointment can include up to six services.");
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  for (const item of parsed) {
    if (!item || typeof item !== "object" || typeof item.serviceId !== "string" || typeof item.teamMemberId !== "string"
      || !uuid.test(item.serviceId) || !uuid.test(item.teamMemberId)
      || (item.segmentId !== undefined && (typeof item.segmentId !== "string" || !uuid.test(item.segmentId)))
      || typeof item.time !== "string" || (item.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))) {
      throw new Error("Choose a service, provider, and time for each row.");
    }
  }
  return parsed;
}

async function insertAdditionalBookingService(transaction: TransactionSql, tenantId: string, bookingId: string, locationId: string, position: number, service: AdditionalServiceBooking) {
  try {
    const [reservation] = await transaction.unsafe<{ id: string }[]>(`
      INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING id
    `, [tenantId, service.teamMemberId, locationId, service.startsAt, service.endsAt]);
    await transaction.unsafe(`
      INSERT INTO booking_service_segments (tenant_id, booking_id, booking_block_id, service_id, position, booked_price_cents)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [tenantId, bookingId, reservation.id, service.serviceId, position, service.priceCents]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23P01") {
      throw new Error(`${service.title} was just taken. Choose another time or provider.`);
    }
    throw error;
  }
}

async function linkedServiceGrid(
  tenant: Parameters<typeof staffAvailableSlots>[0],
  db: ReturnType<typeof tenantDb>,
  serviceId: string,
  localDate: string,
  earliest: Date,
  options: { locationId: string; teamMemberId: string; durationMinutes: number; excludeBookingBlockIds?: string[] },
) {
  const dayStart = fromZonedTime(`${localDate}T00:00`, tenant.timezone);
  const [provider] = await staffAvailableSlots(tenant, serviceId, dayStart, new Date(dayStart.getTime() + 48 * 60 * 60_000),
    { ...options, slotInterval: 30 }, db);
  return (provider?.slots ?? []).filter((slot) => {
    const start = new Date(slot.startTime);
    const key = localDateTimeKey(start, tenant.timezone);
    return start >= earliest && key.startsWith(`${localDate}T`)
      && fromZonedTime(key, tenant.timezone).getTime() === start.getTime();
  });
}

export async function getLinkedServiceStartOptions(input: {
  locationId: string; serviceId: string; teamMemberId: string; date: string;
  earliest: string; bookingId?: string; segmentId?: string;
}) {
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const earliest = new Date(input.earliest);
  if (![input.locationId, input.serviceId, input.teamMemberId].every((id) => uuid.test(id))
    || (input.bookingId && !uuid.test(input.bookingId)) || (input.segmentId && !uuid.test(input.segmentId))
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(earliest.getTime())) {
    return { times: [], sequentialAvailable: false };
  }
  const { tenant, permissions } = await calendarPermissionContext();
  assertAppointmentPermission(permissions, input.teamMemberId);
  const db = tenantDb(tenant);
  if (localDateKey(earliest, tenant.timezone) !== input.date) return { times: [], sequentialAvailable: false };
  let excludeBookingBlockIds: string[] = [];
  let retainedDuration: number | undefined;
  if (input.bookingId) {
    const { booking } = await editableBooking(input.bookingId, "manager");
    if (booking.locationId !== input.locationId || localDateKey(booking.startsAt, tenant.timezone) !== input.date
      || !isMovableAppointmentStatus(booking.status)) return { times: [], sequentialAvailable: false };
    excludeBookingBlockIds = (await getAppointmentReservations(db, tenant.id, input.bookingId)).map(({ id }) => id);
    if (input.segmentId) {
      const original = (await getAdditionalAppointmentServices(db, tenant.id, input.bookingId))
        .find((service) => service.id === input.segmentId && service.serviceId === input.serviceId);
      if (original) retainedDuration = (Date.parse(original.endsAt) - Date.parse(original.startsAt)) / 60_000;
    }
  }
  const [service] = await db<{ durationMinutes: number }[]>`
    SELECT duration_minutes AS "durationMinutes" FROM services
    WHERE tenant_id=${tenant.id} AND id=${input.serviceId} AND is_active
  `;
  if (!service) return { times: [], sequentialAvailable: false };
  const durationMinutes = retainedDuration ?? service.durationMinutes;
  const options = { locationId: input.locationId, teamMemberId: input.teamMemberId, durationMinutes, excludeBookingBlockIds };
  const end = new Date(earliest.getTime() + durationMinutes * 60_000);
  const [grid, [provider]] = await Promise.all([
    linkedServiceGrid(tenant, db, input.serviceId, input.date, earliest, options),
    staffAvailableSlots(tenant, input.serviceId, earliest, end, { ...options, slotInterval: 1 }, db),
  ]);
  return {
    times: grid.map((slot) => localDateTimeKey(new Date(slot.startTime), tenant.timezone).slice(11)),
    sequentialAvailable: Boolean(provider?.slots.some((slot) => Date.parse(slot.startTime) === earliest.getTime())),
  };
}

export async function updateAppointmentServices(formData: FormData): Promise<{ error: string | null }> {
  try {
    const bookingId = String(formData.get("bookingId") ?? "");
    const expectedRevision = String(formData.get("revision") ?? "");
    const requested = additionalServiceInputs(formData.get("services"), 6);
    if (!requested.length || requested[0].segmentId || !expectedRevision) throw new Error("Open the appointment and choose its services.");
    const { tenant, db, booking } = await editableBooking(bookingId, "manager");
    const identity = await requireIdentity();
    await withSerializableRetry(() => db.begin(async (transaction) => {
      const connection = transaction as unknown as typeof db;
      const [primaryBlock] = await connection<{ state: string }[]>`
        SELECT state FROM booking_blocks WHERE tenant_id=${tenant.id} AND id=${booking.bookingBlockId} FOR UPDATE
      `;
      const [current] = await connection<{ serviceId: string; priceCents: number; teamMemberId: string | null; startsAt: Date; endsAt: Date; revision: string; status: string }[]>`
        SELECT b.service_id AS "serviceId", b.booked_price_cents AS "priceCents", b.team_member_id AS "teamMemberId",
          b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.updated_at::text AS revision, b.status
        FROM bookings b WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId} FOR UPDATE
      `;
      if (!current || primaryBlock?.state !== "confirmed" || !isMovableAppointmentStatus(current.status)) {
        throw new Error("This appointment is no longer open for service changes.");
      }
      if (current.revision !== expectedRevision) throw new Error("This appointment has changed. Reopen it before editing services.");
      // Read committed gives the settlement check a fresh snapshot after the
      // lock shared with payment and package redemption writers.
      const [financial] = await connection<{ settled: boolean }[]>`
        SELECT ${appointmentHasSettlement(connection)} AS settled FROM bookings b WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId}
      `;
      if (financial?.settled) throw new Error("Services can only be edited before recording a payment or redeeming a package.");

      const existing = await connection<{ id: string; blockId: string; serviceId: string; priceCents: number; teamMemberId: string | null; startsAt: Date; endsAt: Date }[]>`
        SELECT seg.id, block.id AS "blockId", seg.service_id AS "serviceId", seg.booked_price_cents AS "priceCents",
          block.team_member_id AS "teamMemberId", block.starts_at AS "startsAt", block.ends_at AS "endsAt"
        FROM booking_service_segments seg
        JOIN booking_blocks block ON block.tenant_id=seg.tenant_id AND block.id=seg.booking_block_id
        WHERE seg.tenant_id=${tenant.id} AND seg.booking_id=${bookingId}
        ORDER BY seg.position
      `;
      const localDate = localDateKey(current.startsAt, tenant.timezone);
      const excludedBlocks = [booking.bookingBlockId, ...existing.map((item) => item.blockId)];
      const plan: (AdditionalServiceBooking & { original?: typeof existing[number]; changed: boolean })[] = [];
      let priorIndex = -1;
      let previousEnd = current.startsAt;
      for (const [index, item] of requested.entries()) {
        const originalIndex = item.segmentId ? existing.findIndex((row) => row.id === item.segmentId) : -1;
        if (item.segmentId && originalIndex <= priorIndex) throw new Error("The service list has changed. Reopen the appointment.");
        priorIndex = index === 0 ? -1 : item.segmentId ? originalIndex : existing.length;
        const original = existing[originalIndex];
        const previous = index === 0 ? current : original;
        const startsAt = index === 0 ? current.startsAt : item.time ? fromZonedTime(`${localDate}T${item.time}`, tenant.timezone) : previousEnd;
        const [catalog] = await connection<{ title: string; priceCents: number; durationMinutes: number; active: boolean }[]>`
          SELECT title, price_cents AS "priceCents", duration_minutes AS "durationMinutes", is_active AS active
          FROM services WHERE tenant_id=${tenant.id} AND id=${item.serviceId}
        `;
        if (!catalog) throw new Error(`Service ${index + 1} is unavailable.`);
        const sameService = previous?.serviceId === item.serviceId;
        const duration = sameService ? previous.endsAt.getTime() - previous.startsAt.getTime() : catalog.durationMinutes * 60_000;
        const endsAt = new Date(startsAt.getTime() + duration);
        const changed = !sameService || item.teamMemberId !== previous.teamMemberId || startsAt.getTime() !== previous.startsAt.getTime();
        if (!Number.isFinite(startsAt.getTime()) || startsAt < previousEnd || localDateKey(startsAt, tenant.timezone) !== localDate
          || (index > 0 && item.time && localDateTimeKey(startsAt, tenant.timezone) !== `${localDate}T${item.time}`)) {
          throw new Error(`${catalog.title} must start on the appointment date, after the preceding service.`);
        }
        if (changed) {
          if (!catalog.active) throw new Error(`${catalog.title} is no longer available.`);
          const options = {
            locationId: booking.locationId, teamMemberId: item.teamMemberId,
            durationMinutes: duration / 60_000, excludeBookingBlockIds: excludedBlocks,
          };
          const requiresGrid = index > 0 && item.time && startsAt.getTime() !== previousEnd.getTime()
            && startsAt.getTime() !== original?.startsAt.getTime();
          const slots = requiresGrid
            ? await linkedServiceGrid(tenant, connection, item.serviceId, localDate, previousEnd, options)
            : (await staffAvailableSlots(tenant, item.serviceId, startsAt, endsAt, { ...options, slotInterval: 1 }, connection))[0]?.slots ?? [];
          if (!slots.some((slot) => Date.parse(slot.startTime) === startsAt.getTime() && Date.parse(slot.endTime) === endsAt.getTime())) {
            throw new Error(`${catalog.title} is unavailable with that provider at ${localDateTimeKey(startsAt, tenant.timezone).slice(11)}. Choose another provider or time.`);
          }
        }
        plan.push({ ...item, original, startsAt, endsAt, changed, title: catalog.title, priceCents: sameService ? previous.priceCents : catalog.priceCents });
        previousEnd = endsAt;
      }
      const [first, ...additional] = plan;
      const kept = new Set(additional.flatMap((item) => item.original ? [item.original.id] : []));
      const removed = existing.filter((item) => !kept.has(item.id)).map((item) => item.id);
      if (removed.length) await connection`DELETE FROM booking_service_segments WHERE tenant_id=${tenant.id} AND booking_id=${bookingId} AND id=ANY(${removed}::uuid[])`;
      const changedBlocks = [
        ...(first.changed ? [booking.bookingBlockId] : []),
        ...additional.flatMap((item) => item.changed && item.original ? [item.original.blockId] : []),
      ];
      if (changedBlocks.length) await connection`
        UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenant.id} AND id=ANY(${changedBlocks}::uuid[])
      `;
      if (first.changed) {
        await connection`UPDATE booking_blocks SET team_member_id=${first.teamMemberId}, ends_at=${first.endsAt}, state='confirmed'
          WHERE tenant_id=${tenant.id} AND id=${booking.bookingBlockId}`;
        await connection`UPDATE bookings SET service_id=${first.serviceId}, team_member_id=${first.teamMemberId},
          booked_price_cents=${first.priceCents}, ends_at=${first.endsAt}, updated_at=now()
          WHERE tenant_id=${tenant.id} AND id=${bookingId}`;
      } else {
        await connection`UPDATE bookings SET updated_at=now() WHERE tenant_id=${tenant.id} AND id=${bookingId}`;
      }
      for (const [index, item] of additional.entries()) {
        if (!item.original) {
          await insertAdditionalBookingService(transaction, tenant.id, bookingId, booking.locationId, index + 2, item);
          continue;
        }
        if (item.changed) await connection`UPDATE booking_blocks SET team_member_id=${item.teamMemberId},
          starts_at=${item.startsAt}, ends_at=${item.endsAt}, state='confirmed'
          WHERE tenant_id=${tenant.id} AND id=${item.original.blockId}`;
        await connection`UPDATE booking_service_segments SET position=${index + 2},
          service_id=${item.serviceId}, booked_price_cents=${item.priceCents}
          WHERE tenant_id=${tenant.id} AND booking_id=${bookingId} AND id=${item.original.id}`;
      }
      const line = ({ serviceId, teamMemberId, startsAt, endsAt, priceCents }: Pick<AdditionalServiceBooking, "serviceId" | "startsAt" | "endsAt" | "priceCents"> & { teamMemberId: string | null }) =>
        ({ serviceId, teamMemberId, startsAt, endsAt, priceCents });
      const metadata = JSON.stringify({ before: [current, ...existing].map(line), after: plan.map(line) });
      await connection`INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata)
        VALUES (${tenant.id}, ${bookingId}, ${identity.id}, 'booking.services_updated', ${metadata}::text::jsonb)`;
      await connection`INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
        VALUES (${tenant.id}, ${identity.id}, 'booking.services_updated', 'booking', ${bookingId}, ${metadata}::text::jsonb)`;
    }));
    revalidateCalendars();
    return { error: null };
  } catch (error) {
    if (error instanceof BookingConflictError) return { error: "A service time was just taken. Review the service times and try again." };
    return { error: error instanceof Error && !("severity" in error) ? error.message : "Could not save the services. Please try again." };
  }
}

/** Creates a staff-entered appointment after the same availability and exclusion checks as public booking. */
async function createManualBookingRecord(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  const teamMemberId = String(formData.get("teamMemberId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const localDate = String(formData.get("appointmentDate") ?? "");
  const localTime = String(formData.get("appointmentTime") ?? "");
  const waitlistEntryId = String(formData.get("waitlistEntryId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const additionalServices = additionalServiceInputs(formData.get("additionalServices"));
  const name = String(formData.get("customerName") ?? "").trim();
  const email = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  const phone = String(formData.get("customerPhone") ?? "").trim() || null;
  if (!locationId || !teamMemberId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{2}:\d{2}$/.test(localTime) || (!waitlistEntryId && !customerId && (!name || !email.includes("@")))) {
    throw new Error("Choose a location, staff member, service, local appointment time, and valid client details.");
  }
  if (!waitlistEntryId && !customerId && !phone) throw new Error("Enter a phone number for the new client.");
  const { tenant, permissions } = await calendarPermissionContext();
  assertAppointmentPermission(permissions, teamMemberId);
  for (const extra of additionalServices) assertAppointmentPermission(permissions, extra.teamMemberId);
  if (customerId && (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(customerId)
    || !(permissions.isManager || permissions.canViewClients || permissions.canManageClients))) {
    throw new Error("You cannot select that client.");
  }
  if (waitlistEntryId && (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(waitlistEntryId)
    || !(permissions.isManager || permissions.canManageWaitlist))) {
    throw new Error("You cannot book that waitlist entry.");
  }
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
  const candidates = await staffAvailableSlots(tenant, service.id, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000), { locationId, slotInterval: 30 });
  const availableSlot = candidates.find((candidate) => candidate.teamMemberId === teamMemberId)?.slots.find((slot) => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime());
  if (!availableSlot) throw new Error("That staff member is not available at the selected time.");
  const linked: AdditionalServiceBooking[] = [];
  let previousEnd = endsAt;
  for (const [index, extra] of additionalServices.entries()) {
    const [item] = await db<{ title: string; priceCents: number; durationMinutes: number }[]>`
      SELECT title, price_cents AS "priceCents", duration_minutes AS "durationMinutes"
      FROM services WHERE tenant_id = ${tenant.id} AND id = ${extra.serviceId} AND is_active
    `;
    if (!item) throw new Error(`Service ${index + 2} is no longer available.`);
    const nextStart = extra.time ? fromZonedTime(`${localDate}T${extra.time}`, tenant.timezone) : previousEnd;
    const nextEnd = new Date(nextStart.getTime() + item.durationMinutes * 60_000);
    if (localDateKey(nextStart, tenant.timezone) !== localDate || nextStart < previousEnd
      || (extra.time && localDateTimeKey(nextStart, tenant.timezone) !== `${localDate}T${extra.time}`)) {
      throw new Error(`${item.title} must start on the appointment date, after the preceding service.`);
    }
    const options = { locationId, teamMemberId: extra.teamMemberId, durationMinutes: item.durationMinutes };
    const slots = extra.time && nextStart.getTime() !== previousEnd.getTime()
      ? await linkedServiceGrid(tenant, db, extra.serviceId, localDate, previousEnd, options)
      : (await staffAvailableSlots(tenant, extra.serviceId, nextStart, nextEnd, { ...options, slotInterval: 1 }, db))[0]?.slots ?? [];
    if (!slots.some((slot) => Date.parse(slot.startTime) === nextStart.getTime() && Date.parse(slot.endTime) === nextEnd.getTime())) {
      throw new Error(`${item.title} is unavailable with that provider at ${localDateTimeKey(nextStart, tenant.timezone).slice(11)}. Choose another time or provider.`);
    }
    linked.push({ ...extra, startsAt: nextStart, endsAt: nextEnd, priceCents: item.priceCents, title: item.title });
    previousEnd = nextEnd;
  }
  const identity = await requireIdentity();
  let bookingId: string;
  try {
    bookingId = await withSerializableRetry(async () => db.begin(async (transaction) => {
      const [waitlistCustomer] = waitlistEntryId ? await transaction.unsafe<{ id: string }[]>(`
        UPDATE waitlist_entries SET status='booked', updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND service_id=$3 AND location_id=$4
          AND status IN ('waiting','offered')
        RETURNING customer_id AS id
      `, [tenant.id, waitlistEntryId, service.id, locationId]) : [];
      if (waitlistEntryId && !waitlistCustomer) throw new Error("This waitlist entry is unavailable or its service or location has changed.");
      const [customer] = waitlistCustomer ? [waitlistCustomer] : customerId
        ? await transaction.unsafe<{ id: string }[]>("SELECT id FROM customers WHERE tenant_id=$1 AND id=$2::uuid FOR KEY SHARE", [tenant.id, customerId])
        : await transaction.unsafe<{ id: string }[]>(`
        INSERT INTO customers (tenant_id, name, email, phone)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
        RETURNING id
      `, [tenant.id, name, email, phone]);
      if (!customer) throw new Error("That client is unavailable. Select another client.");
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
      for (const [index, extra] of linked.entries()) {
        await insertAdditionalBookingService(transaction, tenant.id, booking.id, locationId, index + 2, extra);
      }
      if (waitlistEntryId) await transaction.unsafe(
        "INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'waitlist.booked', 'waitlist_entry', $3, $4::jsonb)",
        [tenant.id, identity.id, waitlistEntryId, JSON.stringify({ status: "booked", bookingId: booking.id })],
      );
      await transaction.unsafe("INSERT INTO booking_events (tenant_id, booking_id, actor_identity_id, event_type, metadata) VALUES ($1, $2, $3, 'booking.created_by_tenant', $4::jsonb)", [tenant.id, booking.id, identity.id, JSON.stringify({ source: "tenant" })]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'booking.created_by_tenant', 'booking', $3, $4::jsonb)", [tenant.id, identity.id, booking.id, JSON.stringify({ source: "tenant" })]);
      return booking.id;
    }));
  } catch (error) {
    if (error instanceof BookingConflictError) throw new Error("That time was just taken. Choose another time.");
    throw error;
  }
  revalidateCalendars();
  if (waitlistEntryId) revalidatePath("/app/waitlist");
  return { id: bookingId, date: localDate, locationId };
}

/** Expected validation and availability failures stay inside the calendar form rather than becoming a page error. */
export async function createManualBooking(_previousState: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  try {
    const booking = await createManualBookingRecord(formData);
    return { error: null, success: "Appointment confirmed and added to the calendar.", booking };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not confirm this appointment.", success: null };
  }
}
