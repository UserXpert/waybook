import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const calendarTimezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
const acceptedTimezones = new Set(calendarTimezones);

export function readCalendarTimezone(value: unknown) {
  return typeof value === "string" && acceptedTimezones.has(value) ? value : null;
}

export function calendarBookingTime(instant: Date, timezone: string) {
  const localTime = formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm");
  // A repeated local hour can represent two instants. The booking form can
  // express only the one that its server will resolve for this wall time.
  return +fromZonedTime(localTime, timezone) === +instant ? localTime : null;
}
