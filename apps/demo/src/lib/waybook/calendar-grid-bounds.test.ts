import assert from "node:assert/strict";
import test from "node:test";
import { calendarGridBounds } from "./calendar-grid-bounds.ts";

test("calendar grid keeps a useful operating-day canvas when empty or narrow", () => {
  assert.deepEqual(calendarGridBounds([], "Europe/Copenhagen"), { start: 540, end: 1020, rowCount: 16 });
  assert.deepEqual(calendarGridBounds([
    { startTime: "2026-11-19T09:30:00Z", endTime: "2026-11-19T10:30:00Z" },
  ], "Europe/Copenhagen"), { start: 540, end: 1020, rowCount: 16 });
});

test("calendar grid widens for intervals outside operating hours in the tenant timezone", () => {
  assert.deepEqual(calendarGridBounds([
    // 07:15–08:15 in Los Angeles, not the browser's timezone.
    { startTime: "2026-11-19T15:15:00Z", endTime: "2026-11-19T16:15:00Z" },
  ], "America/Los_Angeles"), { start: 420, end: 1020, rowCount: 20 });
  assert.deepEqual(calendarGridBounds([
    { startTime: "2026-11-19T18:15:00Z", endTime: "2026-11-19T19:45:00Z" },
  ], "UTC"), { start: 540, end: 1200, rowCount: 22 });
});
