import assert from "node:assert/strict";
import test from "node:test";
import { isPastCalendarSlot } from "./calendar-slot-time.ts";

test("calendar uses the tenant timezone when classifying today and past days", () => {
  const now = new Date("2026-11-10T12:15:00Z"); // 13:15 in Copenhagen
  assert.equal(isPastCalendarSlot("2026-11-10", "13:00", "Europe/Copenhagen", now), true);
  assert.equal(isPastCalendarSlot("2026-11-10", "13:30", "Europe/Copenhagen", now), false);
  assert.equal(isPastCalendarSlot("2026-11-09", "16:00", "Europe/Copenhagen", now), true);
  assert.equal(isPastCalendarSlot("2026-11-11", "09:00", "Europe/Copenhagen", now), false);
});
