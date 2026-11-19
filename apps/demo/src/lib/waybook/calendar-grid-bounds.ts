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
) {
  const defaultStart = 9 * 60;
  const defaultEnd = 17 * 60;
  if (!workingIntervals.length) {
    if (!actualIntervals.length) return { start: defaultStart, end: defaultEnd, rowCount: 16 };
    const earliest = Math.min(...actualIntervals.map((entry) => localMinutes(new Date(entry.startTime), timezone)));
    const latest = Math.max(...actualIntervals.map((entry) => localMinutes(new Date(entry.endTime), timezone)));
    const start = Math.max(0, Math.min(defaultStart, Math.floor(earliest / 60) * 60));
    const end = Math.min(24 * 60, Math.max(defaultEnd, Math.ceil(latest / 60) * 60));
    return { start, end, rowCount: Math.max(16, (end - start) / 30) };
  }

  const intervals = [...workingIntervals, ...actualIntervals];
  const earliest = Math.min(...intervals.map((entry) => localMinutes(new Date(entry.startTime), timezone)));
  const latest = Math.max(...intervals.map((entry) => localMinutes(new Date(entry.endTime), timezone)));
  const start = Math.max(0, Math.floor(earliest / 60) * 60);
  const end = Math.min(24 * 60, Math.max(start + 60, Math.ceil(latest / 60) * 60));
  return { start, end, rowCount: Math.max(2, (end - start) / 30) };
}
