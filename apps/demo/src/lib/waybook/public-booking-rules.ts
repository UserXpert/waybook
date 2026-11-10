/** Public booking starts must be in the future and within the supported window. */
export function isPublicBookingStartAllowed(startsAt: Date, now = Date.now()): boolean {
  const start = startsAt.getTime();
  return Number.isFinite(start) && start > now && start <= now + 366 * 86_400_000;
}

export function isPublicAvailabilityRangeAllowed(start: Date, end: Date, now = Date.now()): boolean {
  const from = start.getTime();
  const to = end.getTime();
  return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 4 * 86_400_000 && from >= now - 2 * 86_400_000 && to <= now + 368 * 86_400_000;
}

export function isPublicSlotInRange(slot: { startTime: string; endTime: string }, start: Date, end: Date, now = Date.now()): boolean {
  const slotStart = new Date(slot.startTime);
  const slotEnd = new Date(slot.endTime);
  return isPublicBookingStartAllowed(slotStart, now) && slotStart >= start && slotEnd <= end && slotEnd > slotStart;
}

export function isServicePubliclyVisible(id: string, bookingPage: unknown): boolean {
  const value = typeof bookingPage === "string" ? parseBookingPage(bookingPage) : bookingPage;
  if (!value || typeof value !== "object") return true;
  const ids = (value as { visibleServiceIds?: unknown }).visibleServiceIds;
  // Missing settings retain the legacy default. Malformed configured values
  // must not accidentally make every service publicly bookable.
  return ids == null || (Array.isArray(ids) && ids.includes(id));
}

function parseBookingPage(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
