import { fromZonedTime } from "date-fns-tz";

/** Calendar start times are local to the business, not the viewer. */
export function isPastCalendarSlot(day: string, time: string, timezone: string, now: Date): boolean {
  return fromZonedTime(`${day}T${time}:00`, timezone).getTime() <= now.getTime();
}
