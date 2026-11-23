/** Statuses that still represent a live appointment on the calendar. */
export function isMovableAppointmentStatus(status: string) {
  return status === "confirmed" || status === "arrived";
}

export function assertMovableAppointmentStatus(status: string) {
  if (!isMovableAppointmentStatus(status)) {
    throw new Error("Only confirmed or arrived appointments can be moved.");
  }
}

/** A no-show correction records the outcome of an ended appointment. */
export function canChangeAttendanceNow(
  booking: { status: string; startsAt: Date; endsAt: Date },
  now = Date.now(),
) {
  const eligibleAt = booking.status === "no_show" ? booking.endsAt : booking.startsAt;
  return eligibleAt.getTime() <= now;
}
