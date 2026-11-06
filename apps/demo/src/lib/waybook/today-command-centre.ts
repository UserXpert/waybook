import { fromZonedTime } from "date-fns-tz";

export type TodayBooking = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "arrived" | "cancelled" | "completed" | "no_show";
  priceCents: number;
  customerName: string;
  serviceTitle: string;
  teamMemberId: string | null;
  teamMemberName: string | null;
};

export function tenantDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function tenantDayBounds(now: Date, timezone: string) {
  const localDate = tenantDateKey(now, timezone);
  const nextDate = new Date(`${localDate}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return {
    localDate,
    start: fromZonedTime(`${localDate}T00:00:00`, timezone),
    end: fromZonedTime(`${nextDate.toISOString().slice(0, 10)}T00:00:00`, timezone),
  };
}

export function weekStartForLocalDate(localDate: string) {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function addLocalDays(localDate: string, days: number) {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function tenantWeekBounds(now: Date, timezone: string) {
  const weekStart = weekStartForLocalDate(tenantDateKey(now, timezone));
  return {
    weekStart,
    weekEnd: addLocalDays(weekStart, 7),
    start: fromZonedTime(`${weekStart}T00:00:00`, timezone),
    end: fromZonedTime(`${addLocalDays(weekStart, 7)}T00:00:00`, timezone),
  };
}

export type WeeklyValueBooking = Pick<TodayBooking, "startsAt" | "status" | "priceCents">;
export type WeeklyValueDay = {
  localDate: string;
  scheduledCents: number;
  completedCents: number;
  lostCents: number;
  confirmedCents: number;
  arrivedCents: number;
  cancelledCents: number;
  noShowCents: number;
  scheduledCount: number;
  completedCount: number;
  lostCount: number;
};

export function summarizeWeekValue(bookings: WeeklyValueBooking[], weekStart: string, timezone: string) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    localDate: addLocalDays(weekStart, index), scheduledCents: 0, completedCents: 0, lostCents: 0,
    confirmedCents: 0, arrivedCents: 0, cancelledCents: 0, noShowCents: 0,
    scheduledCount: 0, completedCount: 0, lostCount: 0,
  }));
  const byDate = new Map(days.map((day) => [day.localDate, day]));
  for (const booking of bookings) {
    const day = byDate.get(tenantDateKey(booking.startsAt, timezone));
    if (!day) continue;
    if (booking.status === "confirmed") { day.scheduledCents += booking.priceCents; day.confirmedCents += booking.priceCents; day.scheduledCount += 1; }
    if (booking.status === "arrived") { day.scheduledCents += booking.priceCents; day.arrivedCents += booking.priceCents; day.scheduledCount += 1; }
    if (booking.status === "completed") { day.completedCents += booking.priceCents; day.completedCount += 1; }
    if (booking.status === "cancelled") { day.lostCents += booking.priceCents; day.cancelledCents += booking.priceCents; day.lostCount += 1; }
    if (booking.status === "no_show") { day.lostCents += booking.priceCents; day.noShowCents += booking.priceCents; day.lostCount += 1; }
  }
  const totals = days.reduce((total, day) => ({
    scheduledCents: total.scheduledCents + day.scheduledCents,
    completedCents: total.completedCents + day.completedCents,
    lostCents: total.lostCents + day.lostCents,
  }), { scheduledCents: 0, completedCents: 0, lostCents: 0 });
  return { days, totals };
}

export function summarizeToday(bookings: TodayBooking[]) {
  const count = (status: TodayBooking["status"]) => bookings.filter((booking) => booking.status === status).length;
  return {
    bookingCount: bookings.length,
    scheduledValueCents: bookings.filter((booking) => booking.status !== "cancelled").reduce((sum, booking) => sum + booking.priceCents, 0),
    arrivedCount: count("arrived"),
    completedCount: count("completed"),
    cancelledCount: count("cancelled"),
    noShowCount: count("no_show"),
    exceptions: bookings.filter((booking) => booking.status === "cancelled" || booking.status === "no_show"),
  };
}
