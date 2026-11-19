export type LocationHours = { dayOfWeek: number; startTime: string; endTime: string };

export function localDateAndMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  return { localDate, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

/** True only when an entire appointment falls within configured local opening hours. */
export function isSlotWithinLocationHours(start: Date, end: Date, hours: LocationHours[], timezone: string) {
  const startLocal = localDateAndMinutes(start, timezone);
  const endLocal = localDateAndMinutes(end, timezone);
  if (startLocal.localDate !== endLocal.localDate) return false;
  const dayOfWeek = new Date(`${startLocal.localDate}T12:00:00Z`).getUTCDay();
  return hours.some((hour) => hour.dayOfWeek === dayOfWeek && startLocal.minutes >= Number(hour.startTime.slice(0, 2)) * 60 + Number(hour.startTime.slice(3, 5)) && endLocal.minutes <= Number(hour.endTime.slice(0, 2)) * 60 + Number(hour.endTime.slice(3, 5)));
}
