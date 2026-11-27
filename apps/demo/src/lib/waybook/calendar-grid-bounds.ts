import { calendarBookingInterval } from "./calendar-slot-time";
import { formatInTimeZone } from "date-fns-tz";

type CalendarInterval = { startTime: string; endTime: string };

function localMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? "0");
  return value("hour") * 60 + value("minute");
}

/** The selected staff member's configured schedule determines the canvas. If
 * there is no configured working interval (closed day, no rule), keep a
 * neutral 09:00–17:00 read-only fallback so the board never collapses. */
export function calendarGridBounds(
  workingIntervals: readonly CalendarInterval[],
  actualIntervals: readonly CalendarInterval[],
  timezone: string,
  { interval = calendarBookingInterval, start: startHour = null, end: endHour = null, bookings = [] }: {
    interval?: number;
    start?: number | null;
    end?: number | null;
    bookings?: readonly CalendarInterval[];
  } = {},
) {
  const intervals = [...workingIntervals, ...actualIntervals];
  const openingTimes = intervals.map((entry) => localMinutes(new Date(entry.startTime), timezone));
  const endMinute = (entry: CalendarInterval) => {
    const startTime = new Date(entry.startTime);
    const endTime = new Date(entry.endTime);
    const startMinutes = localMinutes(startTime, timezone);
    const endMinutes = localMinutes(endTime, timezone);
    if (endMinutes <= startMinutes && endTime > startTime) {
      if (formatInTimeZone(startTime, timezone, "yyyy-MM-dd") !== formatInTimeZone(endTime, timezone, "yyyy-MM-dd")) return 24 * 60;
      return startMinutes + interval;
    }
    return endMinutes;
  };
  const closingTimes = intervals.map(endMinute);
  const automaticStart = Math.floor(Math.min(...openingTimes, workingIntervals.length ? Infinity : 9 * 60) / 60) * 60;
  const automaticEnd = Math.ceil(Math.max(...closingTimes, workingIntervals.length ? -Infinity : 17 * 60) / 60) * 60;
  const [requestedStart, requestedEnd] = [startHour === null ? automaticStart : startHour * 60, endHour === null ? automaticEnd : endHour * 60];
  const start = Math.max(0, Math.min(requestedStart, requestedEnd - 60,
    ...bookings.map((entry) => Math.floor(localMinutes(new Date(entry.startTime), timezone) / 60) * 60)));
  const end = Math.min(24 * 60, Math.max(start + 60, requestedEnd,
    ...bookings.map((entry) => Math.ceil(endMinute(entry) / 60) * 60)));
  return { start, end, rowCount: (end - start) / interval };
}

/** Position within the whole time rail so starts and durations are independent of display density. */
export function calendarTimePosition(from: number, to: number, start: number, end: number) {
  const width = end - start;
  return {
    gridColumn: "2 / -1",
    marginInlineStart: `calc(${Math.max(0, from - start) / width * 100}% + 2px)`,
    marginInlineEnd: `calc(${Math.max(0, end - to) / width * 100}% + 2px)`,
  };
}
