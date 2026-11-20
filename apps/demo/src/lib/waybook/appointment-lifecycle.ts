/** Statuses that still represent a live appointment on the calendar. */
export function isMovableAppointmentStatus(status: string) {
  return status === "confirmed" || status === "arrived";
}

export function assertMovableAppointmentStatus(status: string) {
  if (!isMovableAppointmentStatus(status)) {
    throw new Error("Only confirmed or arrived appointments can be moved.");
  }
}
