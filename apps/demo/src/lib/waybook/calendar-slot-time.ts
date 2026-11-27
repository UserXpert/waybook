import { fromZonedTime } from "date-fns-tz";

export const calendarBookingInterval = 15;
export const calendarRosterWindowSize = 20;
export const maxCalendarMoveTargets = calendarRosterWindowSize * 24 * 60 / calendarBookingInterval;

/** Calendar start times are local to the business, not the viewer. */
export function isPastCalendarSlot(day: string, time: string, timezone: string, now: Date): boolean {
  return fromZonedTime(`${day}T${time}:00`, timezone).getTime() <= now.getTime();
}
