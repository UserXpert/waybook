import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMovableAppointmentStatus,
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
