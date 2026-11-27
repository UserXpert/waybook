import { cookies } from "next/headers";

const oneYear = 365 * 24 * 60 * 60;
export const calendarDisplayIntervals = [15, 30] as const;
type CalendarInterval = typeof calendarDisplayIntervals[number];
type CalendarDisplay = {
  interval: CalendarInterval;
  start: number | null;
  end: number | null;
  showNow: boolean;
  showWeekends: boolean;
  autofillLatestService: boolean;
};

function cookieName(tenantId: string) {
  return `waybook-calendar-${tenantId}`;
}

function hour(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function readDisplay(value: unknown): CalendarDisplay {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const start = hour(data.start, 0, 23);
  const end = hour(data.end, 1, 24);
  const invalidHours = start !== null && end !== null && start >= end;
  return {
    interval: data.interval === 30 ? 30 : 15,
    start: invalidHours ? null : start,
    end: invalidHours ? null : end,
    showNow: data.showNow !== false,
    showWeekends: data.showWeekends !== false,
    autofillLatestService: data.autofillLatestService === true,
  };
}

export async function getCalendarDisplay(tenantId: string) {
  const saved = (await cookies()).get(cookieName(tenantId))?.value;
  try {
    return readDisplay(saved ? JSON.parse(saved) : null);
  } catch {
    return readDisplay(null);
  }
}

export async function setCalendarDisplay(tenantId: string, form: FormData) {
  const start = form.get("start");
  const end = form.get("end");
  if (start && end && Number(start) >= Number(end)) return false;
  const settings = readDisplay({
    interval: Number(form.get("interval")),
    start: start ? Number(start) : null,
    end: end ? Number(end) : null,
    showNow: form.has("showNow"),
    showWeekends: form.has("showWeekends"),
    autofillLatestService: form.has("autofillLatestService"),
  });
  (await cookies()).set(cookieName(tenantId), JSON.stringify(settings), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: oneYear,
  });
  return true;
}
