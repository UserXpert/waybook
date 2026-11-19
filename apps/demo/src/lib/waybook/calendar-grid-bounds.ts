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

/** A sparse day should still read like an operational calendar. Keep 09:00–17:00
 * visible, while widening the canvas only for real earlier or later intervals. */
export function calendarGridBounds(intervals: readonly CalendarInterval[], timezone: string) {
  const defaultStart = 9 * 60;
  const defaultEnd = 17 * 60;
  if (!intervals.length) return { start: defaultStart, end: defaultEnd, rowCount: 16 };

  const earliest = Math.min(...intervals.map((entry) => localMinutes(new Date(entry.startTime), timezone)));
  const latest = Math.max(...intervals.map((entry) => localMinutes(new Date(entry.endTime), timezone)));
  const start = Math.max(0, Math.min(defaultStart, Math.floor(earliest / 60) * 60));
  const end = Math.min(24 * 60, Math.max(defaultEnd, Math.ceil(latest / 60) * 60));
  return { start, end, rowCount: Math.max(16, (end - start) / 30) };
}
