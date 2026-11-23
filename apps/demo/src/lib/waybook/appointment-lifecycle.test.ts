import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMovableAppointmentStatus, canChangeAttendanceNow,
  isMovableAppointmentStatus,
} from "./appointment-lifecycle";

test("only live appointment statuses can move", () => {
  assert.equal(isMovableAppointmentStatus("confirmed"), true);
  assert.equal(isMovableAppointmentStatus("arrived"), true);
  for (const status of ["completed", "cancelled", "no_show", "pending"]) {
    assert.equal(isMovableAppointmentStatus(status), false, status);
    assert.throws(() => assertMovableAppointmentStatus(status), /confirmed or arrived/);
  }
});

test("a terminal status re-read after preflight prevents a move", () => {
  // The write transactions call this after taking the booking-block then booking locks.
  // This models a status transition that happened after the UI preflight was accepted.
  assert.equal(isMovableAppointmentStatus("confirmed"), true);
  assert.throws(() => assertMovableAppointmentStatus("no_show"), /confirmed or arrived/);
});

test("attendance starts at the booking boundary and no-show corrections start at the end", () => {
  const startsAt = new Date("2026-11-20T08:00:00Z");
  const endsAt = new Date("2026-11-20T09:00:00Z");
  const confirmed = { status: "confirmed", startsAt, endsAt };
  const noShow = { ...confirmed, status: "no_show" };
  assert.equal(canChangeAttendanceNow(confirmed, startsAt.getTime() - 1), false);
  assert.equal(canChangeAttendanceNow(confirmed, startsAt.getTime()), true);
  assert.equal(canChangeAttendanceNow(noShow, endsAt.getTime() - 1), false);
  assert.equal(canChangeAttendanceNow(noShow, endsAt.getTime()), true);
});
