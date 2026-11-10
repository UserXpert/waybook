import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAvailabilityRangeAllowed, isPublicBookingStartAllowed, isPublicSlotInRange, isServicePubliclyVisible } from "./public-booking-rules.ts";

test("public booking rejects started and distant appointments", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  assert.equal(isPublicBookingStartAllowed(new Date(now - 1), now), false);
  assert.equal(isPublicBookingStartAllowed(new Date(now), now), false);
  assert.equal(isPublicBookingStartAllowed(new Date(now + 1), now), true);
  assert.equal(isPublicBookingStartAllowed(new Date(now + 367 * 86_400_000), now), false);
});

test("public availability bounds requests and honors service visibility", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  assert.equal(isPublicAvailabilityRangeAllowed(new Date(now - 86_400_000), new Date(now + 2 * 86_400_000), now), true);
  assert.equal(isPublicAvailabilityRangeAllowed(new Date(now), new Date(now + 5 * 86_400_000), now), false);
  assert.equal(isServicePubliclyVisible("a", { visibleServiceIds: ["b"] }), false);
  assert.equal(isServicePubliclyVisible("a", { visibleServiceIds: [] }), false);
  assert.equal(isServicePubliclyVisible("a", { visibleServiceIds: ["a"] }), true);
  assert.equal(isServicePubliclyVisible("a", {}), true);
  assert.equal(isServicePubliclyVisible("a", { visibleServiceIds: '["a"]' }), false);
  const start = new Date(now + 86_400_000);
  const end = new Date(now + 2 * 86_400_000);
  assert.equal(isPublicSlotInRange({ startTime: start.toISOString(), endTime: new Date(start.getTime() + 3_600_000).toISOString() }, start, end, now), true);
  assert.equal(isPublicSlotInRange({ startTime: end.toISOString(), endTime: new Date(end.getTime() + 3_600_000).toISOString() }, start, end, now), false);
});
