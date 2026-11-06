import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWeekValue, tenantWeekBounds } from "./today-command-centre.ts";

test("groups all booking states into seven Copenhagen-local value days", () => {
  const week = summarizeWeekValue([
    { startsAt: new Date("2026-11-02T09:00:00Z"), status: "confirmed", priceCents: 1_000 },
    { startsAt: new Date("2026-11-02T10:00:00Z"), status: "arrived", priceCents: 2_000 },
    { startsAt: new Date("2026-11-03T10:00:00Z"), status: "completed", priceCents: 3_000 },
    { startsAt: new Date("2026-11-03T11:00:00Z"), status: "cancelled", priceCents: 400 },
    { startsAt: new Date("2026-11-03T12:00:00Z"), status: "no_show", priceCents: 500 },
  ], "2026-11-02", "Europe/Copenhagen");
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days[0], { localDate: "2026-11-02", scheduledCents: 3_000, completedCents: 0, lostCents: 0, confirmedCents: 1_000, arrivedCents: 2_000, cancelledCents: 0, noShowCents: 0, scheduledCount: 2, completedCount: 0, lostCount: 0 });
  assert.deepEqual(week.totals, { scheduledCents: 3_000, completedCents: 3_000, lostCents: 900 });
  assert.equal(week.days[6]?.scheduledCents, 0);
});

test("keeps seven local dates across Copenhagen's spring DST week", () => {
  const bounds = tenantWeekBounds(new Date("2026-03-29T12:00:00Z"), "Europe/Copenhagen");
  assert.equal(bounds.weekStart, "2026-03-23");
  assert.equal(bounds.weekEnd, "2026-03-30");
  assert.equal(bounds.end.getTime() - bounds.start.getTime(), 167 * 60 * 60 * 1000);
});
