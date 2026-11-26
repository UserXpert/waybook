import { calendarBookingVisibility } from "@/lib/waybook/appointment-service-segments";
import { notFound } from "next/navigation";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import type { CSSProperties } from "react";
import { fromZonedTime } from "date-fns-tz";
import { CalendarSelectors } from "@/components/calendar-selectors";
import { CalendarDatePicker } from "@/components/calendar-date-picker";
import { CalendarActiveFilters } from "@/components/calendar-active-filters";
import { CalendarFilterDismiss } from "@/components/calendar-filter-panel";
import { CalendarRosterControls } from "@/components/calendar-roster-controls";
import { CalendarBookingDragDrop } from "@/components/calendar-booking-drag-drop";
import { CalendarAppointmentDrawer } from "@/components/calendar-appointment-drawer";
import { ManualAppointmentForm } from "@/components/manual-appointment-form";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { staffAvailableSlots, isSlotWithinLocationHours } from "@/lib/waybook/booking";
import { isPastCalendarSlot } from "@/lib/waybook/calendar-slot-time";
import { calendarGridBounds } from "@/lib/waybook/calendar-grid-bounds";
import { calculateStaffSlots, type ScheduleOverride, type ScheduleRule } from "@/lib/waybook/availability";
import { tenantDb } from "@/lib/waybook/database";
import {
  currentTenantRouteSlug,
  requireTenantWorkspace,
} from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { isFeatureEnabled, requirePageFeature } from "@/lib/waybook/features";
import { canManageAppointment, staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { appointmentStageLabels, isMovableAppointmentStatus, type AppointmentAttendanceStage } from "@/lib/waybook/appointment-lifecycle";
import { getCalendarAppointment } from "./actions";

type Member = {
  id: string;
  name: string;
  email: string;
  calendarColor: string;
};
type Service = { id: string; title: string; durationMinutes: number; priceCents: number };
type Location = { id: string; name: string };
type ManualAssignment = {
  locationId: string;
  teamMemberId: string;
  serviceId: string;
};
type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};
type Booking = {
  id: string;
  bookingBlockId: string;
  bookingNumber: string;
  serviceId: string;
  teamMemberId: string | null;
  locationId: string | null;
  resourceId: string | null;
  resourceName: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  attendanceStage: AppointmentAttendanceStage | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  serviceTitle: string;
  hasLinkedServices?: boolean;
};
type TeamBooking = Booking & {
  teamMemberName: string;
  teamMemberColor: string;
};
type Slot = { startTime: string; endTime: string };
type ScheduleEntry = { startTime: string; endTime: string };

function CalendarBookingService({ service, resource }: { service: string; resource: string | null }) {
  return (
    <span className="waybook-calendar-entry__details">
      <span className="waybook-calendar-entry__service">{service}</span>
      {resource ? (
        <Wrench
          className="waybook-calendar-entry__resource"
          size={12}
          role="img"
          aria-label={`Resource: ${resource}`}
        >
          <title>{`Resource: ${resource}`}</title>
        </Wrench>
      ) : null}
    </span>
  );
}
type LocationHours = { dayOfWeek: number; startTime: string; endTime: string };

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

/** Calendar day navigation follows the location's configured working days.
 * A direct URL may still show a closed day for historical review, but toolbar
 * navigation never strands reception on an empty schedule. */
function nextWorkingDay(dateKey: string, direction: -1 | 1, workingDays: Set<number>) {
  if (workingDays.size === 0) return addDays(dateKey, direction);
  for (let distance = 1; distance <= 7; distance += 1) {
    const candidate = addDays(dateKey, distance * direction);
    if (workingDays.has(dayOfWeek(candidate))) return candidate;
  }
  return addDays(dateKey, direction);
}

function weekStartFor(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return addDays(dateKey, -((date.getUTCDay() + 6) % 7));
}

function monthStartFor(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${monthStartFor(dateKey)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function localMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value ?? "0");
  return value("hour") * 60 + value("minute");
}

function localDateTimeKey(date: Date, timezone: string) {
  const minutes = localMinutes(date, timezone);
  return `${localDateKey(date, timezone)}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function overlapsScheduledAppointment(
  bookings: readonly Pick<Booking, "startsAt" | "endsAt">[],
  date: string,
  time: string,
  durationMinutes: number,
  timezone: string,
) {
  const candidateStart = fromZonedTime(`${date}T${time}:00`, timezone);
  const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60_000);

  return bookings.some(
    (booking) =>
      candidateStart.getTime() < booking.endsAt.getTime() &&
      candidateEnd.getTime() > booking.startsAt.getTime(),
  );
}

/** A half-hour grid cell represents an appointment start, not occupied time.
 * When its full service interval overlaps an existing appointment, preserve
 * that protection but present it neutrally rather than as a phantom buffer. */
function overlapsAnyScheduledAppointment(
  bookings: readonly Pick<Booking, "startsAt" | "endsAt">[],
  date: string,
  time: string,
  durations: readonly number[],
  timezone: string,
) {
  return durations.some((durationMinutes) =>
    overlapsScheduledAppointment(bookings, date, time, durationMinutes, timezone),
  );
}

function mergeSlots(slots: Slot[]): ScheduleEntry[] {
  const uniqueSlots = Array.from(
    new Map(slots.map((slot) => [`${slot.startTime}|${slot.endTime}`, slot])).values(),
  );
  return uniqueSlots
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .reduce<ScheduleEntry[]>((ranges, slot) => {
      const previous = ranges.at(-1);
      if (
        previous &&
        new Date(previous.endTime).getTime() ===
          new Date(slot.startTime).getTime()
      )
        previous.endTime = slot.endTime;
      else ranges.push({ ...slot });
      return ranges;
    }, []);
}

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{
    location?: string;
    employee?: string;
    service?: string;
    week?: string;
    day?: string;
    view?: string;
    booking?: string;
    create?: string;
    customer?: string;
    waitlist?: string;
    staff?: string;
    after?: string;
    before?: string;
    createStaff?: string;
    showOffShift?: string;
    monthDay?: string;
  }>;
}) {
  const {
    location,
    employee,
    service,
    week,
    day,
    view,
    booking: bookingId,
    create,
    customer: customerId,
    waitlist: waitlistEntryId,
    staff: staffFilter,
    after,
    before,
    createStaff,
    showOffShift,
  } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const terms = await getTenantTerminology(tenant);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  await requirePageFeature(tenant.id, "calendars");
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager;
  const showResources = (canManage || permissions.canManageResources) && await isFeatureEnabled(tenant.id, "resources");
  const canManageSchedule = (memberId: string | null) => canManageAppointment(permissions, memberId);
  const canViewTeam = permissions.isManager || permissions.canViewTeamCalendar;
  if (!canViewTeam && !permissions.teamMemberId) {
    notFound();
  }
  const effectiveEmployee = canViewTeam ? employee : permissions.teamMemberId;
  const restrictedEmployeeId = permissions.teamMemberId ?? "";
  const db = tenantDb(tenant);
  const visibleBooking = calendarBookingVisibility(db, canViewTeam, permissions.teamMemberId);
  const requestedLocationId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(location ?? "") ? location! : null;
  const requestedLocation = requestedLocationId
    ? (await db<Location[]>`SELECT id,name FROM locations WHERE tenant_id=${tenant.id} AND id=${requestedLocationId} AND is_active=TRUE LIMIT 1`)[0]
    : undefined;
  const bookingLocation = !requestedLocation && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId ?? "")
    ? (await db<Location[]>`SELECT l.id,l.name FROM bookings b JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId!} AND l.is_active=TRUE AND ${visibleBooking} LIMIT 1`)[0]
    : undefined;
  const requestedDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : localDateKey(new Date(), tenant.timezone);
  const selectedLocation = requestedLocation
    ?? bookingLocation
    ?? (await db<Location[]>`SELECT l.id,l.name FROM locations l WHERE l.tenant_id=${tenant.id} AND l.is_active=TRUE ORDER BY CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.tenant_id=l.tenant_id AND b.location_id=l.id AND b.status <> 'cancelled' AND b.starts_at >= (${requestedDay}::date::timestamp AT TIME ZONE ${tenant.timezone}) AND b.starts_at < ((${requestedDay}::date + 1)::timestamp AT TIME ZONE ${tenant.timezone}) AND ${visibleBooking}) THEN 0 ELSE 1 END, CASE WHEN l.slug='primary' THEN 0 ELSE 1 END,l.name LIMIT 1`)[0];
  const locationHours = selectedLocation
    ? await db<LocationHours[]>`SELECT day_of_week AS "dayOfWeek",start_time AS "startTime",end_time AS "endTime" FROM location_hours WHERE tenant_id = ${tenant.id} AND location_id = ${selectedLocation.id} ORDER BY day_of_week`
    : [] as LocationHours[];
  const locationWorkingDays = locationHours;
  const staffSearch = (staffFilter ?? "").trim().slice(0, 100);
  const isMemberId = (value: string | undefined) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value ?? "");
  const staffAfter = isMemberId(after) ? after! : null;
  const staffBefore = !staffAfter && isMemberId(before) ? before! : null;
  // Keep the operational board bounded to the visible roster window. This
  // avoids serialising an entire large location into the browser while still
  // making every staff member reachable through stable keyset navigation.
  const rosterWindowSize = 20;
  const memberRows = selectedLocation
    ? await db.unsafe<Member[]>(
      `SELECT tm.id,tm.name,tm.email,tm.calendar_color AS "calendarColor"
       FROM team_members tm
       JOIN team_member_locations tml ON tml.team_member_id=tm.id AND tml.tenant_id=tm.tenant_id
       WHERE tm.tenant_id=$1 AND tm.is_active=TRUE AND tml.location_id=$2
         AND ($3::boolean OR tm.id=$4::uuid)
         AND ($5='' OR tm.name ILIKE $6 OR tm.email ILIKE $6)
         AND ($7::uuid IS NULL OR (tm.name,tm.id) > (coalesce((SELECT name FROM team_members WHERE tenant_id=$1 AND id=$7::uuid),''),$7::uuid))
         AND ($8::uuid IS NULL OR (tm.name,tm.id) < (coalesce((SELECT name FROM team_members WHERE tenant_id=$1 AND id=$8::uuid),''),$8::uuid))
       ORDER BY tm.name ${staffBefore ? "DESC" : "ASC"},tm.id ${staffBefore ? "DESC" : "ASC"}
       LIMIT ${rosterWindowSize + 1}`,
      [tenant.id, selectedLocation.id, canViewTeam, restrictedEmployeeId || null, staffSearch, `%${staffSearch}%`, staffAfter, staffBefore],
    )
    : [];
  const hasMoreMembers = memberRows.length > rosterWindowSize;
  const members = (staffBefore ? memberRows.slice(0, rosterWindowSize).reverse() : memberRows.slice(0, rosterWindowSize));
  const selectedFromWindow = members.find((member) => member.id === effectiveEmployee);
  const selected = selectedFromWindow ?? (effectiveEmployee && selectedLocation
    ? (await db<Member[]>`SELECT tm.id,tm.name,tm.email,tm.calendar_color AS "calendarColor" FROM team_members tm JOIN team_member_locations tml ON tml.team_member_id=tm.id AND tml.tenant_id=tm.tenant_id WHERE tm.tenant_id=${tenant.id} AND tm.id=${effectiveEmployee} AND tm.is_active=TRUE AND tml.location_id=${selectedLocation.id} LIMIT 1`)[0]
    : undefined) ?? members[0];
  const selectedStaffBookingColor = selected?.calendarColor ?? "#67c7cf";
  const canManageSelectedSchedule = Boolean(selected && canManageSchedule(selected.id));
  const canViewClientDirectory = canManage || permissions.canViewClients || permissions.canManageClients;
  const [directCustomer] = customerId && isMemberId(customerId) && canViewClientDirectory
    ? await db<
        Customer[]
      >`SELECT id, name, email, phone FROM customers WHERE tenant_id = ${tenant.id} AND id = ${customerId} LIMIT 1`
    : [];
  const [waitlistCustomer] = !directCustomer && waitlistEntryId && isMemberId(waitlistEntryId) && service && isMemberId(service)
    && selectedLocation && canManageSelectedSchedule && (canManage || permissions.canManageWaitlist)
    ? await db<Customer[]>`
      SELECT c.id,c.name,c.email,CASE WHEN ${canViewClientDirectory} THEN c.phone END AS phone
      FROM waitlist_entries w
      JOIN customers c ON c.tenant_id=w.tenant_id AND c.id=w.customer_id
      WHERE w.tenant_id=${tenant.id} AND w.id=${waitlistEntryId} AND w.status IN ('waiting','offered')
        AND w.location_id=${selectedLocation.id} AND w.service_id=${service}
    `
    : [];
  const selectedCustomer = directCustomer ?? waitlistCustomer;
  const calendarNow = new Date();
  const tenantToday = localDateKey(calendarNow, tenant.timezone);
  // A selected staff member can sit outside the bounded roster window. The
  // direct lookup above is authoritative for their own calendar scope.
  const hasSelectedEmployee = Boolean(
    effectiveEmployee && selected?.id === effectiveEmployee,
  );
  // All-staff uses the operational Day board. A selected staff member uses
  // their Week board; there is intentionally no single-staff Day board.
  const monthlyView = view === "month";
  const teamView = !monthlyView && !hasSelectedEmployee;
  const calendarDatePickerScope = {
    location: selectedLocation?.id,
    employee: hasSelectedEmployee ? selected?.id : undefined,
    service: service || undefined,
    staff: staffSearch || undefined,
    after: staffAfter ?? undefined,
    before: staffBefore ?? undefined,
    showOffShift: showOffShift === "0" ? "0" : undefined,
  };
  const calendarView = monthlyView ? "month" : teamView ? "team" : "staff";
  const teamDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : tenantToday;
  // A team-day deep link can carry a day without a week. Query the week that
  // contains that day so the grid and booking data can never drift apart.
  const currentWeek = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "")
    ? weekStartFor(week!)
    : weekStartFor(teamView ? teamDay : (/^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : tenantToday));
  const currentMonth = monthStartFor(
    /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : tenantToday,
  );
  const days = Array.from({ length: 7 }, (_, index) =>
    addDays(currentWeek, index),
  );
  const isHistoricalTeamDay = teamDay < tenantToday;
  const hasCurrentOrFutureWeekDay = days.some((date) => date >= tenantToday);
  // Navigation must follow the week actually rendered by the grid. Keeping
  // these derived from `days[0]` prevents a stale query value from skipping or
  // repeating a week after a client-side calendar transition.
  const visibleWeekStart = days[0];
  const requestedAppointment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(
    create ?? "",
  )
    ? create!
    : null;
  // The operational Day board asks only for its selected local day. The
  // individual planning surface deliberately keeps its week-sized range.
  const visibleRangeStart = monthlyView ? currentMonth : teamView ? teamDay : currentWeek;
  const visibleRangeEnd = monthlyView ? addMonths(currentMonth, 1) : addDays(visibleRangeStart, teamView ? 1 : 7);
  const rangeStart = fromZonedTime(`${visibleRangeStart}T00:00:00`, tenant.timezone);
  const rangeEnd = fromZonedTime(`${visibleRangeEnd}T00:00:00`, tenant.timezone);
  const calendarReservations = db`
    SELECT b.id, b.booking_number AS "bookingNumber", reservation.block_id AS "bookingBlockId",
      reservation.service_id AS "serviceId", reservation.member_id AS "teamMemberId", b.location_id AS "locationId",
      bra.resource_id AS "resourceId", r.name AS "resourceName", reservation.starts_at AS "startsAt",
      reservation.ends_at AS "endsAt", b.status, b.attendance_stage AS "attendanceStage", c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone",
      s.title AS "serviceTitle", tm.name AS "teamMemberName", tm.calendar_color AS "teamMemberColor",
      EXISTS (SELECT 1 FROM booking_service_segments seg WHERE seg.tenant_id = b.tenant_id AND seg.booking_id = b.id) AS "hasLinkedServices"
    FROM bookings b
    CROSS JOIN LATERAL (
      SELECT b.booking_block_id AS block_id, b.service_id, b.team_member_id AS member_id, b.starts_at, b.ends_at, false AS is_additional
      UNION ALL
      SELECT block.id, seg.service_id, block.team_member_id, block.starts_at, block.ends_at, true
      FROM booking_service_segments seg
      JOIN booking_blocks block ON block.tenant_id = seg.tenant_id AND block.id = seg.booking_block_id
      WHERE seg.tenant_id = b.tenant_id AND seg.booking_id = b.id
    ) reservation
    JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
    JOIN services s ON s.id = reservation.service_id AND s.tenant_id = b.tenant_id
    JOIN team_members tm ON tm.id = reservation.member_id AND tm.tenant_id = b.tenant_id
    LEFT JOIN booking_resource_assignments bra ON NOT reservation.is_additional AND bra.booking_id = b.id
      AND bra.tenant_id = b.tenant_id AND bra.released_at IS NULL
    LEFT JOIN resources r ON r.id = bra.resource_id AND r.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${tenant.id} AND b.location_id = ${selectedLocation?.id ?? null}
      AND (${canViewTeam} OR reservation.member_id = ${permissions.teamMemberId}::uuid)
      AND reservation.starts_at >= ${rangeStart} AND reservation.starts_at < ${rangeEnd} AND b.status <> 'cancelled'
  `;
  const [services, calendarServices, bookings, teamBookings] =
    selected && selectedLocation
      ? await Promise.all([
          db<
            Service[]
          >`SELECT s.id, s.title, s.duration_minutes AS "durationMinutes", s.price_cents AS "priceCents" FROM services s JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenant.id} AND stm.team_member_id = ${selected.id} AND sl.location_id = ${selectedLocation.id} AND s.is_active = TRUE ORDER BY s.title`,
          db<
            Service[]
          >`SELECT DISTINCT s.id, s.title, s.duration_minutes AS "durationMinutes" FROM services s JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id JOIN team_member_locations tml ON tml.tenant_id = stm.tenant_id AND tml.team_member_id = stm.team_member_id JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenant.id} AND s.is_active = TRUE AND stm.team_member_id = ANY(${members.map((member) => member.id)}) AND tml.location_id = ${selectedLocation.id} AND sl.location_id = ${selectedLocation.id} ORDER BY s.title`,
          db<
            Booking[]
          >`${calendarReservations} AND reservation.member_id = ${selected.id} ORDER BY reservation.starts_at LIMIT 100`,
          db<
            TeamBooking[]
          >`${calendarReservations} AND reservation.member_id = ANY(${members.map((member) => member.id)}) ORDER BY reservation.starts_at LIMIT 300`,
        ])
      : ([[], [], [], []] as [
          Service[],
          Service[],
          Booking[],
          TeamBooking[],
        ]);
  const initialDetail = bookingId && isMemberId(bookingId) ? await getCalendarAppointment(bookingId) : null;
  // Month totals must not inherit the bounded staff roster used by the day
  // board. Query the selected location directly so every permitted staff
  // member and booking in the visible month contributes to the count.
  const monthScopedBookings = monthlyView && selectedLocation
    ? await db<TeamBooking[]>`
      ${calendarReservations}
      AND EXISTS (SELECT 1 FROM team_member_locations tml
        WHERE tml.tenant_id = tm.tenant_id AND tml.team_member_id = tm.id AND tml.location_id = ${selectedLocation.id})
      AND (${!hasSelectedEmployee} OR reservation.member_id = ${selected?.id ?? null}::uuid)
      AND (${staffSearch} = '' OR tm.name ILIKE ${`%${staffSearch}%`} OR tm.email ILIKE ${`%${staffSearch}%`})
      ORDER BY reservation.starts_at, b.id, reservation.block_id
    `
    : [];
  const monthCalendarServices = monthlyView && selectedLocation
    ? await db<Service[]>`
      SELECT DISTINCT s.id, s.title, s.duration_minutes AS "durationMinutes"
      FROM services s
      JOIN service_locations sl ON sl.service_id=s.id AND sl.tenant_id=s.tenant_id AND sl.location_id=${selectedLocation.id}
      JOIN service_team_members stm ON stm.service_id=s.id AND stm.tenant_id=s.tenant_id
      JOIN team_member_locations tml ON tml.team_member_id=stm.team_member_id AND tml.tenant_id=stm.tenant_id AND tml.location_id=${selectedLocation.id}
      WHERE s.tenant_id=${tenant.id} AND s.is_active=TRUE
        AND (${canViewTeam} OR stm.team_member_id=${restrictedEmployeeId || null}::uuid)
        AND (${!hasSelectedEmployee} OR stm.team_member_id=${selected?.id ?? null}::uuid)
      ORDER BY s.title
    `
    : calendarServices;
  const selectableServices = monthlyView ? monthCalendarServices : teamView ? calendarServices : services;
  const selectedService = service
    ? selectableServices.find((item) => item.id === service)
    : undefined;
  // "All services" is an availability union. Each actionable calendar cell
  // carries the compatible service into the create drawer below.
  const availabilityServices = monthlyView ? [] : selectedService
    ? [selectedService]
    : teamView
    ? calendarServices
      : services;
  const visibleServiceDurations = Array.from(
    new Set(availabilityServices.map((item) => item.durationMinutes)),
  );
  const availabilityByService = selectedLocation
    ? await Promise.all(
        availabilityServices.map(async (item) => ({
          serviceId: item.id,
          candidates: await staffAvailableSlots(
            tenant,
            item.id,
            new Date(rangeStart.getTime() - 86_400_000),
            new Date(rangeEnd.getTime() + 86_400_000),
            { locationId: selectedLocation.id, slotInterval: 30 },
          ),
        })),
      )
    : [];
  const availability = availabilityByService.flatMap((item) => item.candidates);
  // Render availability with the page, rather than decorating every calendar
  // cell after hydration. The old client-side map only contained the team day,
  // which incorrectly disabled valid cells in a staff week.
  const bookableSlotKeys = new Set(availability.flatMap((item) =>
    item.slots
      .filter(
        (slot) =>
          teamView
            ? localDateKey(new Date(slot.startTime), tenant.timezone) === teamDay
            : days.includes(localDateKey(new Date(slot.startTime), tenant.timezone)),
      )
      .map(
        (slot) =>
          `${item.teamMemberId}|${localDateTimeKey(new Date(slot.startTime), tenant.timezone)}`,
      ),
  ));
  // The staff-week header uses the same server-computed candidates as its
  // cells. This makes a day with no remaining capacity explicit instead of
  // relying on a user to infer it from the hatch treatment alone.
  const selectedBookableDays = new Set(
    Array.from(bookableSlotKeys).flatMap((key) => {
      const [memberId, startsAt] = key.split("|");
      return memberId === selected?.id ? [startsAt.slice(0, 10)] : [];
    }),
  );
  // “All services” is a union in the calendar, but a booking has exactly one
  // service. Preserve every compatible service on each actionable cell: the
  // first is used by a new appointment, while drag/drop uses the complete
  // set to avoid presenting a target that cannot take the dragged service.
  const serviceForBookableSlot = new Map<string, string>();
  const servicesForBookableSlot = new Map<string, Set<string>>();
  for (const { serviceId, candidates } of availabilityByService) {
    for (const candidate of candidates) {
      for (const slot of candidate.slots) {
        const date = localDateKey(new Date(slot.startTime), tenant.timezone);
        if ((teamView ? date === teamDay : days.includes(date))) {
          const key = `${candidate.teamMemberId}|${localDateTimeKey(new Date(slot.startTime), tenant.timezone)}`;
          if (!serviceForBookableSlot.has(key)) serviceForBookableSlot.set(key, serviceId);
          const compatibleServices = servicesForBookableSlot.get(key) ?? new Set<string>();
          compatibleServices.add(serviceId);
          servicesForBookableSlot.set(key, compatibleServices);
        }
      }
    }
  }
  const slots = availability
    .filter((item) => item.teamMemberId === selected?.id)
    .flatMap((item) => item.slots as Slot[])
    .filter((slot) =>
    days.includes(localDateKey(new Date(slot.startTime), tenant.timezone)),
  );
  const openPeriods = mergeSlots(slots);
  const [configuredStaffRules, configuredStaffOverrides] = hasSelectedEmployee && selected && selectedLocation
    ? await Promise.all([
        db<ScheduleRule[]>`SELECT rrule,start_time AS "startTime",end_time AS "endTime",timezone,valid_from AS "validFrom",valid_until AS "validUntil" FROM availability_rules WHERE tenant_id=${tenant.id} AND team_member_id=${selected.id}`,
        db<ScheduleOverride[]>`SELECT (local_date::timestamp AT TIME ZONE 'UTC') AS date,start_time AS "startTime",end_time AS "endTime",is_unavailable AS "isUnavailable" FROM availability_overrides WHERE tenant_id=${tenant.id} AND team_member_id=${selected.id} AND local_date >= ${visibleRangeStart}::date AND local_date < ${visibleRangeEnd}::date`,
      ])
    : [[], []] as [ScheduleRule[], ScheduleOverride[]];
  // This expands the persisted recurring rules before occupancy is subtracted.
  // It is therefore the configured working canvas even if every slot is booked.
  const configuredWorkingPeriods = hasSelectedEmployee && configuredStaffRules.length
    ? mergeSlots(calculateStaffSlots(
        configuredStaffRules,
        configuredStaffOverrides,
        [],
        { start: rangeStart, end: rangeEnd },
        tenant.timezone,
        { duration: 30, slotInterval: 30, now: new Date(0) },
      ).filter((slot) =>
        days.includes(localDateKey(new Date(slot.startTime), tenant.timezone))
        && isSlotWithinLocationHours(new Date(slot.startTime), new Date(slot.endTime), locationHours, tenant.timezone),
      ))
    : [];
  const allIntervals = [
    ...openPeriods,
    ...bookings.map((booking) => ({
      startTime: booking.startsAt.toISOString(),
      endTime: booking.endsAt.toISOString(),
    })),
  ];
  const { start: gridStart, rowCount } = calendarGridBounds(
    configuredWorkingPeriods,
    allIntervals,
    tenant.timezone,
  );
  const calendarDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: tenant.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const calendarRange = new Intl.DateTimeFormat("en-GB", {
    timeZone: tenant.timezone,
    day: "numeric",
    month: "short",
  });
  const teamNavigationLabel = calendarDate.format(
    new Date(`${teamDay}T12:00:00Z`),
  );
  const workingDays = new Set(locationWorkingDays.map((entry) => entry.dayOfWeek));
  const previousWorkingDay = nextWorkingDay(teamDay, -1, workingDays);
  const followingWorkingDay = nextWorkingDay(teamDay, 1, workingDays);
  const staffNavigationLabel = `${calendarRange.format(new Date(`${currentWeek}T12:00:00Z`))} – ${calendarRange.format(new Date(`${addDays(currentWeek, 6)}T12:00:00Z`))}`;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: tenant.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const href = (next: {
    location?: string;
    employee?: string;
    service?: string;
    week?: string;
    day?: string;
    view?: "staff" | "team" | "day" | "month";
    booking?: string;
    create?: string;
    customer?: string;
    staff?: string;
    after?: string;
    before?: string;
    createStaff?: string;
    monthDay?: string;
  }) => {
    const nextView = next.view ?? calendarView;
    // Team navigation must deliberately omit employee. Carrying the fallback
    // selected person here turns a Day link into that person's Week view.
    const nextEmployee = next.employee ?? (
      nextView === "team" || (monthlyView && !hasSelectedEmployee)
        ? ""
        : (selected?.id ?? "")
    );
    const params = new URLSearchParams({
      location: next.location ?? selectedLocation?.id ?? "",
      service: next.service ?? service ?? "",
      week: next.week ?? currentWeek,
    });
    if (nextEmployee) params.set("employee", nextEmployee);
    params.set("view", nextView);
    if (next.day ?? (teamView ? teamDay : undefined))
      params.set("day", next.day ?? teamDay);
    if (next.monthDay) params.set("monthDay", next.monthDay);
    if (next.booking) params.set("booking", next.booking);
    if (next.create) params.set("create", next.create);
    const nextCustomer = next.customer ?? directCustomer?.id;
    if (nextCustomer) params.set("customer", nextCustomer);
    else if (waitlistCustomer && waitlistEntryId) params.set("waitlist", waitlistEntryId);
    if (next.staff ?? staffSearch) params.set("staff", next.staff ?? staffSearch);
    if (showOffShift === "0") params.set("showOffShift", "0");
    if (next.after) params.set("after", next.after);
    if (next.before) params.set("before", next.before);
    if (next.createStaff) params.set("createStaff", next.createStaff);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params.toString()}`;
  };
  // A selected staff member is read as a seven-row schedule: weekdays occupy
  // the same rail used for staff in the team Day board and time runs across.
  const staffWeekPosition = (entry: ScheduleEntry) => {
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);
    const dayIndex = days.indexOf(localDateKey(start, tenant.timezone));
    const startMinutes = localMinutes(start, tenant.timezone);
    const endMinutes = localMinutes(end, tenant.timezone);
    return {
      gridColumn: `${2 + Math.floor((startMinutes - gridStart) / 30)} / span ${Math.max(1, Math.ceil((endMinutes - startMinutes) / 30))}`,
      gridRow: dayIndex + 2,
    };
  };
  const teamDayBookings = teamBookings.filter(
    (booking) =>
      localDateKey(booking.startsAt, tenant.timezone) === teamDay,
  );
  const visibleTeamMembers = showOffShift !== "0" ? members : members.filter((member) =>
    teamDayBookings.some((booking) => booking.teamMemberId === member.id)
    || Array.from(bookableSlotKeys).some((key) => key.startsWith(`${member.id}|${teamDay}T`)),
  );
  const teamCreateMember = canManageSelectedSchedule ? selected : visibleTeamMembers.find((member) => canManageSchedule(member.id));
  const createMember = createStaff
    ? members.find((member) => member.id === createStaff && canManageSchedule(member.id))
    : teamView ? teamCreateMember : canManageSelectedSchedule ? selected : undefined;
  const createServices = requestedAppointment && createMember && selectedLocation && createMember.id !== selected?.id
    ? await db<Service[]>`
      SELECT s.id, s.title, s.duration_minutes AS "durationMinutes", s.price_cents AS "priceCents"
      FROM services s
      JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id
      JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenant.id} AND stm.team_member_id = ${createMember.id}
        AND sl.location_id = ${selectedLocation.id} AND s.is_active = TRUE
      ORDER BY s.title
    `
    : services;
  const manualService = createServices.find((item) => item.id === selectedService?.id) ?? createServices[0];
  const teamDayOpenPeriods = mergeSlots(
    availability
      .flatMap((item) => item.slots as Slot[])
      .filter(
        (slot) =>
          localDateKey(new Date(slot.startTime), tenant.timezone) === teamDay,
      ),
  );
  const teamIntervals = [
    ...teamDayOpenPeriods,
    ...teamDayBookings.map((booking) => ({
      startTime: booking.startsAt.toISOString(),
      endTime: booking.endsAt.toISOString(),
    })),
  ];
  const { start: teamGridStart, rowCount: teamRowCount } =
    calendarGridBounds(teamDayOpenPeriods, teamIntervals, tenant.timezone);
  const teamPosition = (booking: TeamBooking) => ({
    gridColumn: `${2 + Math.floor((localMinutes(booking.startsAt, tenant.timezone) - teamGridStart) / 30)} / span ${Math.max(1, Math.ceil((localMinutes(booking.endsAt, tenant.timezone) - localMinutes(booking.startsAt, tenant.timezone)) / 30))}`,
    gridRow: visibleTeamMembers.findIndex((member) => member.id === booking.teamMemberId) + 2,
    borderLeftColor: booking.teamMemberColor,
  });
  const monthlyBookings = monthScopedBookings.filter(
    (booking) => !selectedService || booking.serviceId === selectedService.id,
  );
  const monthBookingsByDay = new Map<string, { appointments: Map<string, TeamBooking>; providers: Set<string | null> }>();
  for (const booking of monthlyBookings) {
    const bookingDay = localDateKey(booking.startsAt, tenant.timezone);
    const daily = monthBookingsByDay.get(bookingDay) ?? { appointments: new Map(), providers: new Set<string | null>() };
    if (!daily.appointments.has(booking.id)) daily.appointments.set(booking.id, booking);
    daily.providers.add(booking.teamMemberId);
    monthBookingsByDay.set(bookingDay, daily);
  }
  const monthFirstWeekday = (new Date(`${currentMonth}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monthDayCount = new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0)).getUTCDate();
  const monthDays = Array.from({ length: monthDayCount }, (_, index) => addDays(currentMonth, index));

  return (
    <main className="waybook-data-page tenant-dashboard-page">
      <TenantDashboardNav
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        tenantName={tenant.name}
        active="calendars"
      />
      <CalendarFilterDismiss />
      {(canManage || permissions.canManageOwnAppointments || permissions.canManageTeamAppointments) ? (
        <CalendarBookingDragDrop />
      ) : null}
      <style>{`.tenant-dashboard-page .waybook-week-calendar:not(.team-day-calendar) .waybook-week-calendar__entry.is-booking { border-left-color: ${selectedStaffBookingColor} !important; }`}</style>
      {!selectedLocation ? (
        <section className="waybook-data-card">
          <h2>Add a location first</h2>
          <p>
            Calendar availability is organized by location. Add an active
            location before managing schedules.
          </p>
        </section>
      ) : members.length === 0 ? (
        <section className="waybook-data-card">
          <h2>Assign a {terms.staffMember} to {selectedLocation?.name}</h2>
          <p>
            Calendars show staff schedules for the selected location. Add the
            assignment in {titleTerminology(terms.staff)} details.
          </p>
        </section>
      ) : (
        <>
          {selected ? (
            <>
              {monthlyView ? (
                <section className="waybook-data-card waybook-month-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>MONTHLY SCHEDULE</p>
                      <h2>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${currentMonth}T12:00:00Z`))}</h2>
                      <span>{selectedLocation.name} · {hasSelectedEmployee ? selected?.name : `All ${terms.staffPlural}`} · {tenant.timezone}</span>
                    </div>
                    <div className="waybook-calendar-toolbar__actions">
                      <details className="calendar-filter-panel">
                        <summary>Filters</summary>
                        <div className="calendar-filter-panel__content">
                          <CalendarSelectors terminology={terms} location={selectedLocation} members={members} services={monthCalendarServices} week={currentWeek} fixedView="month" />
                        </div>
                      </details>
                      <CalendarActiveFilters staffLabel={titleTerminology(terms.staffPlural)}
                        location={{ name: selectedLocation.name, isExplicit: Boolean(requestedLocation) }}
                        staff={hasSelectedEmployee && selected ? { name: selected.name, id: selected.id } : undefined}
                        service={selectedService ? { name: selectedService.title, id: selectedService.id } : undefined}
                        rosterSearch={staffSearch || undefined}
                        excludesOffShift={showOffShift === "0"}
                        dayFallback={teamDay}
                      />
                      <div className="calendar-view-toggle" aria-label="Calendar range">
                        {hasSelectedEmployee ? <Link href={href({ view: "staff", employee: selected?.id, week: weekStartFor(teamDay), day: teamDay, monthDay: undefined })}>Week</Link> : <Link href={href({ view: "team", employee: "", day: teamDay, monthDay: undefined })}>Day</Link>}
                        <Link href={href({ view: "month", day: currentMonth, monthDay: undefined })} aria-current="page">Month</Link>
                      </div>
                      <div className="waybook-calendar-date-nav" aria-label="Calendar month navigation">
                        <Link href={href({ view: "month", day: addMonths(currentMonth, -1), monthDay: undefined })} aria-label="Previous month"><ChevronLeft size={17} aria-hidden="true" /></Link>
                        <CalendarDatePicker date={teamDay} label={new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${currentMonth}T12:00:00Z`))} scope={calendarDatePickerScope} />
                        <Link href={href({ view: "month", day: addMonths(currentMonth, 1), monthDay: undefined })} aria-label="Next month"><ChevronRight size={17} aria-hidden="true" /></Link>
                      </div>
                    </div>
                  </div>
                  <div className="waybook-month-calendar__layout">
                    <div className="waybook-month-calendar__grid" aria-label={`Bookings for ${currentMonth.slice(0, 7)}`}>
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => <div key={label} className="waybook-month-calendar__weekday">{label}</div>)}
                      {Array.from({ length: monthFirstWeekday }, (_, index) => <div className="waybook-month-calendar__blank" aria-hidden="true" key={`blank-${index}`} />)}
                      {monthDays.map((date) => {
                        const dayOverview = monthBookingsByDay.get(date);
                        const dayBookings = [...(dayOverview?.appointments.values() ?? [])];
                        const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
                        const dayHref = hasSelectedEmployee
                          ? href({ view: "staff", employee: selected?.id, week: weekStartFor(date), day: date })
                          : href({ view: "team", employee: "", day: date });
                        const staffCount = dayOverview?.providers.size ?? 0;
                        return <div key={date} className="waybook-month-calendar__day">
                          <Link href={dayHref} className="waybook-month-calendar__day-link" aria-label={`${label}, ${dayBookings.length} ${dayBookings.length === 1 ? "booking" : "bookings"}. Open day view`}>
                            <span className="waybook-month-calendar__date">{date.slice(-2).replace(/^0/, "")}</span>
                            {dayBookings.length > 0 ? <span className="waybook-month-calendar__count">{dayBookings.length} {dayBookings.length === 1 ? "booking" : "bookings"}</span> : null}
                          </Link>
                          {dayBookings.length > 0 ? <div className="waybook-month-calendar__preview" aria-label={`Bookings for ${label}`}><b>{label}</b><span>{dayBookings.length} {dayBookings.length === 1 ? "booking" : "bookings"} · {staffCount} {staffCount === 1 ? terms.staffMember : terms.staffPlural}</span>{dayBookings.slice(0, 5).map((booking) => <Link key={booking.id} href={href({ view: "month", day: currentMonth, booking: booking.id })}>{clock.format(booking.startsAt)} · {booking.customerName}</Link>)}{dayBookings.length > 5 ? <Link href={dayHref}>+{dayBookings.length - 5} more · Open day</Link> : null}</div> : null}
                          <div className="waybook-month-calendar__appointments">
                            {dayBookings.slice(0, 3).map((booking) => <Link key={booking.id} href={href({ view: "month", day: currentMonth, booking: booking.id })} className="waybook-month-calendar__appointment" style={{ borderLeftColor: booking.teamMemberColor }} title={`${clock.format(booking.startsAt)} · ${booking.customerName} · ${booking.teamMemberName}`}><span>{clock.format(booking.startsAt)}</span> {booking.customerName}</Link>)}
                            {dayBookings.length > 3 ? <Link className="waybook-month-calendar__more" href={dayHref}>+{dayBookings.length - 3} more</Link> : null}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>
                </section>
              ) : teamView ? (
                <section className="waybook-data-card waybook-week-calendar team-day-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>
                        <span className="waybook-calendar-toolbar__context is-standalone">{selectedLocation?.name} · {visibleTeamMembers.length} visible {terms.staffPlural}</span>
                      </p>
                      <h2>{calendarDate.format(new Date(`${teamDay}T12:00:00Z`))}</h2>
                    </div>
                    <div className="waybook-calendar-toolbar__actions">
                      <details className="calendar-filter-panel">
                        <summary>Filters</summary>
                        <div className="calendar-filter-panel__content">
                          <CalendarSelectors terminology={terms}
                            location={selectedLocation!}
                            members={members}
                            services={calendarServices}
                            week={currentWeek}
                          />
                          <CalendarRosterControls staffPlural={terms.staffPlural} includeOffShift={showOffShift !== "0"} />
                          <p className="calendar-selectors__hint" id="calendar-search-hint">Type 2+ characters to search.</p>
                        </div>
                      </details>
                      <CalendarActiveFilters staffLabel={titleTerminology(terms.staffPlural)}
                        location={{ name: selectedLocation!.name, isExplicit: Boolean(requestedLocation) }}
                        service={selectedService ? { name: selectedService.title, id: selectedService.id } : undefined}
                        rosterSearch={staffSearch || undefined}
                        excludesOffShift={showOffShift === "0"}
                        dayFallback={teamDay}
                      />
                      <div className="calendar-view-toggle" aria-label="Calendar range"><Link href={href({ view: "team", employee: "", day: teamDay })} aria-current="page">Day</Link><Link href={href({ view: "month", employee: "", day: teamDay })}>Month</Link></div>
                      <div className="waybook-calendar-date-nav" aria-label="Calendar date navigation">
                        <Link
                          href={href({
                            view: "team",
                            day: previousWorkingDay,
                            week: weekStartFor(previousWorkingDay),
                          })}
                          aria-label="Previous day"
                        >
                          <ChevronLeft size={17} aria-hidden="true" />
                        </Link>
                        <CalendarDatePicker date={teamDay} label={teamNavigationLabel} scope={calendarDatePickerScope} />
                        <Link
                          href={href({
                            view: "team",
                            day: followingWorkingDay,
                            week: weekStartFor(followingWorkingDay),
                          })}
                          aria-label="Next day"
                        >
                          <ChevronRight size={17} aria-hidden="true" />
                        </Link>
                      </div>
                      {teamCreateMember && calendarServices.length && !isHistoricalTeamDay ? (
                        <Link
                          className="waybook-primary-link"
                          href={href({
                            view: "team",
                            week: weekStartFor(teamDay),
                            day: teamDay,
                            create: `${teamDay}T09:00`,
                          })}
                        >
                          New appointment
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {visibleTeamMembers.length ? (
                    <>
                  <div className="waybook-week-calendar__scroll">
                    <div
                      className="waybook-week-calendar__grid team-day-calendar__grid"
                      style={{
                        gridTemplateColumns: `var(--team-staff-rail, 12rem) repeat(${teamRowCount}, minmax(4.4rem, 1fr))`,
                        gridTemplateRows: `3rem repeat(${visibleTeamMembers.length}, 4.25rem)`,
                      }}
                    >
                      <div className="waybook-week-calendar__corner">{titleTerminology(terms.staffPlural)}</div>
                      {Array.from({ length: teamRowCount }, (_, index) => <div className="team-day-calendar__time-header" key={`team-time-${index}`} style={{ gridColumn: index + 2, gridRow: 1 }}>{index % 2 === 0 ? `${String(Math.floor((teamGridStart + index * 30) / 60)).padStart(2, "0")}:00` : ""}</div>)}
                      {visibleTeamMembers.flatMap((member, memberIndex) => [
                        <div key={`staff-${member.id}`} className="team-day-calendar__staff" aria-label={member.name} style={{ gridColumn: 1, gridRow: memberIndex + 2 }}><i aria-hidden>{member.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</i><strong>{member.name}</strong></div>,
                        ...Array.from({ length: teamRowCount }, (_, index) => {
                          const time = `${String(Math.floor((teamGridStart + index * 30) / 60)).padStart(2, "0")}:${String((teamGridStart + index * 30) % 60).padStart(2, "0")}`;
                          const slotKey = `${member.id}|${teamDay}T${time}`;
                          const isPastDate = isPastCalendarSlot(teamDay, time, tenant.timezone, calendarNow);
                          const isBookable = !isPastDate && bookableSlotKeys.has(slotKey);
                          // Historical schedules remain visible, but never
                          // masquerade as a staff/service availability error.
                          // The slot engine correctly refuses starts in the
                          // past; represent that as a quiet, read-only cell.
                          const isAppointmentConflict = Boolean(
                            !isBookable &&
                              !isPastDate &&
                              overlapsAnyScheduledAppointment(
                                teamDayBookings.filter((booking) => booking.teamMemberId === member.id),
                                teamDay,
                                time,
                                visibleServiceDurations,
                                tenant.timezone,
                              ),
                          );
                          const canManageMember = canManageSchedule(member.id);
                          return canManageMember && isBookable ? (
                            <Link
                              className="waybook-week-calendar__cell is-actionable is-bookable"
                              data-availability-state="bookable"
                              data-calendar-drop-cell="true"
                              data-calendar-team-member-id={member.id}
                              data-calendar-starts-at={`${teamDay}T${time}`}
                              data-calendar-service-ids={Array.from(servicesForBookableSlot.get(slotKey) ?? []).join(",")}
                              style={{ gridColumn: index + 2, gridRow: memberIndex + 2 }}
                              aria-label={`New appointment ${member.name} ${teamDay} ${time}`}
                              href={href({
                                employee: "",
                                view: "team",
                                week: weekStartFor(teamDay),
                                day: teamDay,
                                service: serviceForBookableSlot.get(slotKey),
                                create: `${teamDay}T${time}`,
                                createStaff: member.id,
                              })}
                              key={`${member.id}-${index}`}
                            />
                          ) : (
                            <div
                              className={`waybook-week-calendar__cell ${isPastDate ? "is-past" : isAppointmentConflict ? "is-appointment-conflict" : "is-unavailable"}`}
                              data-availability-state={isPastDate ? "past" : isAppointmentConflict ? "appointment-overlap" : "unavailable"}
                              {...(canManageMember && !isPastDate
                                ? {
                                    "data-calendar-drop-cell": "true",
                                    "data-calendar-team-member-id": member.id,
                                    "data-calendar-starts-at": `${teamDay}T${time}`,
                                  }
                                : {})}
                              aria-label={isPastDate ? "Past time" : isAppointmentConflict ? "Overlaps an existing appointment" : "Unavailable"}
                              key={`${member.id}-${index}`}
                              style={{ gridColumn: index + 2, gridRow: memberIndex + 2 }}
                            />
                          );
                        }),
                      ])}
                      {teamDayBookings.map((booking) => (
                        <Link
                          key={booking.bookingBlockId}
                          href={href({
                            view: "team",
                            week: weekStartFor(teamDay),
                            day: teamDay,
                            booking: booking.id,
                          })}
                          className={`waybook-week-calendar__entry is-booking is-booking--${booking.status}`}
                          data-calendar-service-id={booking.serviceId}
                          draggable={!booking.hasLinkedServices && canManageSchedule(booking.teamMemberId) && isMovableAppointmentStatus(booking.status)}
                          style={teamPosition(booking)}
                        >
                          <strong>{booking.customerName}</strong>
                          <span className="waybook-calendar-entry__meta">
                            <span className="waybook-calendar-entry__time">{clock.format(booking.startsAt)}–{clock.format(booking.endsAt)}</span>
                            <em>{booking.attendanceStage ? appointmentStageLabels[booking.attendanceStage] : booking.status === "completed" ? "Done" : booking.status.replace("_", " ")}</em>
                          </span>
                          <CalendarBookingService service={booking.serviceTitle} resource={showResources ? booking.resourceName : null} />
                        </Link>
                      ))}
                    </div>
                  </div>
                  {staffBefore || staffAfter || hasMoreMembers ? (
                    <nav className="calendar-row-filter__more" aria-label={`${titleTerminology(terms.staff)} roster window`}>
                      {staffBefore ? <Link className="waybook-secondary-link" href={href({ view: "team", before: members[0]?.id })}>Previous {terms.staffPlural}</Link> : null}
                      {hasMoreMembers ? <Link className="waybook-secondary-link" href={href({ view: "team", after: members.at(-1)?.id })}>Next {terms.staffPlural}</Link> : null}
                    </nav>
                  ) : null}
                  {calendarServices.length || isHistoricalTeamDay ? (
                    <div className="waybook-calendar-footer">
                      {calendarServices.length ? (
                        <div className="waybook-calendar-legend" aria-label="Calendar availability legend">
                          <span><i className="is-booking" aria-hidden="true" /> Received booking</span>
                          <span><i className="is-bookable" aria-hidden="true" /> {selectedService ? `Bookable for ${selectedService.title}` : "Bookable for any assigned service"}</span>
                          <span><i className="is-unavailable" aria-hidden="true" /> Unavailable</span>
                          <span><i className="is-past" aria-hidden="true" /> Past</span>
                        </div>
                      ) : null}
                      {isHistoricalTeamDay ? <p className="waybook-calendar-history-notice">Historical schedule · appointments cannot be added before {calendarDate.format(new Date(`${tenantToday}T12:00:00Z`))}.</p> : null}
                    </div>
                  ) : null}
                    </>
                  ) : (
                    <div className="team-day-calendar__empty" role="status">
                      <strong>No {terms.staffPlural} visible</strong>
                      <span>No {terms.staffPlural} match the current filters. Adjust Filters to see more {terms.staffPlural}.</span>
                    </div>
                  )}
                </section>
              ) : (
                <section className="waybook-data-card waybook-week-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>{terms.staff.toUpperCase()} SCHEDULE</p>
                      <h2>{selected.name}</h2>
                      <span>
                        Confirmed bookings and live bookable periods in{" "}
                        {selectedLocation?.name} · {tenant.timezone}.
                      </span>
                    </div>
                    <div className="waybook-calendar-toolbar__actions">
                      <details className="calendar-filter-panel">
                        <summary>Filters</summary>
                        <div className="calendar-filter-panel__content">
                          <CalendarSelectors terminology={terms}
                            location={selectedLocation!}
                            members={members}
                            services={services}
                            week={currentWeek}
                          />
                        </div>
                      </details>
                      <CalendarActiveFilters staffLabel={titleTerminology(terms.staffPlural)}
                        location={{ name: selectedLocation!.name, isExplicit: Boolean(requestedLocation) }}
                        staff={selected ? { name: selected.name, id: selected.id } : undefined}
                        service={selectedService ? { name: selectedService.title, id: selectedService.id } : undefined}
                        rosterSearch={staffSearch || undefined}
                        excludesOffShift={showOffShift === "0"}
                        dayFallback={teamDay}
                      />
                      <div className="calendar-view-toggle" aria-label="Calendar range">
                        <Link href={href({ view: "staff", day: undefined })} aria-current="page">Week</Link>
                        <Link href={href({ view: "month", day: teamDay })}>Month</Link>
                      </div>
                      <div className="waybook-calendar-date-nav" aria-label="Calendar date navigation">
                        <Link
                          href={href({
                            view: "staff",
                            week: addDays(visibleWeekStart, -7),
                            day: addDays(visibleWeekStart, -7),
                          })}
                          aria-label="Previous week"
                        >
                          <ChevronLeft size={17} aria-hidden="true" />
                        </Link>
                        <CalendarDatePicker date={currentWeek} label={staffNavigationLabel} scope={calendarDatePickerScope} />
                        <Link
                          href={href({
                            view: "staff",
                            week: addDays(visibleWeekStart, 7),
                            day: addDays(visibleWeekStart, 7),
                          })}
                          aria-label="Next week"
                        >
                          <ChevronRight size={17} aria-hidden="true" />
                        </Link>
                      </div>
                      {canManageSelectedSchedule && services.length && hasCurrentOrFutureWeekDay ? (
                        <Link
                          className="waybook-primary-link"
                          href={href({
                            view: "staff",
                            day: undefined,
                            create: `${days.includes(tenantToday) ? tenantToday : days[0]}T09:00`,
                          })}
                        >
                          New appointment
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {services.length === 0 ? (
                    <p className="waybook-permission-note">
                      Assign a service to this {terms.staffMember} at{" "}
                      {selectedLocation?.name} to calculate slots.
                    </p>
                  ) : null}
                  <div className="waybook-week-calendar__scroll">
                    <div
                      className="waybook-week-calendar__grid staff-week-calendar__grid"
                      style={{
                        gridTemplateColumns: `var(--staff-week-rail, 12rem) repeat(${rowCount}, minmax(4.4rem, 1fr))`,
                        gridTemplateRows: "3rem repeat(7, 4.25rem)",
                      }}
                    >
                      <div className="waybook-week-calendar__corner" style={{ gridColumn: 1, gridRow: 1 }}>{selected.name}</div>
                      {Array.from({ length: rowCount }, (_, index) => {
                        const time = `${String(Math.floor((gridStart + index * 30) / 60)).padStart(2, "0")}:${String((gridStart + index * 30) % 60).padStart(2, "0")}`;
                        return <div
                          className="waybook-week-calendar__time"
                          key={`time-${index}`}
                          style={{ gridColumn: index + 2, gridRow: 1, "--staff-week-grid-column": index + 2 } as CSSProperties}
                        >
                          {index % 2 === 0 ? time : ""}
                        </div>;
                      })}
                      {days.map((day, dayIndex) => (
                        <div
                          key={day}
                          className="waybook-week-calendar__day"
                          style={{ gridColumn: 1, gridRow: dayIndex + 2 }}
                          data-availability-state={selectedBookableDays.has(day) ? "available" : "unavailable"}
                        >
                          <span>{calendarDate.format(new Date(`${day}T12:00:00Z`))}</span>
                          {day >= tenantToday && !selectedBookableDays.has(day) ? (
                            <small>No availability</small>
                          ) : null}
                        </div>
                      ))}
                      {days.flatMap((day, dayIndex) =>
                        Array.from({ length: rowCount }, (_, index) => {
                          const time = `${String(Math.floor((gridStart + index * 30) / 60)).padStart(2, "0")}:${String((gridStart + index * 30) % 60).padStart(2, "0")}`;
                          const slotKey = `${selected?.id}|${day}T${time}`;
                          const isPastDate = isPastCalendarSlot(day, time, tenant.timezone, calendarNow);
                          const isBookable = !isPastDate && bookableSlotKeys.has(slotKey);
                          const isAppointmentConflict = Boolean(
                            !isBookable &&
                              !isPastDate &&
                              overlapsAnyScheduledAppointment(
                                bookings,
                                day,
                                time,
                                visibleServiceDurations,
                                tenant.timezone,
                              ),
                          );
                          return canManageSelectedSchedule && services.length && isBookable ? (
                            <Link
                              className="waybook-week-calendar__cell is-actionable is-bookable"
                              data-availability-state="bookable"
                              data-calendar-drop-cell="true"
                              data-calendar-team-member-id={selected!.id}
                              data-calendar-starts-at={`${day}T${time}`}
                              data-calendar-service-ids={Array.from(servicesForBookableSlot.get(slotKey) ?? []).join(",")}
                              style={{ gridColumn: index + 2, gridRow: dayIndex + 2 }}
                              aria-label={`New appointment ${day} ${time}`}
                              href={href({
                                view: "staff",
                                day: undefined,
                                service: serviceForBookableSlot.get(slotKey),
                                create: `${day}T${time}`,
                              })}
                              key={`${day}-${index}`}
                            />
                          ) : (
                            <div
                              className={`waybook-week-calendar__cell ${isPastDate ? "is-past" : isAppointmentConflict ? "is-appointment-conflict" : "is-unavailable"}`}
                              data-availability-state={isPastDate ? "past" : isAppointmentConflict ? "appointment-overlap" : "unavailable"}
                              {...(canManageSelectedSchedule && !isPastDate
                                ? {
                                    "data-calendar-drop-cell": "true",
                                    "data-calendar-team-member-id": selected!.id,
                                    "data-calendar-starts-at": `${day}T${time}`,
                                  }
                                : {})}
                              aria-label={isPastDate ? "Past time" : isAppointmentConflict ? "Overlaps an existing appointment" : "Unavailable"}
                              key={`${day}-${index}`}
                              style={{ gridColumn: index + 2, gridRow: dayIndex + 2 }}
                            />
                          );
                        }),
                      )}
                      {openPeriods.map((period) => (
                        <div
                          key={period.startTime}
                          className="waybook-week-calendar__entry is-open"
                          style={staffWeekPosition(period)}
                        >
                          <strong>Bookable</strong>
                          <span>
                            {clock.format(new Date(period.startTime))}–
                            {clock.format(new Date(period.endTime))}
                          </span>
                        </div>
                      ))}
                      {bookings.map((booking) => (
                        <Link
                          key={booking.bookingBlockId}
                          href={href({
                            view: "staff",
                            day: undefined,
                            booking: booking.id,
                          })}
                          className={`waybook-week-calendar__entry is-booking is-booking--${booking.status}`}
                          data-calendar-service-id={booking.serviceId}
                          draggable={!booking.hasLinkedServices && canManageSchedule(booking.teamMemberId) && isMovableAppointmentStatus(booking.status)}
                          style={staffWeekPosition({
                            startTime: booking.startsAt.toISOString(),
                            endTime: booking.endsAt.toISOString(),
                          })}
                        >
                          <strong>{booking.customerName}</strong>
                          <span className="waybook-calendar-entry__meta">
                            <span className="waybook-calendar-entry__time">{clock.format(booking.startsAt)}–{clock.format(booking.endsAt)}</span>
                            <em>{booking.attendanceStage ? appointmentStageLabels[booking.attendanceStage] : booking.status === "completed" ? "Done" : booking.status.replace("_", " ")}</em>
                          </span>
                          <CalendarBookingService service={booking.serviceTitle} resource={showResources ? booking.resourceName : null} />
                        </Link>
                      ))}
                    </div>
                  </div>
                  {services.length ? (
                    <div className="waybook-calendar-legend" aria-label="Calendar availability legend">
                      <span><i className="is-booking" aria-hidden="true" /> Received booking</span>
                      <span><i className="is-bookable" aria-hidden="true" /> {selectedService ? `Bookable for ${selectedService.title}` : "Bookable for any assigned service"}</span>
                      <span><i className="is-unavailable" aria-hidden="true" /> Unavailable</span>
                      <span><i className="is-past" aria-hidden="true" /> Past</span>
                    </div>
                  ) : null}
                </section>
              )}
            </>
          ) : null}
        </>
      )}
      <CalendarAppointmentDrawer checkoutPath={tenantPath(tenantSlug, "/app/sales")} staffLabel={titleTerminology(terms.staffPlural)}
        timezone={tenant.timezone}
        summaries={[...bookings, ...teamBookings, ...monthScopedBookings].map((item) => ({
          id: item.id, bookingNumber: item.bookingNumber, customerName: item.customerName,
          serviceTitle: item.serviceTitle, teamMemberName: "teamMemberName" in item && typeof item.teamMemberName === "string" ? item.teamMemberName : members.find((member) => member.id === item.teamMemberId)?.name ?? "",
          startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), status: item.status, attendanceStage: item.attendanceStage,
        }))}
        initialDetail={initialDetail}
      />
      {requestedAppointment && createMember && selectedLocation ? (
        <TenantEditorDialog title="New appointment" closeHref={href({})} cycleFocus>
          <aside
            className="tenant-drawer appointment-drawer"
            aria-label="New appointment"
          >
            <header>
              <div>
                <h2>New appointment</h2>
                <span>
                  {createMember.name} · {selectedLocation.name} ·{" "}
                  {requestedAppointment.replace("T", " ")}
                </span>
              </div>
              <TenantEditorClose label="Close new appointment" href={href({})}>
                ×
              </TenantEditorClose>
            </header>
            <div className="appointment-drawer__body">
              <ManualAppointmentForm terminology={terms}
                calendarPath={tenantPath(tenantSlug, "/app/calendars")}
                initialLocation={selectedLocation}
                initialMember={createMember}
                initialService={manualService ?? null}
                fixedStaff={!canManage && !permissions.canManageTeamAppointments}
                defaultDate={requestedAppointment.slice(0, 10)}
                defaultTime={requestedAppointment.slice(11)}
                timezone={tenant.timezone}
                canLookupClients={canViewClientDirectory}
                initialClient={directCustomer}
                waitlistEntryId={waitlistCustomer ? waitlistEntryId : undefined}
                waitlistUnavailable={Boolean(waitlistEntryId && !waitlistCustomer)}
                customerName={selectedCustomer?.name}
                customerEmail={selectedCustomer?.email}
                customerPhone={selectedCustomer?.phone}
              />
            </div>
          </aside>
        </TenantEditorDialog>
      ) : null}
    </main>
  );
}
