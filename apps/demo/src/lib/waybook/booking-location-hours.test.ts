import assert from "node:assert/strict";
import test from "node:test";
import { isSlotWithinLocationHours } from "./booking-location-hours.ts";

const copenhagen = "Europe/Copenhagen";
const sundayHours = [{ dayOfWeek: 0, startTime: "09:00", endTime: "17:00" }];

test("public booking respects Copenhagen opening-hour boundaries after spring DST", () => {
  // Copenhagen changes from UTC+1 to UTC+2 on 29 March 2026. 09:00 local is
  // therefore 07:00Z, rather than 08:00Z.
  assert.equal(isSlotWithinLocationHours(new Date("2026-03-29T07:00:00Z"), new Date("2026-03-29T08:00:00Z"), sundayHours, copenhagen), true);
  assert.equal(isSlotWithinLocationHours(new Date("2026-03-29T06:59:00Z"), new Date("2026-03-29T08:00:00Z"), sundayHours, copenhagen), false);
  assert.equal(isSlotWithinLocationHours(new Date("2026-03-29T14:00:00Z"), new Date("2026-03-29T15:00:00Z"), sundayHours, copenhagen), true);
  assert.equal(isSlotWithinLocationHours(new Date("2026-03-29T15:00:00Z"), new Date("2026-03-29T16:00:00Z"), sundayHours, copenhagen), false);
});

test("public booking respects Copenhagen opening-hour boundaries after autumn DST", () => {
  // Copenhagen returns to UTC+1 on 25 October 2026. 09:00 local is 08:00Z.
  assert.equal(isSlotWithinLocationHours(new Date("2026-10-25T08:00:00Z"), new Date("2026-10-25T09:00:00Z"), sundayHours, copenhagen), true);
  assert.equal(isSlotWithinLocationHours(new Date("2026-10-25T07:59:00Z"), new Date("2026-10-25T09:00:00Z"), sundayHours, copenhagen), false);
  assert.equal(isSlotWithinLocationHours(new Date("2026-10-25T15:00:00Z"), new Date("2026-10-25T16:00:00Z"), sundayHours, copenhagen), true);
  assert.equal(isSlotWithinLocationHours(new Date("2026-10-25T16:00:00Z"), new Date("2026-10-25T17:00:00Z"), sundayHours, copenhagen), false);
});
