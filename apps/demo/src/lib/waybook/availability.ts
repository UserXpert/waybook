import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import * as recurrence from "rrule";

// Next bundles the ESM entry; plain Node loads the CommonJS package.
const recurrenceLibrary = typeof recurrence.rrulestr === "function"
  ? recurrence
  : Reflect.get(recurrence, "default") as typeof recurrence;

export type ScheduleRule = {
  rrule: string;
  startTime: string;
  endTime: string;
  timezone: string;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
};

export type ScheduleOverride = {
  date: Date;
  startTime?: string | null;
  endTime?: string | null;
  isUnavailable: boolean;
};

export type OccupiedInterval = { startsAt: Date; endsAt: Date };

type TimeWindow = { start: number; end: number };
type SlotOptions = { duration: number; slotInterval?: number; alignToClock?: boolean; now?: Date };

const minute = 60_000;
const day = 24 * 60 * minute;

function civilDate(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString().slice(0, 10) : value.toISOString().slice(0, 10);
}

function dateOffset(date: string, days: number): string {
  return new Date(Date.parse(date) + days * day).toISOString().slice(0, 10);
}

function clockTime(date: string, time: string, timezone: string): number {
  if (time === "24:00") return clockTime(dateOffset(date, 1), "00:00", timezone);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid schedule time.");
  const instant = +fromZonedTime(`${date}T${time}:00`, timezone);
  if (!Number.isFinite(instant)) throw new Error("Invalid schedule timezone.");
  return instant;
}

function workingWindow(date: string, start: string, end: string, timezone: string): TimeWindow {
  return {
    start: clockTime(date, start, timezone),
    end: clockTime(end < start ? dateOffset(date, 1) : date, end, timezone),
  };
}

function overlaps(left: TimeWindow, right: TimeWindow): boolean {
  return left.start < right.end && right.start < left.end;
}

function cutWindow(window: TimeWindow, cut: TimeWindow): TimeWindow[] {
  if (!overlaps(window, cut)) return [window];
  const parts: TimeWindow[] = [];
  if (window.start < cut.start) parts.push({ start: window.start, end: cut.start });
  if (cut.end < window.end) parts.push({ start: cut.end, end: window.end });
  return parts;
}

function expandRule(rule: ScheduleRule, range: { start: Date; end: Date }): TimeWindow[] {
  // RRULE is evaluated on a civil-date axis. Convert shift endpoints to real
  // instants afterward so spring gaps and repeated autumn hours use real time.
  const firstDate = formatInTimeZone(range.start, rule.timezone, "yyyy-MM-dd");
  const lastDate = formatInTimeZone(range.end, rule.timezone, "yyyy-MM-dd");
  const previousDay = dateOffset(firstDate, -1);
  const validFrom = rule.validFrom ? civilDate(rule.validFrom) : null;
  const validUntil = rule.validUntil ? civilDate(rule.validUntil) : null;
  const firstOccurrence = validFrom && validFrom > previousDay ? validFrom : previousDay;
  const lastOccurrence = validUntil && validUntil < lastDate ? validUntil : lastDate;
  if (firstOccurrence > lastOccurrence) return [];

  const schedule = recurrenceLibrary.rrulestr(rule.rrule, {
    dtstart: new Date(validFrom ?? previousDay),
    unfold: true,
  });
  const recurrenceRules = "rrules" in schedule ? [...schedule.rrules(), ...schedule.exrules()] : [schedule];
  for (const { options } of recurrenceRules) {
    const clockCombinations = (options.byhour?.length ?? 1) * (options.byminute?.length ?? 1) * (options.bysecond?.length ?? 1);
    if (options.freq > recurrenceLibrary.RRule.DAILY || !Number.isSafeInteger(options.interval) ||
        options.interval < 1 || clockCombinations > 24) {
      throw new Error("Working schedules must recur by calendar date.");
    }
  }
  const first = Date.parse(firstOccurrence);
  const last = Date.parse(lastOccurrence) + day - 1;
  const limit = 24 * (Math.floor((last - first) / day) + 1);
  const occurrences = schedule.between(new Date(first), new Date(last), true, (_, index) => {
    if (index >= limit) throw new Error("Working schedule has too many occurrences.");
    return true;
  });
  // A recurrence can identify the same working date more than once.
  return [...new Set(occurrences.map(civilDate))]
    .map((date) => workingWindow(date, rule.startTime, rule.endTime, rule.timezone));
}

/** Calculates slots for one staff member. Persisted booking blocks reserve their exact intervals. */
export function calculateStaffSlots(
  rules: ScheduleRule[],
  overrides: ScheduleOverride[],
  occupied: OccupiedInterval[],
  range: { start: Date; end: Date },
  timezone: string,
  options: SlotOptions,
) {
  const duration = options.duration * minute;
  const interval = (options.slotInterval ?? options.duration) * minute;
  const now = +(options.now ?? new Date());
  const lower = +range.start;
  const upper = +range.end;
  if (![duration, interval].every(Number.isSafeInteger) || ![now, lower, upper].every(Number.isFinite) || duration <= 0 || interval <= 0 || upper <= lower) {
    throw new Error("Invalid availability range or slot size.");
  }

  let windows = rules.flatMap((rule) => expandRule(rule, range));
  for (const override of overrides) {
    const date = civilDate(override.date);
    const custom = override.startTime && override.endTime
      ? workingWindow(date, override.startTime, override.endTime, timezone)
      : null;
    const wholeDay = { start: clockTime(date, "00:00", timezone), end: clockTime(dateOffset(date, 1), "00:00", timezone) };
    if (override.isUnavailable) {
      windows = windows.flatMap((window) => cutWindow(window, custom ?? wholeDay));
    } else if (custom) {
      windows = windows.flatMap((window) => cutWindow(window, wholeDay));
      windows.push(custom);
    }
  }

  const blocks = occupied.map(({ startsAt, endsAt }) => ({ start: +startsAt, end: +endsAt }));
  const slots = new Map<number, TimeWindow>();
  for (const window of windows) {
    const offset = options.alignToClock ? Number(formatInTimeZone(window.start, timezone, "mm")) * minute
      + Number(formatInTimeZone(window.start, timezone, "ss")) * 1000 : 0;
    const anchor = window.start - offset;
    const first = anchor + Math.ceil((Math.max(lower, now - duration, window.start) - anchor) / interval) * interval;
    const last = Math.min(window.end, upper) - duration;
    for (let start = first; start <= last; start += interval) {
      const slot = { start, end: start + duration };
      if (!slots.has(start) && !blocks.some((block) => overlaps(slot, block))) slots.set(start, slot);
    }
  }

  return [...slots.values()].sort((a, b) => a.start - b.start).map(({ start, end }) => ({
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    localStart: formatInTimeZone(start, timezone, "yyyy-MM-dd'T'HH:mm:ss"),
    localEnd: formatInTimeZone(end, timezone, "yyyy-MM-dd'T'HH:mm:ss"),
  }));
}
