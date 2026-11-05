import Link from "next/link";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { CalendarSelectors } from "@/components/calendar-selectors";
import { AppointmentDrawerActions } from "@/components/appointment-drawer-actions";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { requireIdentity } from "@/lib/waybook/auth";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { requireFeature } from "@/lib/waybook/features";
import { logout } from "../../actions";
import { rescheduleBooking, updateBookingDetails, updateBookingStatus } from "./actions";

type Member = { id: string; name: string; email: string };
type Service = { id: string; title: string; durationMinutes: number };
type Booking = { id: string; bookingBlockId: string; serviceId: string; teamMemberId: string | null; startsAt: Date; endsAt: Date; status: string; customerName: string; customerEmail: string; customerPhone: string | null; serviceTitle: string };
type Slot = { startTime: string; endTime: string };
type ScheduleEntry = { startTime: string; endTime: string };

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStartFor(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return addDays(dateKey, -((date.getUTCDay() + 6) % 7));
}

function localMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? "0");
  return value("hour") * 60 + value("minute");
}

function mergeSlots(slots: Slot[]): ScheduleEntry[] {
  return [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime)).reduce<ScheduleEntry[]>((ranges, slot) => {
    const previous = ranges.at(-1);
    if (previous && new Date(previous.endTime).getTime() === new Date(slot.startTime).getTime()) previous.endTime = slot.endTime;
    else ranges.push({ ...slot });
    return ranges;
  }, []);
}

export default async function CalendarsPage({ searchParams }: { searchParams: Promise<{ employee?: string; service?: string; week?: string; booking?: string }> }) {
  const { employee, service, week, booking: bookingId } = await searchParams;
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const { tenant, membership } = await requireTenantWorkspace();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  await requireFeature(tenant.id, "calendars");
  const db = tenantDb(tenant);
  const members = await db<Member[]>`SELECT id, name, email FROM team_members WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY name`;
  const selected = members.find((member) => member.id === employee) ?? members[0];
  const currentWeek = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? weekStartFor(week!) : weekStartFor(localDateKey(new Date(), tenant.timezone));
  const days = Array.from({ length: 7 }, (_, index) => addDays(currentWeek, index));
  const rangeStart = fromZonedTime(`${currentWeek}T00:00:00`, tenant.timezone);
  const rangeEnd = fromZonedTime(`${addDays(currentWeek, 7)}T00:00:00`, tenant.timezone);
  const [services, bookings] = selected ? await Promise.all([
    db<Service[]>`SELECT s.id, s.title, s.duration_minutes AS "durationMinutes" FROM services s JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id WHERE s.tenant_id = ${tenant.id} AND stm.team_member_id = ${selected.id} AND s.is_active = TRUE ORDER BY s.title`,
    db<Booking[]>`SELECT b.id, b.booking_block_id AS "bookingBlockId", b.service_id AS "serviceId", b.team_member_id AS "teamMemberId", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle" FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id WHERE b.tenant_id = ${tenant.id} AND b.team_member_id = ${selected.id} AND b.starts_at >= ${rangeStart} AND b.starts_at < ${rangeEnd} AND b.status <> 'cancelled' ORDER BY b.starts_at ASC LIMIT 100`,
  ]) : [[], []] as [Service[], Booking[]];
  const selectedService = services.find((item) => item.id === service) ?? services[0];
  const availability = selected && selectedService ? await availableSlots(tenant, selectedService.id, new Date(rangeStart.getTime() - 86_400_000), new Date(rangeEnd.getTime() + 86_400_000)) : [];
  const slots = ((availability.find((item) => item.teamMemberId === selected?.id)?.slots ?? []) as Slot[]).filter((slot) => days.includes(localDateKey(new Date(slot.startTime), tenant.timezone)));
  const openPeriods = mergeSlots(slots);
  const allIntervals = [...openPeriods, ...bookings.map((booking) => ({ startTime: booking.startsAt.toISOString(), endTime: booking.endsAt.toISOString() }))];
  const earliest = Math.min(8 * 60, ...allIntervals.map((entry) => localMinutes(new Date(entry.startTime), tenant.timezone)));
  const latest = Math.max(18 * 60, ...allIntervals.map((entry) => localMinutes(new Date(entry.endTime), tenant.timezone)));
  const gridStart = Math.max(6 * 60, Math.floor(earliest / 60) * 60);
  const gridEnd = Math.min(22 * 60, Math.ceil(latest / 60) * 60);
  const rowCount = Math.max(1, (gridEnd - gridStart) / 30);
  const canManage = ["owner", "manager"].includes(membership.role);
  const selectedBooking = bookings.find((booking) => booking.id === bookingId) ?? null;
  const rescheduleDays = Array.from({ length: 7 }, (_, index) => addDays(localDateKey(new Date(), tenant.timezone), index));
  const rescheduleRangeStart = fromZonedTime(`${rescheduleDays[0]}T00:00:00`, tenant.timezone);
  const rescheduleRangeEnd = fromZonedTime(`${addDays(rescheduleDays.at(-1)!, 1)}T00:00:00`, tenant.timezone);
  const rescheduleAvailability = selectedBooking?.teamMemberId ? await availableSlots(tenant, selectedBooking.serviceId, new Date(rescheduleRangeStart.getTime() - 86_400_000), new Date(rescheduleRangeEnd.getTime() + 86_400_000), { excludeBookingBlockId: selectedBooking.bookingBlockId }) : [];
  const rescheduleSlots = (rescheduleAvailability.find((item) => item.teamMemberId === selectedBooking?.teamMemberId)?.slots ?? []).filter((slot) => rescheduleDays.includes(localDateKey(new Date(slot.startTime), tenant.timezone)));
  const calendarDate = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, weekday: "short", day: "numeric", month: "short" });
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit" });
  const href = (next: { employee?: string; service?: string; week?: string; booking?: string }) => {
    const params = new URLSearchParams({ employee: next.employee ?? selected?.id ?? "", service: next.service ?? selectedService?.id ?? "", week: next.week ?? currentWeek });
    if (next.booking) params.set("booking", next.booking);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params.toString()}`;
  };
  const position = (entry: ScheduleEntry) => {
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);
    const dayIndex = days.indexOf(localDateKey(start, tenant.timezone));
    const startMinutes = localMinutes(start, tenant.timezone);
    const endMinutes = localMinutes(end, tenant.timezone);
    return { gridColumn: dayIndex + 2, gridRow: `${2 + Math.floor((startMinutes - gridStart) / 30)} / span ${Math.max(1, Math.ceil((endMinutes - startMinutes) / 30))}` };
  };

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="calendars" />
    <header><div><p>CALENDARS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{tenant.timezone} · employee schedules affect live availability</span></div><form action={logout}><button>Sign out</button></form></header>
    {members.length === 0 ? <section className="waybook-data-card"><h2>Add a staff member first</h2><p>Calendars show staff schedules. Manage working hours and time off in Staff details.</p></section> : <>
      {selected ? <section className="waybook-data-card waybook-week-calendar"><div className="waybook-calendar-toolbar"><div><h2>{selected.name}’s schedule</h2><p>Confirmed bookings and live bookable periods in {tenant.timezone}.</p></div><div className="waybook-calendar-toolbar__actions"><Link href={href({ week: addDays(currentWeek, -7)})} aria-label="Previous week">←</Link><Link href={href({ week: weekStartFor(localDateKey(new Date(), tenant.timezone)) })}>Today</Link><Link href={href({ week: addDays(currentWeek, 7)})} aria-label="Next week">→</Link></div></div><CalendarSelectors members={members} services={services} employeeId={selected.id} serviceId={selectedService?.id} week={currentWeek} />{services.length === 0 ? <p className="waybook-permission-note">Assign a service to this staff member in Staff to calculate slots.</p> : null}{selectedService ? <div className="waybook-calendar-legend"><span><i className="is-booking" /> Received booking</span><span><i className="is-open" /> Bookable for {selectedService.title}</span></div> : null}<div className="waybook-week-calendar__scroll"><div className="waybook-week-calendar__grid" style={{ gridTemplateRows: `3rem repeat(${rowCount}, 2.65rem)` }}><div className="waybook-week-calendar__corner">Time</div>{days.map((day) => <div key={day} className="waybook-week-calendar__day">{calendarDate.format(new Date(`${day}T12:00:00Z`))}</div>)}{Array.from({ length: rowCount }, (_, index) => [<div className="waybook-week-calendar__time" key={`time-${index}`}>{index % 2 === 0 ? `${String(Math.floor((gridStart + index * 30) / 60)).padStart(2, "0")}:00` : ""}</div>, ...days.map((day) => <div className="waybook-week-calendar__cell" key={`${day}-${index}`} />)])}{openPeriods.map((period) => <div key={period.startTime} className="waybook-week-calendar__entry is-open" style={position(period)}><strong>Bookable</strong><span>{clock.format(new Date(period.startTime))}–{clock.format(new Date(period.endTime))}</span></div>)}{bookings.map((booking) => <Link key={booking.id} href={href({ booking: booking.id })} className="waybook-week-calendar__entry is-booking" style={position({ startTime: booking.startsAt.toISOString(), endTime: booking.endsAt.toISOString() })}><strong>{booking.customerName}</strong><span>{clock.format(booking.startsAt)}–{clock.format(booking.endsAt)} · {booking.serviceTitle}</span></Link>)}</div></div></section> : null}
    </>}
    {selectedBooking && selected ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close appointment" href={href({})} /><aside className="tenant-drawer appointment-drawer" aria-label={`Appointment with ${selectedBooking.customerName}`}><header><div><p>{selectedBooking.status.replace("_", " ")} APPOINTMENT</p><h2>{selectedBooking.customerName}</h2><span>{selectedBooking.serviceTitle} · {clock.format(selectedBooking.startsAt)}–{clock.format(selectedBooking.endsAt)}, {calendarDate.format(selectedBooking.startsAt)}</span></div><Link className="tenant-drawer-close" aria-label="Close appointment" href={href({})}>×</Link></header><div className="appointment-drawer__body"><div className="appointment-drawer__summary"><strong>{selectedBooking.serviceTitle}</strong><span>{selected.name} · {selectedBooking.customerEmail}</span></div>{canManage ? <><AppointmentDrawerActions bookingId={selectedBooking.id} customerName={selectedBooking.customerName} customerEmail={selectedBooking.customerEmail} customerPhone={selectedBooking.customerPhone} status={selectedBooking.status} timezone={tenant.timezone} days={rescheduleDays} slots={rescheduleSlots} saveDetails={updateBookingDetails} reschedule={rescheduleBooking} updateStatus={updateBookingStatus} />{selectedBooking.status !== "cancelled" ? <form action={updateBookingStatus} className="appointment-drawer__delete"><input type="hidden" name="bookingId" value={selectedBooking.id} /><input type="hidden" name="status" value="cancelled" /><button type="submit">Cancel appointment</button><small>Updates this booking’s status to Cancelled, releases the time, and retains its history and audit record.</small></form> : null}</> : <p className="tenant-drawer-note">Read-only access: appointment changes require an owner or manager.</p>}</div></aside></div> : null}
  </main>;
}
