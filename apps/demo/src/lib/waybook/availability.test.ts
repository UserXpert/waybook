import assert from "node:assert/strict";
import test from "node:test";

import { calculateStaffSlots, type ScheduleRule } from "./availability";

const timezone = "Europe/Copenhagen";
const rule: ScheduleRule = { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "09:00", endTime: "12:00", timezone };
const date = (value: string) => new Date(value);
const range = { start: date("2027-03-29T00:00:00Z"), end: date("2027-03-30T00:00:00Z") };
const options = { duration: 30, now: new Date(0) };
const localStarts = (slots: ReturnType<typeof calculateStaffSlots>) =>
  slots.map(({ localStart }) => localStart.slice(11, 16));

test("uses appointment duration by default and clips at both requested edges", () => {
  assert.deepEqual(localStarts(calculateStaffSlots([rule], [], [], range, timezone, {
    ...options, duration: 45,
  })), ["09:00", "09:45", "10:30", "11:15"]);
  assert.deepEqual(localStarts(calculateStaffSlots([rule], [], [], {
    start: date("2027-03-29T07:17:00Z"), end: date("2027-03-29T08:51:00Z"),
  }, timezone, options)), ["09:30", "10:00"]);
  assert.throws(() => calculateStaffSlots([rule], [], [], range, timezone, { ...options, slotInterval: 0 }));
});

test("honors exact occupied intervals, including holds beside a free appointment", () => {
  const blocks = [{ startsAt: date("2027-03-29T08:00:00Z"), endsAt: date("2027-03-29T09:00:00Z") }];
  const result = calculateStaffSlots([rule], [], blocks, range, timezone, {
    ...options, duration: 60, slotInterval: 30,
  });
  assert.deepEqual(localStarts(result), ["09:00", "11:00"]);
});

test("subtracts a partial closure and anchors the remaining grid at the reopened time", () => {
  const overrides = [{ date: range.start, startTime: "10:10", endTime: "10:55", isUnavailable: true }];
  assert.deepEqual(localStarts(calculateStaffSlots([rule], overrides, [], range, timezone, options)),
    ["09:00", "09:30", "10:55", "11:25"]);
});

test("supports full closures and replacement hours in the supplied override order", () => {
  const closure = { date: range.start, isUnavailable: true };
  const replacement = { date: range.start, startTime: "14:00", endTime: "15:30", isUnavailable: false };
  const slots = (overrides: (typeof closure | typeof replacement)[]) =>
    localStarts(calculateStaffSlots([rule], overrides, [], range, timezone, options));
  assert.deepEqual(slots([replacement]), ["14:00", "14:30", "15:00"]);
  assert.deepEqual(slots([closure, replacement]), ["14:00", "14:30", "15:00"]);
  assert.deepEqual(slots([replacement, closure]), []);
});

test("evaluates a dated monthly recurrence and excludes expired working dates", () => {
  const monthly = { ...rule, rrule: "DTSTART:20270301T000000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1" };
  const april = { start: date("2027-04-01T00:00:00Z"), end: date("2027-04-03T00:00:00Z") };
  const slots = calculateStaffSlots([monthly], [], [], april, timezone, options);
  assert.equal(slots.length, 6);
  assert.ok(slots.every(({ localStart }) => localStart.startsWith("2027-04-01")));
  assert.deepEqual(calculateStaffSlots([{ ...monthly, validUntil: "2027-03-31" }], [], [], april, timezone, options), []);
});

test("keeps an overnight shift visible in a request that starts the next local day", () => {
  const overnight = { ...rule, startTime: "23:00", endTime: "02:00" };
  const tuesday = { start: date("2027-03-29T22:00:00Z"), end: date("2027-03-30T22:00:00Z") };
  assert.deepEqual(localStarts(calculateStaffSlots([overnight], [], [], tuesday, timezone, options)),
    ["00:00", "00:30", "01:00", "01:30"]);
});

test("uses local working dates across both Copenhagen daylight saving changes", () => {
  const sunday = { ...rule, rrule: "FREQ=WEEKLY;BYDAY=SU", startTime: "01:00", endTime: "05:00" };
  const spring = { start: date("2027-03-27T23:00:00Z"), end: date("2027-03-28T22:00:00Z") };
  const autumn = { start: date("2027-10-30T22:00:00Z"), end: date("2027-10-31T23:00:00Z") };
  assert.deepEqual(localStarts(calculateStaffSlots([sunday], [], [], spring, timezone, options)),
    ["01:00", "01:30", "03:00", "03:30", "04:00", "04:30"]);
  const autumnSlots = calculateStaffSlots([sunday], [], [], autumn, timezone, options);
  assert.deepEqual(localStarts(autumnSlots),
    ["01:00", "01:30", "02:00", "02:30", "02:00", "02:30", "03:00", "03:30", "04:00", "04:30"]);
  assert.equal(new Set(autumnSlots.map(({ startTime }) => startTime)).size, autumnSlots.length);
});

test("fails closed for malformed persisted rules and clock times", () => {
  assert.throws(() => calculateStaffSlots([{ ...rule, rrule: "invalid" }], [], [], range, timezone, options));
  assert.throws(() => calculateStaffSlots([{ ...rule, startTime: "9am" }], [], [], range, timezone, options), /Invalid schedule time/);
});

test("rejects sub-daily or non-advancing imported recurrences before expansion", () => {
  for (const rrule of ["FREQ=SECONDLY", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;BYHOUR=8,9;BYMINUTE=0,1,2,3,4,5,6,7,8,9,10,11,12"]) {
    assert.throws(() => calculateStaffSlots([{ ...rule, rrule }], [], [], range, timezone, options),
      /must recur by calendar date/);
  }
});

test("returns one candidate per instant when historical shifts overlap", () => {
  const overlap = { ...rule, startTime: "10:00", endTime: "13:00" };
  assert.deepEqual(localStarts(calculateStaffSlots([rule, overlap], [], [], range, timezone, options)),
    ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("calendar starts align with quarter-hour boundaries inside an off-grid shift", () => {
  const slots = calculateStaffSlots([{ ...rule, startTime: "09:07", endTime: "10:15" }], [], [], range, timezone, {
    ...options, duration: 30, slotInterval: 15, alignToClock: true,
  });
  assert.deepEqual(localStarts(slots), ["09:15", "09:30", "09:45"]);
});
