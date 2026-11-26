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
export type AppointmentAttendanceStage = "waiting_room" | "in_service" | "checking_out";

export const appointmentStageLabels: Record<AppointmentAttendanceStage, string> = {
  waiting_room: "Waiting room",
  in_service: "In service",
  checking_out: "Checking out",
};

export function activeAppointmentStage(status: string, stage: AppointmentAttendanceStage | null) {
  return status === "arrived" ? stage ?? "in_service" : null;
}
