import Link from "next/link";
import { fromZonedTime } from "date-fns-tz";
import { CalendarSelectors } from "@/components/calendar-selectors";
import { CalendarFilterDismiss } from "@/components/calendar-filter-panel";
import { CalendarRosterControls } from "@/components/calendar-roster-controls";
import { CalendarBookingDragDrop } from "@/components/calendar-booking-drag-drop";
import { AppointmentDrawerActions } from "@/components/appointment-drawer-actions";
import { CancelAppointmentForm } from "@/components/cancel-appointment-form";
import { ManualAppointmentForm } from "@/components/manual-appointment-form";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import {
  currentTenantRouteSlug,
  requireTenantWorkspace,
} from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import {
  cancelAppointment,
  getRescheduleBookingAvailability,
  rescheduleBooking,
  updateBookingDetails,
  updateBookingStatus,
} from "./actions";

type Member = {
  id: string;
  name: string;
  email: string;
  calendarColor: string;
};
type Service = { id: string; title: string; durationMinutes: number };
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
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  serviceTitle: string;
};
type TeamBooking = Booking & {
  teamMemberName: string;
  teamMemberColor: string;
};
type Slot = { startTime: string; endTime: string };
type ScheduleEntry = { startTime: string; endTime: string };
type ResourceChoice = { id: string; name: string; isMutuallyExclusive: boolean };

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

function calendarGridBounds(intervals: ScheduleEntry[], timezone: string) {
  if (!intervals.length) return { start: 9 * 60, end: 10 * 60, rowCount: 2 };

  const earliest = Math.min(
    ...intervals.map((entry) =>
      localMinutes(new Date(entry.startTime), timezone),
    ),
  );
  const latest = Math.max(
    ...intervals.map((entry) => localMinutes(new Date(entry.endTime), timezone)),
  );
  const start = Math.max(0, Math.floor(earliest / 60) * 60);
  const end = Math.min(24 * 60, Math.max(start + 60, Math.ceil(latest / 60) * 60));

  return { start, end, rowCount: Math.max(2, (end - start) / 30) };
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
    staff?: string;
    after?: string;
    before?: string;
    createStaff?: string;
    showOffShift?: string;
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
    staff: staffFilter,
    after,
    before,
    createStaff,
    showOffShift,
  } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  await requireFeature(tenant.id, "calendars");
  const permissions = await staffPermissionContext(tenant, membership);
  const canViewTeam = permissions.isManager || permissions.canViewTeamCalendar;
  if (!canViewTeam && !permissions.teamMemberId) {
    throw new Error("You do not have permission to view this calendar.");
  }
  const effectiveEmployee = canViewTeam ? employee : permissions.teamMemberId;
  const restrictedEmployeeId = permissions.teamMemberId ?? "";
  const db = tenantDb(tenant);
  const requestedLocationId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(location ?? "") ? location! : null;
  const requestedLocation = requestedLocationId
    ? (await db<Location[]>`SELECT id,name FROM locations WHERE tenant_id=${tenant.id} AND id=${requestedLocationId} AND is_active=TRUE LIMIT 1`)[0]
    : undefined;
  const bookingLocation = !requestedLocation && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId ?? "")
    ? (await db<Location[]>`SELECT l.id,l.name FROM bookings b JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id WHERE b.tenant_id=${tenant.id} AND b.id=${bookingId!} AND l.is_active=TRUE AND (${canViewTeam} OR b.team_member_id=${restrictedEmployeeId || null}::uuid) LIMIT 1`)[0]
    : undefined;
  const requestedDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : localDateKey(new Date(), tenant.timezone);
  const selectedLocation = requestedLocation
    ?? bookingLocation
    ?? (await db<Location[]>`SELECT l.id,l.name FROM locations l WHERE l.tenant_id=${tenant.id} AND l.is_active=TRUE ORDER BY CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.tenant_id=l.tenant_id AND b.location_id=l.id AND b.status <> 'cancelled' AND to_char(b.starts_at AT TIME ZONE ${tenant.timezone},'YYYY-MM-DD')=${requestedDay} AND (${canViewTeam} OR b.team_member_id=${restrictedEmployeeId || null}::uuid)) THEN 0 ELSE 1 END, CASE WHEN l.slug='primary' THEN 0 ELSE 1 END,l.name LIMIT 1`)[0];
  const locationWorkingDays = selectedLocation
    ? await db<{ dayOfWeek: number }[]>`SELECT day_of_week AS "dayOfWeek" FROM location_hours WHERE tenant_id = ${tenant.id} AND location_id = ${selectedLocation.id} ORDER BY day_of_week`
    : [] as { dayOfWeek: number }[];
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
  const requestedCreateMember = isMemberId(createStaff)
    ? members.find((member) => member.id === createStaff)
    : undefined;
  const [selectedCustomer] = customerId
    ? await db<
        Customer[]
      >`SELECT id, name, email, phone FROM customers WHERE tenant_id = ${tenant.id} AND id = ${customerId} LIMIT 1`
    : [];
  const tenantToday = localDateKey(new Date(), tenant.timezone);
  const hasSelectedEmployee = Boolean(
    effectiveEmployee && members.some((member) => member.id === effectiveEmployee),
  );
  // Team has one operational Day board. An individual can deliberately switch
  // between their own Day and Week board without changing staff scope.
  const staffDayView = hasSelectedEmployee && view === "day";
  const teamView = !hasSelectedEmployee || staffDayView;
  const calendarView = staffDayView ? "day" : teamView ? "team" : "staff";
  const teamDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : tenantToday;
  // A team-day deep link can carry a day without a week. Query the week that
  // contains that day so the grid and booking data can never drift apart.
  const currentWeek = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "")
    ? weekStartFor(week!)
    : weekStartFor(teamView ? teamDay : tenantToday);
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
  const visibleRangeStart = teamView ? teamDay : currentWeek;
  const visibleRangeEnd = addDays(visibleRangeStart, teamView ? 1 : 7);
  const rangeStart = fromZonedTime(`${visibleRangeStart}T00:00:00`, tenant.timezone);
  const rangeEnd = fromZonedTime(`${visibleRangeEnd}T00:00:00`, tenant.timezone);
  const [services, calendarServices, bookings, teamBookings] =
    selected && selectedLocation
      ? await Promise.all([
          db<
            Service[]
          >`SELECT s.id, s.title, s.duration_minutes AS "durationMinutes" FROM services s JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenant.id} AND stm.team_member_id = ${selected.id} AND sl.location_id = ${selectedLocation.id} AND s.is_active = TRUE ORDER BY s.title`,
          db<
            Service[]
          >`SELECT DISTINCT s.id, s.title, s.duration_minutes AS "durationMinutes" FROM services s JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id JOIN team_member_locations tml ON tml.tenant_id = stm.tenant_id AND tml.team_member_id = stm.team_member_id JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenant.id} AND s.is_active = TRUE AND stm.team_member_id = ANY(${members.map((member) => member.id)}) AND tml.location_id = ${selectedLocation.id} AND sl.location_id = ${selectedLocation.id} ORDER BY s.title`,
          db<
            Booking[]
          >`SELECT b.id, b.booking_number AS "bookingNumber", b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", bra.resource_id AS "resourceId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle" FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL LEFT JOIN resources r ON r.id=bra.resource_id AND r.tenant_id=b.tenant_id WHERE b.tenant_id = ${tenant.id} AND b.location_id = ${selectedLocation.id} AND b.team_member_id = ${selected.id} AND b.starts_at >= ${rangeStart} AND b.starts_at < ${rangeEnd} AND b.status <> 'cancelled' ORDER BY b.starts_at ASC LIMIT 100`,
          db<
            TeamBooking[]
          >`SELECT b.id, b.booking_number AS "bookingNumber", b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", bra.resource_id AS "resourceId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle", tm.name AS "teamMemberName", tm.calendar_color AS "teamMemberColor" FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL LEFT JOIN resources r ON r.id=bra.resource_id AND r.tenant_id=b.tenant_id WHERE b.tenant_id = ${tenant.id} AND b.location_id = ${selectedLocation.id} AND b.team_member_id = ANY(${members.map((member) => member.id)}) AND b.starts_at >= ${rangeStart} AND b.starts_at < ${rangeEnd} AND b.status <> 'cancelled' ORDER BY b.starts_at ASC LIMIT 300`,
        ])
      : ([[], [], [], []] as [
          Service[],
          Service[],
          Booking[],
          TeamBooking[],
        ]);
  const selectedBooking =
    bookingId && selectedLocation
      ? ((teamView ? teamBookings : bookings).find(
          (booking) => booking.id === bookingId,
        ) ??
        (
          await db<Booking[]>`
      SELECT b.id, b.booking_number AS "bookingNumber", b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", bra.resource_id AS "resourceId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status,
        c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle"
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL
      LEFT JOIN resources r ON r.id=bra.resource_id AND r.tenant_id=b.tenant_id
      WHERE b.tenant_id = ${tenant.id} AND b.id = ${bookingId} AND b.location_id = ${selectedLocation.id} ${canViewTeam ? db`` : db`AND b.team_member_id = ${restrictedEmployeeId}`}
      LIMIT 1
    `
        )[0] ??
        null)
      : null;
  const eligibleResources = selectedBooking ? await db<ResourceChoice[]>`
    SELECT r.id,r.name,r.is_mutually_exclusive AS "isMutuallyExclusive"
    FROM resources r
    JOIN resource_locations rl ON rl.tenant_id=r.tenant_id AND rl.resource_id=r.id AND rl.location_id=${selectedBooking.locationId}
    JOIN service_resources sr ON sr.tenant_id=r.tenant_id AND sr.resource_id=r.id AND sr.service_id=${selectedBooking.serviceId}
    WHERE r.tenant_id=${tenant.id} AND r.is_active=TRUE ORDER BY r.name
  ` : [];
  const selectedBookingMember = selectedBooking
    ? members.find((member) => member.id === selectedBooking.teamMemberId) ?? null
    : null;
  const selectableServices = teamView && !staffDayView ? calendarServices : services;
  const selectedService = service
    ? selectableServices.find((item) => item.id === service)
    : undefined;
  const manualService = selectedService ?? services[0] ?? calendarServices[0];
  // "All services" is an availability union. Each actionable calendar cell
  // carries the compatible service into the create drawer below.
  const availabilityServices = selectedService
    ? [selectedService]
    : teamView && !staffDayView
      ? calendarServices
      : services;
  const visibleServiceDurations = Array.from(
    new Set(availabilityServices.map((item) => item.durationMinutes)),
  );
  const availabilityByService = selectedLocation
    ? await Promise.all(
        availabilityServices.map(async (item) => ({
          serviceId: item.id,
          candidates: await availableSlots(
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
  const allIntervals = [
    ...openPeriods,
    ...bookings.map((booking) => ({
      startTime: booking.startsAt.toISOString(),
      endTime: booking.endsAt.toISOString(),
    })),
  ];
  const { start: gridStart, rowCount } = calendarGridBounds(
    allIntervals,
    tenant.timezone,
  );
  const canManage = ["owner", "manager"].includes(membership.role);
  const rescheduleDays = Array.from({ length: 7 }, (_, index) =>
    addDays(localDateKey(new Date(), tenant.timezone), index),
  );
  const rescheduleSlots = selectedBooking?.teamMemberId
    ? (await getRescheduleBookingAvailability({ bookingId: selectedBooking.id, startDate: rescheduleDays[0] })).slots
    : [];
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
    view?: "staff" | "team" | "day";
    booking?: string;
    create?: string;
    customer?: string;
    staff?: string;
    after?: string;
    before?: string;
    createStaff?: string;
  }) => {
    const nextView = next.view ?? calendarView;
    // Team navigation must deliberately omit employee. Carrying the fallback
    // selected person here turns a Day link into that person's Week view.
    const nextEmployee =
      next.employee ?? (nextView === "team" ? "" : (selected?.id ?? ""));
    const params = new URLSearchParams({
      location: next.location ?? selectedLocation?.id ?? "",
      service: next.service ?? service ?? "",
      week: next.week ?? currentWeek,
    });
    if (nextEmployee) params.set("employee", nextEmployee);
    params.set("view", nextView);
    if (next.day ?? (teamView ? teamDay : undefined))
      params.set("day", next.day ?? teamDay);
    if (next.booking) params.set("booking", next.booking);
    if (next.create) params.set("create", next.create);
    if (next.customer ?? selectedCustomer?.id)
      params.set("customer", next.customer ?? selectedCustomer!.id);
    if (next.staff ?? staffSearch) params.set("staff", next.staff ?? staffSearch);
    if (next.after) params.set("after", next.after);
    if (next.before) params.set("before", next.before);
    if (next.createStaff) params.set("createStaff", next.createStaff);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params.toString()}`;
  };
  const position = (entry: ScheduleEntry) => {
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);
    const dayIndex = days.indexOf(localDateKey(start, tenant.timezone));
    const startMinutes = localMinutes(start, tenant.timezone);
    const endMinutes = localMinutes(end, tenant.timezone);
    return {
      gridColumn: dayIndex + 2,
      gridRow: `${2 + Math.floor((startMinutes - gridStart) / 30)} / span ${Math.max(1, Math.ceil((endMinutes - startMinutes) / 30))}`,
    };
  };
  const teamDayBookings = teamBookings.filter(
    (booking) =>
      localDateKey(booking.startsAt, tenant.timezone) === teamDay &&
      (!staffDayView || booking.teamMemberId === selected?.id),
  );
  const visibleTeamMembers = staffDayView && selected
    ? [selected]
    : showOffShift === "1" ? members : members.filter((member) =>
    teamDayBookings.some((booking) => booking.teamMemberId === member.id)
    || Array.from(bookableSlotKeys).some((key) => key.startsWith(`${member.id}|${teamDay}T`)),
  );
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
    calendarGridBounds(teamIntervals, tenant.timezone);
  const teamPosition = (booking: TeamBooking) => ({
    gridColumn: `${2 + Math.floor((localMinutes(booking.startsAt, tenant.timezone) - teamGridStart) / 30)} / span ${Math.max(1, Math.ceil((localMinutes(booking.endsAt, tenant.timezone) - localMinutes(booking.startsAt, tenant.timezone)) / 30))}`,
    gridRow: visibleTeamMembers.findIndex((member) => member.id === booking.teamMemberId) + 2,
    borderLeftColor: booking.teamMemberColor,
  });

  return (
    <main className="waybook-data-page tenant-dashboard-page">
      <TenantDashboardNav
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        tenantName={tenant.name}
        active="calendars"
      />
      <CalendarFilterDismiss />
      {canManage ? (
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
          <h2>Assign a staff member to {selectedLocation?.name}</h2>
          <p>
            Calendars show staff schedules for the selected location. Add the
            assignment in Staff details.
          </p>
        </section>
      ) : (
        <>
          {selected ? (
            <>
              {teamView ? (
                <section className="waybook-data-card waybook-week-calendar team-day-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>
                        {staffDayView ? "STAFF SCHEDULE · DAY" : null}
                        {!staffDayView ? <span className="waybook-calendar-toolbar__context is-standalone">{selectedLocation?.name} · {visibleTeamMembers.length} visible staff</span> : null}
                      </p>
                      <h2>{staffDayView ? `${selected.name}’s schedule` : calendarDate.format(new Date(`${teamDay}T12:00:00Z`))}</h2>
                      {staffDayView ? (
                        <span>
                          {`${calendarDate.format(new Date(`${teamDay}T12:00:00Z`))} · ${selectedLocation?.name}`}
                        </span>
                      ) : null}
                    </div>
                    <div className="waybook-calendar-toolbar__actions">
                      <details className="calendar-filter-panel">
                        <summary>Filters</summary>
                        <div className="calendar-filter-panel__content">
                          <CalendarSelectors
                            location={selectedLocation!}
                            members={members}
                            services={staffDayView ? services : calendarServices}
                            week={currentWeek}
                            teamMode={!staffDayView}
                          />
                          {!staffDayView ? <CalendarRosterControls includeOffShift={showOffShift === "1"} /> : null}
                          <p className="calendar-selectors__hint" id="calendar-search-hint">Type 2+ characters to search.</p>
                        </div>
                      </details>
                      {staffDayView ? <div className="calendar-view-toggle" aria-label="Calendar range"><Link href={href({ view: "day", day: teamDay })} aria-current="page">Day</Link><Link href={href({ view: "staff", day: undefined })}>Week</Link></div> : null}
                      <div className="waybook-calendar-date-nav" aria-label="Calendar date navigation">
                        <Link
                          href={href({
                            view: staffDayView ? "day" : "team",
                            day: previousWorkingDay,
                            week: weekStartFor(previousWorkingDay),
                          })}
                          aria-label="Previous day"
                        >
                          ←
                        </Link>
                        <span className="waybook-calendar-toolbar__date">
                          {teamNavigationLabel}
                        </span>
                        <Link
                          href={href({
                            view: staffDayView ? "day" : "team",
                            day: followingWorkingDay,
                            week: weekStartFor(followingWorkingDay),
                          })}
                          aria-label="Next day"
                        >
                          →
                        </Link>
                      </div>
                      {canManage && (staffDayView ? services : calendarServices).length && !isHistoricalTeamDay ? (
                        <Link
                          className="waybook-primary-link"
                          href={href({
                            view: staffDayView ? "day" : "team",
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
                      <div className="waybook-week-calendar__corner">Staff</div>
                      {Array.from({ length: teamRowCount }, (_, index) => <div className="team-day-calendar__time-header" key={`team-time-${index}`} style={{ gridColumn: index + 2, gridRow: 1 }}>{index % 2 === 0 ? `${String(Math.floor((teamGridStart + index * 30) / 60)).padStart(2, "0")}:00` : ""}</div>)}
                      {visibleTeamMembers.flatMap((member, memberIndex) => [
                        <div key={`staff-${member.id}`} className="team-day-calendar__staff" aria-label={member.name} style={{ gridColumn: 1, gridRow: memberIndex + 2 }}><i aria-hidden>{member.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</i><strong>{member.name}</strong></div>,
                        ...Array.from({ length: teamRowCount }, (_, index) => {
                          const time = `${String(Math.floor((teamGridStart + index * 30) / 60)).padStart(2, "0")}:${String((teamGridStart + index * 30) % 60).padStart(2, "0")}`;
                          const slotKey = `${member.id}|${teamDay}T${time}`;
                          const isBookable = bookableSlotKeys.has(slotKey);
                          // Historical schedules remain visible, but never
                          // masquerade as a staff/service availability error.
                          // The slot engine correctly refuses starts in the
                          // past; represent that as a quiet, read-only cell.
                          const isPastDate = teamDay < tenantToday;
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
                          return canManage && isBookable ? (
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
                                employee: staffDayView ? member.id : "",
                                view: staffDayView ? "day" : "team",
                                week: weekStartFor(teamDay),
                                day: teamDay,
                                service: serviceForBookableSlot.get(slotKey),
                                create: `${teamDay}T${time}`,
                                createStaff: staffDayView ? undefined : member.id,
                              })}
                              key={`${member.id}-${index}`}
                            />
                          ) : (
                            <div
                              className={`waybook-week-calendar__cell ${isPastDate ? "is-past" : isAppointmentConflict ? "is-appointment-conflict" : "is-unavailable"}`}
                              data-availability-state={isPastDate ? "past" : isAppointmentConflict ? "appointment-overlap" : "unavailable"}
                              {...(canManage && !isPastDate
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
                          key={booking.id}
                          href={href({
                            view: staffDayView ? "day" : "team",
                            week: weekStartFor(teamDay),
                            day: teamDay,
                            booking: booking.id,
                          })}
                          className={`waybook-week-calendar__entry is-booking is-booking--${booking.status}`}
                          data-calendar-service-id={booking.serviceId}
                          draggable={canManage}
                          style={teamPosition(booking)}
                        >
                          <strong>{booking.customerName}</strong>
                          <span className="waybook-calendar-entry__meta">
                            <span className="waybook-calendar-entry__time">{clock.format(booking.startsAt)}–{clock.format(booking.endsAt)}</span>
                            <em>{booking.status === "completed" ? "Done" : booking.status.replace("_", " ")}</em>
                          </span>
                          <span className="waybook-calendar-entry__service">{booking.serviceTitle}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                  {!staffDayView && (staffBefore || staffAfter || hasMoreMembers) ? (
                    <nav className="calendar-row-filter__more" aria-label="Staff roster window">
                      {staffBefore ? <Link className="waybook-secondary-link" href={href({ view: "team", before: members[0]?.id })}>Previous staff</Link> : null}
                      {hasMoreMembers ? <Link className="waybook-secondary-link" href={href({ view: "team", after: members.at(-1)?.id })}>Next staff</Link> : null}
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
                      <strong>No staff scheduled</strong>
                      <span>No staff are visible for {calendarDate.format(new Date(`${teamDay}T12:00:00Z`))}. Choose another day or include off-shift staff in Filters.</span>
                    </div>
                  )}
                </section>
              ) : (
                <section className="waybook-data-card waybook-week-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>STAFF SCHEDULE</p>
                      <h2>{selected.name}’s schedule</h2>
                      <span>
                        Confirmed bookings and live bookable periods in{" "}
                        {selectedLocation?.name} · {tenant.timezone}.
                      </span>
                    </div>
                    <div className="waybook-calendar-toolbar__actions">
                      <details className="calendar-filter-panel">
                        <summary>Filters</summary>
                        <div className="calendar-filter-panel__content">
                          <CalendarSelectors
                            location={selectedLocation!}
                            members={members}
                            services={services}
                            week={currentWeek}
                          />
                        </div>
                      </details>
                      <div className="calendar-view-toggle" aria-label="Calendar range">
                        <Link href={href({ view: "day", day: tenantToday })}>Day</Link>
                        <Link href={href({ view: "staff", day: undefined })} aria-current="page">Week</Link>
                      </div>
                      <div className="waybook-calendar-date-nav" aria-label="Calendar date navigation">
                        <Link
                          href={href({
                            view: "staff",
                            week: addDays(visibleWeekStart, -7),
                            day: undefined,
                          })}
                          aria-label="Previous week"
                        >
                          ←
                        </Link>
                        <span className="waybook-calendar-toolbar__date">
                          {staffNavigationLabel}
                        </span>
                        <Link
                          href={href({
                            view: "staff",
                            week: addDays(visibleWeekStart, 7),
                            day: undefined,
                          })}
                          aria-label="Next week"
                        >
                          →
                        </Link>
                      </div>
                      {canManage && services.length && hasCurrentOrFutureWeekDay ? (
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
                      Assign a service to this staff member at{" "}
                      {selectedLocation?.name} to calculate slots.
                    </p>
                  ) : null}
                  <div className="waybook-week-calendar__scroll">
                    <div
                      className="waybook-week-calendar__grid"
                      style={{
                        gridTemplateRows: `3rem repeat(${rowCount}, 2.65rem)`,
                      }}
                    >
                      <div className="waybook-week-calendar__corner">Time</div>
                      {days.map((day) => (
                        <div
                          key={day}
                          className="waybook-week-calendar__day"
                          data-availability-state={selectedBookableDays.has(day) ? "available" : "unavailable"}
                        >
                          <span>{calendarDate.format(new Date(`${day}T12:00:00Z`))}</span>
                          {day >= tenantToday && !selectedBookableDays.has(day) ? (
                            <small>No availability</small>
                          ) : null}
                        </div>
                      ))}
                      {Array.from({ length: rowCount }, (_, index) => [
                        <div
                          className="waybook-week-calendar__time"
                          key={`time-${index}`}
                          style={{ gridColumn: 1, gridRow: index + 2 }}
                        >
                          {index % 2 === 0
                            ? `${String(Math.floor((gridStart + index * 30) / 60)).padStart(2, "0")}:00`
                            : ""}
                        </div>,
                        ...days.map((day, dayIndex) => {
                          const time = `${String(Math.floor((gridStart + index * 30) / 60)).padStart(2, "0")}:${String((gridStart + index * 30) % 60).padStart(2, "0")}`;
                          const slotKey = `${selected?.id}|${day}T${time}`;
                          const isBookable = bookableSlotKeys.has(slotKey);
                          const isPastDate = day < tenantToday;
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
                          return canManage && services.length && isBookable ? (
                            <Link
                              className="waybook-week-calendar__cell is-actionable is-bookable"
                              data-availability-state="bookable"
                              data-calendar-drop-cell="true"
                              data-calendar-team-member-id={selected!.id}
                              data-calendar-starts-at={`${day}T${time}`}
                              data-calendar-service-ids={Array.from(servicesForBookableSlot.get(slotKey) ?? []).join(",")}
                              style={{ gridColumn: dayIndex + 2, gridRow: index + 2 }}
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
                              {...(canManage && !isPastDate
                                ? {
                                    "data-calendar-drop-cell": "true",
                                    "data-calendar-team-member-id": selected!.id,
                                    "data-calendar-starts-at": `${day}T${time}`,
                                  }
                                : {})}
                              aria-label={isPastDate ? "Past time" : isAppointmentConflict ? "Overlaps an existing appointment" : "Unavailable"}
                              key={`${day}-${index}`}
                              style={{ gridColumn: dayIndex + 2, gridRow: index + 2 }}
                            />
                          );
                        }),
                      ])}
                      {openPeriods.map((period) => (
                        <div
                          key={period.startTime}
                          className="waybook-week-calendar__entry is-open"
                          style={position(period)}
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
                          key={booking.id}
                          href={href({
                            view: "staff",
                            day: undefined,
                            booking: booking.id,
                          })}
                          className={`waybook-week-calendar__entry is-booking is-booking--${booking.status}`}
                          data-calendar-service-id={booking.serviceId}
                          draggable={canManage}
                          style={position({
                            startTime: booking.startsAt.toISOString(),
                            endTime: booking.endsAt.toISOString(),
                          })}
                        >
                          <strong>{booking.customerName}</strong>
                          <span className="waybook-calendar-entry__meta">
                            <span className="waybook-calendar-entry__time">{clock.format(booking.startsAt)}–{clock.format(booking.endsAt)}</span>
                            <em>{booking.status === "completed" ? "Done" : booking.status.replace("_", " ")}</em>
                          </span>
                          <span className="waybook-calendar-entry__service">{booking.serviceTitle}</span>
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
      {selectedBooking && selectedBookingMember ? (
        <div className="tenant-drawer-layer" role="presentation">
          <Link
            className="tenant-drawer-scrim"
            aria-hidden="true"
            tabIndex={-1}
            href={href({})}
          />
          <aside
            className="tenant-drawer appointment-drawer manual-appointment-drawer"
            aria-label={`Appointment with ${selectedBooking.customerName}`}
          >
            <header>
              <div>
                <p>APPOINTMENT</p>
                <h2>{selectedBooking.customerName}</h2>
              </div>
              <div className="appointment-drawer__header-actions">
                <Link
                  className="tenant-drawer-close"
                  aria-label="Close appointment"
                  href={href({})}
                >
                  ×
                </Link>
              </div>
            </header>
            <div className="appointment-drawer__body">
              <section className="appointment-drawer__details">
                <dl>
                  <div className="appointment-drawer__detail--status"><dt>Status</dt><dd>{selectedBooking.status.replace("_", " ")}</dd></div>
                  <div className="appointment-drawer__detail--date"><dt>Date</dt><dd>{calendarDate.format(selectedBooking.startsAt)}</dd></div>
                  <div className="appointment-drawer__detail--time"><dt>Time</dt><dd>{clock.format(selectedBooking.startsAt)}–{clock.format(selectedBooking.endsAt)}</dd></div>
                  <div><dt>Service</dt><dd>{selectedBooking.serviceTitle}</dd></div>
                  <div><dt>Staff</dt><dd>{selectedBookingMember.name}</dd></div>
                  <div><dt>Booking number</dt><dd>{selectedBooking.bookingNumber}</dd></div>
                </dl>
              </section>
              {canManage ? (
                <>
                  <AppointmentDrawerActions
                    key={selectedBooking.id}
                    bookingId={selectedBooking.id}
                    customerName={selectedBooking.customerName}
                    customerEmail={selectedBooking.customerEmail}
                    customerPhone={selectedBooking.customerPhone}
                    status={selectedBooking.status}
                    timezone={tenant.timezone}
                    days={rescheduleDays}
                    slots={rescheduleSlots}
                    saveDetails={updateBookingDetails}
                    reschedule={rescheduleBooking}
                    updateStatus={updateBookingStatus}
                    resourceId={selectedBooking.resourceId}
                    resources={eligibleResources}
                  />
                  {selectedBooking.status !== "cancelled" && selectedBooking.status !== "completed" ? <CancelAppointmentForm bookingId={selectedBooking.id} cancelAppointment={cancelAppointment} /> : null}
                </>
              ) : (
                <p className="tenant-drawer-note">
                  Read-only access: appointment changes require an owner or
                  manager.
                </p>
              )}
            </div>
          </aside>
        </div>
      ) : null}
      {requestedAppointment && (requestedCreateMember ?? selected) && services.length && canManage ? (
        <div className="tenant-drawer-layer" role="presentation">
          <Link
            className="tenant-drawer-scrim"
            aria-hidden="true"
            tabIndex={-1}
            href={href({})}
          />
          <aside
            className="tenant-drawer appointment-drawer"
            aria-label="New appointment"
          >
            <header>
              <div>
                <p>NEW APPOINTMENT</p>
                <h2>Create an appointment</h2>
                <span>
                  {(requestedCreateMember ?? selected).name} · {selectedLocation?.name} ·{" "}
                  {requestedAppointment.replace("T", " ")}
                </span>
              </div>
              <Link
                className="tenant-drawer-close"
                aria-label="Close new appointment"
                href={href({})}
              >
                ×
              </Link>
            </header>
            <div className="appointment-drawer__body">
              {selectedCustomer ? (
                <div className="appointment-drawer__summary">
                  <strong>{selectedCustomer.name}</strong>
                  <span>
                    Client details are prefilled from the selected profile.
                  </span>
                </div>
              ) : null}
              {manualService ? <ManualAppointmentForm
                initialLocation={selectedLocation!}
                initialMember={requestedCreateMember ?? selected}
                initialService={manualService}
                defaultDate={requestedAppointment.slice(0, 10)}
                defaultTime={requestedAppointment.slice(11)}
                timezone={tenant.timezone}
                customerName={selectedCustomer?.name}
                customerEmail={selectedCustomer?.email}
                customerPhone={selectedCustomer?.phone}
              /> : <p className="tenant-drawer-note">Choose a location with an active service before creating an appointment.</p>}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
