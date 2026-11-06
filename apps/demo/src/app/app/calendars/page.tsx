import Link from "next/link";
import { fromZonedTime } from "date-fns-tz";
import { CalendarSelectors } from "@/components/calendar-selectors";
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
  serviceId: string;
  teamMemberId: string | null;
  locationId: string | null;
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
  const locations = await db<
    Location[]
  >`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`;
  const selectedLocation =
    locations.find((item) => item.id === location) ?? locations[0];
  const [manualMembers, manualServices, manualAssignments, locationWorkingDays] = await Promise.all([
    db<Member[]>`SELECT id, name, email, calendar_color AS "calendarColor" FROM team_members WHERE tenant_id = ${tenant.id} AND is_active = TRUE ${canViewTeam ? db`` : db`AND id = ${restrictedEmployeeId}`} ORDER BY name`,
    db<Service[]>`SELECT id, title, duration_minutes AS "durationMinutes" FROM services WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY title`,
    db<ManualAssignment[]>`SELECT stm.team_member_id AS "teamMemberId", stm.service_id AS "serviceId", tml.location_id AS "locationId" FROM service_team_members stm JOIN team_member_locations tml ON tml.tenant_id = stm.tenant_id AND tml.team_member_id = stm.team_member_id JOIN service_locations sl ON sl.tenant_id = stm.tenant_id AND sl.service_id = stm.service_id AND sl.location_id = tml.location_id WHERE stm.tenant_id = ${tenant.id}`,
    selectedLocation
      ? db<{ dayOfWeek: number }[]>`SELECT day_of_week AS "dayOfWeek" FROM location_hours WHERE tenant_id = ${tenant.id} AND location_id = ${selectedLocation.id} ORDER BY day_of_week`
      : Promise.resolve([] as { dayOfWeek: number }[]),
  ]);
  const members = selectedLocation
    ? await db<
        Member[]
      >`SELECT tm.id, tm.name, tm.email, tm.calendar_color AS "calendarColor" FROM team_members tm JOIN team_member_locations tml ON tml.team_member_id = tm.id AND tml.tenant_id = tm.tenant_id WHERE tm.tenant_id = ${tenant.id} AND tm.is_active = TRUE AND tml.location_id = ${selectedLocation.id} ${canViewTeam ? db`` : db`AND tm.id = ${restrictedEmployeeId}`} ORDER BY tm.name`
    : [];
  const selected =
    members.find((member) => member.id === effectiveEmployee) ?? members[0];
  const selectedStaffBookingColor = selected?.calendarColor ?? "#67c7cf";
  const [selectedCustomer] = customerId
    ? await db<
        Customer[]
      >`SELECT id, name, email, phone FROM customers WHERE tenant_id = ${tenant.id} AND id = ${customerId} LIMIT 1`
    : [];
  const tenantToday = localDateKey(new Date(), tenant.timezone);
  // Calendar scope and calendar mode are one decision: the whole team works
  // the selected day, while an individual staff selection opens that person's week.
  const teamView =
    !effectiveEmployee || !members.some((member) => member.id === effectiveEmployee);
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
  const rangeStart = fromZonedTime(`${currentWeek}T00:00:00`, tenant.timezone);
  const rangeEnd = fromZonedTime(
    `${addDays(currentWeek, 7)}T00:00:00`,
    tenant.timezone,
  );
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
          >`SELECT b.id, b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle" FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id LEFT JOIN resources r ON r.id=b.resource_id AND r.tenant_id=b.tenant_id WHERE b.tenant_id = ${tenant.id} AND b.location_id = ${selectedLocation.id} AND b.team_member_id = ${selected.id} AND b.starts_at >= ${rangeStart} AND b.starts_at < ${rangeEnd} AND b.status <> 'cancelled' ORDER BY b.starts_at ASC LIMIT 100`,
          db<
            TeamBooking[]
          >`SELECT b.id, b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle", tm.name AS "teamMemberName", tm.calendar_color AS "teamMemberColor" FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id LEFT JOIN resources r ON r.id=b.resource_id AND r.tenant_id=b.tenant_id WHERE b.tenant_id = ${tenant.id} AND b.location_id = ${selectedLocation.id} AND b.team_member_id = ANY(${members.map((member) => member.id)}) AND b.starts_at >= ${rangeStart} AND b.starts_at < ${rangeEnd} AND b.status <> 'cancelled' ORDER BY b.starts_at ASC LIMIT 300`,
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
      SELECT b.id, b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.location_id AS "locationId", r.name AS "resourceName", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status,
        c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle"
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN resources r ON r.id=b.resource_id AND r.tenant_id=b.tenant_id
      WHERE b.tenant_id = ${tenant.id} AND b.id = ${bookingId} AND b.location_id = ${selectedLocation.id} ${canViewTeam ? db`` : db`AND b.team_member_id = ${restrictedEmployeeId}`}
      LIMIT 1
    `
        )[0] ??
        null)
      : null;
  const selectedBookingMember = selectedBooking
    ? members.find((member) => member.id === selectedBooking.teamMemberId) ?? null
    : null;
  const selectableServices = teamView ? calendarServices : services;
  const selectedService = service
    ? selectableServices.find((item) => item.id === service)
    : undefined;
  // "All services" is an availability union. Each actionable calendar cell
  // carries the compatible service into the create drawer below.
  const availabilityServices = selectedService
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
  const rescheduleRangeStart = fromZonedTime(
    `${rescheduleDays[0]}T00:00:00`,
    tenant.timezone,
  );
  const rescheduleRangeEnd = fromZonedTime(
    `${addDays(rescheduleDays.at(-1)!, 1)}T00:00:00`,
    tenant.timezone,
  );
  const rescheduleAvailability =
    selectedBooking?.teamMemberId && selectedBooking.locationId
      ? await availableSlots(
          tenant,
          selectedBooking.serviceId,
          new Date(rescheduleRangeStart.getTime() - 86_400_000),
          new Date(rescheduleRangeEnd.getTime() + 86_400_000),
          {
            excludeBookingBlockId: selectedBooking.bookingBlockId,
            locationId: selectedBooking.locationId,
            slotInterval: 30,
            durationMinutes: Math.round(
              (selectedBooking.endsAt.getTime() - selectedBooking.startsAt.getTime()) /
                60_000,
            ),
          },
        )
      : [];
  const rescheduleSlots = (
    rescheduleAvailability.find(
      (item) => item.teamMemberId === selectedBooking?.teamMemberId,
    )?.slots ?? []
  ).filter((slot) =>
    rescheduleDays.includes(
      localDateKey(new Date(slot.startTime), tenant.timezone),
    ),
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
    view?: "staff" | "team";
    booking?: string;
    create?: string;
    customer?: string;
  }) => {
    const nextView = next.view ?? (teamView ? "team" : "staff");
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
    if (nextView === "team") params.set("view", "team");
    if (next.day ?? (teamView ? teamDay : undefined))
      params.set("day", next.day ?? teamDay);
    if (next.booking) params.set("booking", next.booking);
    if (next.create) params.set("create", next.create);
    if (next.customer ?? selectedCustomer?.id)
      params.set("customer", next.customer ?? selectedCustomer!.id);
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
    (booking) => localDateKey(booking.startsAt, tenant.timezone) === teamDay,
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
    gridColumn:
      members.findIndex((member) => member.id === booking.teamMemberId) + 2,
    gridRow: `${2 + Math.floor((localMinutes(booking.startsAt, tenant.timezone) - teamGridStart) / 30)} / span ${Math.max(1, Math.ceil((localMinutes(booking.endsAt, tenant.timezone) - localMinutes(booking.startsAt, tenant.timezone)) / 30))}`,
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
      {canManage ? (
        <CalendarBookingDragDrop />
      ) : null}
      <style>{`.tenant-dashboard-page .waybook-week-calendar:not(.team-day-calendar) .waybook-week-calendar__entry.is-booking { border-left-color: ${selectedStaffBookingColor} !important; }`}</style>
      {locations.length === 0 ? (
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
                      <p>TEAM SCHEDULE · DAY</p>
                      <h2>
                        {calendarDate.format(new Date(`${teamDay}T12:00:00Z`))}
                      </h2>
                      <span>
                        {isHistoricalTeamDay
                          ? `${selectedLocation?.name} · historical schedule · appointments cannot be added before ${calendarDate.format(new Date(`${tenantToday}T12:00:00Z`))}.`
                          : `${selectedLocation?.name} · ${members.length} active staff · click a time cell to begin an appointment.`}
                      </span>
                    </div>
                    <CalendarSelectors
                      locations={locations}
                      locationId={selectedLocation!.id}
                      members={members}
                      services={calendarServices}
                      employeeId={selected.id}
                      serviceId={service}
                      week={currentWeek}
                    />
                    <div className="waybook-calendar-toolbar__actions">
                      <Link
                        href={href({
                          view: "team",
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
                          view: "team",
                          day: followingWorkingDay,
                          week: weekStartFor(followingWorkingDay),
                        })}
                        aria-label="Next day"
                      >
                        →
                      </Link>
                      {canManage && calendarServices.length && !isHistoricalTeamDay ? (
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
                  <div className="waybook-week-calendar__scroll">
                    <div
                      className="waybook-week-calendar__grid team-day-calendar__grid"
                      style={{
                        gridTemplateColumns: `3.6rem repeat(${members.length}, minmax(0, 1fr))`,
                        gridTemplateRows: `3rem repeat(${teamRowCount}, 2.65rem)`,
                      }}
                    >
                      <div className="waybook-week-calendar__corner">Time</div>
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="waybook-week-calendar__day"
                        >
                          <i aria-hidden>
                            {member.name
                              .split(/\s+/)
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </i>
                          <strong>{member.name}</strong>
                        </div>
                      ))}
                      {Array.from({ length: teamRowCount }, (_, index) => [
                        <div
                          className="waybook-week-calendar__time"
                          key={`team-time-${index}`}
                          style={{ gridColumn: 1, gridRow: index + 2 }}
                        >
                          {index % 2 === 0
                            ? `${String(Math.floor((teamGridStart + index * 30) / 60)).padStart(2, "0")}:00`
                            : ""}
                        </div>,
                        ...members.map((member, memberIndex) => {
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
                              style={{ gridColumn: memberIndex + 2, gridRow: index + 2 }}
                              aria-label={`New appointment ${member.name} ${teamDay} ${time}`}
                              href={href({
                                employee: member.id,
                                view: "staff",
                                week: weekStartFor(teamDay),
                                day: undefined,
                                service: serviceForBookableSlot.get(slotKey),
                                create: `${teamDay}T${time}`,
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
                              style={{ gridColumn: memberIndex + 2, gridRow: index + 2 }}
                            />
                          );
                        }),
                      ])}
                      {teamDayBookings.map((booking) => (
                        <Link
                          key={booking.id}
                          href={href({
                            view: "team",
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
                          <span>
                            {clock.format(booking.startsAt)}–
                            {clock.format(booking.endsAt)} ·{" "}
                            {booking.serviceTitle}
                          </span>
                          {booking.status === "completed" ? <em>Done</em> : null}
                        </Link>
                      ))}
                    </div>
                  </div>
                  {calendarServices.length ? (
                    <div className="waybook-calendar-legend" aria-label="Calendar availability legend">
                      <span><i className="is-booking" aria-hidden="true" /> Received booking</span>
                      <span><i className="is-bookable" aria-hidden="true" /> {selectedService ? `Bookable for ${selectedService.title}` : "Bookable for any assigned service"}</span>
                      <span><i className="is-unavailable" aria-hidden="true" /> Unavailable</span>
                      <span><i className="is-past" aria-hidden="true" /> Past</span>
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="waybook-data-card waybook-week-calendar">
                  <div className="waybook-calendar-toolbar">
                    <div>
                      <p>STAFF SCHEDULE · WEEK</p>
                      <h2>{selected.name}’s schedule</h2>
                      <span>
                        Confirmed bookings and live bookable periods in{" "}
                        {selectedLocation?.name} · {tenant.timezone}.
                      </span>
                    </div>
                    <CalendarSelectors
                      locations={locations}
                      locationId={selectedLocation!.id}
                      members={members}
                      services={calendarServices}
                      employeeId={selected.id}
                      serviceId={service}
                      week={currentWeek}
                    />
                    <div className="waybook-calendar-toolbar__actions">
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
                          <span>
                            {clock.format(booking.startsAt)}–
                            {clock.format(booking.endsAt)} ·{" "}
                            {booking.serviceTitle}
                          </span>
                          {booking.status === "completed" ? <em>Done</em> : null}
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
            className="tenant-drawer appointment-drawer"
            aria-label={`Appointment with ${selectedBooking.customerName}`}
          >
            <header>
              <div>
                <p>{selectedBooking.status.replace("_", " ")} APPOINTMENT</p>
                <h2>{selectedBooking.customerName}</h2>
                <span>
                  {selectedBooking.serviceTitle} ·{" "}
                  {clock.format(selectedBooking.startsAt)}–
                  {clock.format(selectedBooking.endsAt)},{" "}
                  {calendarDate.format(selectedBooking.startsAt)}
                </span>
              </div>
              <div className="appointment-drawer__header-actions">
                {canManage && selectedBooking.status === "confirmed" ? (
                  <form action={updateBookingStatus}>
                    <input
                      type="hidden"
                      name="bookingId"
                      value={selectedBooking.id}
                    />
                    <input type="hidden" name="status" value="arrived" />
                    <button type="submit">Check in</button>
                  </form>
                ) : null}
                {canManage && selectedBooking.status === "arrived" ? (
                  <form action={updateBookingStatus}>
                    <input
                      type="hidden"
                      name="bookingId"
                      value={selectedBooking.id}
                    />
                    <input type="hidden" name="status" value="completed" />
                    <button type="submit">Complete</button>
                  </form>
                ) : null}
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
              <div className="appointment-drawer__summary">
                <strong>{selectedBooking.serviceTitle}</strong>
                <span>
                  {selectedBookingMember.name} ·{" "}
                  {selectedBooking.resourceName
                    ? selectedBooking.resourceName + " · "
                    : ""}
                  {selectedBooking.customerEmail}
                </span>
              </div>
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
      {requestedAppointment && selected && services.length && canManage ? (
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
                  {selected.name} · {selectedLocation?.name} ·{" "}
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
              <ManualAppointmentForm
                locations={locations}
                members={manualMembers}
                services={manualServices}
                assignments={manualAssignments}
                locationId={selectedLocation!.id}
                teamMemberId={selected.id}
                serviceId={(selectedService ?? services[0]).id}
                defaultDate={requestedAppointment.slice(0, 10)}
                defaultTime={requestedAppointment.slice(11)}
                timezone={tenant.timezone}
                customerName={selectedCustomer?.name}
                customerEmail={selectedCustomer?.email}
                customerPhone={selectedCustomer?.phone}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
