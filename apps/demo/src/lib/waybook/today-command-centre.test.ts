import assert from "node:assert/strict";
import test from "node:test";
import { summarizeToday, tenantDayBounds, weekStartForLocalDate } from "./today-command-centre.ts";

test("uses Copenhagen local-day bounds across the spring DST transition", () => {
  const bounds = tenantDayBounds(new Date("2026-03-29T12:00:00Z"), "Europe/Copenhagen");
  assert.equal(bounds.localDate, "2026-03-29");
  assert.equal(bounds.start.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(bounds.end.getTime() - bounds.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(weekStartForLocalDate(bounds.localDate), "2026-03-23");
});

test("summarizes persisted appointment states without treating cancellations as value", () => {
  const summary = summarizeToday([
    { id: "confirmed", startsAt: new Date(), endsAt: new Date(), status: "confirmed", priceCents: 1_000, customerName: "Ada", serviceTitle: "Cut", teamMemberId: "staff-1", teamMemberName: "Ann" },
    { id: "arrived", startsAt: new Date(), endsAt: new Date(), status: "arrived", priceCents: 2_000, customerName: "Bea", serviceTitle: "Colour", teamMemberId: "staff-1", teamMemberName: "Ann" },
    { id: "cancelled", startsAt: new Date(), endsAt: new Date(), status: "cancelled", priceCents: 3_000, customerName: "Cal", serviceTitle: "Style", teamMemberId: "staff-2", teamMemberName: "Cam" },
    { id: "no-show", startsAt: new Date(), endsAt: new Date(), status: "no_show", priceCents: 4_000, customerName: "Dee", serviceTitle: "Trim", teamMemberId: "staff-2", teamMemberName: "Cam" },
  ]);
  assert.deepEqual(summary, { bookingCount: 4, scheduledValueCents: 7_000, arrivedCount: 1, completedCount: 0, cancelledCount: 1, noShowCount: 1, exceptions: [
    { id: "cancelled", startsAt: summary.exceptions[0]!.startsAt, endsAt: summary.exceptions[0]!.endsAt, status: "cancelled", priceCents: 3_000, customerName: "Cal", serviceTitle: "Style", teamMemberId: "staff-2", teamMemberName: "Cam" },
    { id: "no-show", startsAt: summary.exceptions[1]!.startsAt, endsAt: summary.exceptions[1]!.endsAt, status: "no_show", priceCents: 4_000, customerName: "Dee", serviceTitle: "Trim", teamMemberId: "staff-2", teamMemberName: "Cam" },
  ] });
});
