import assert from "node:assert/strict";
import test from "node:test";
import { bookingPolicyRevision, isCurrentBookingPolicy } from "./booking-policy-revision.ts";

test("booking agreement matches the displayed policy content", () => {
  const displayed = { policyVersion: "v1", policyText: "Cancel one day ahead", policyUrl: "https://example.com/policy" };
  const revision = bookingPolicyRevision(displayed);
  assert.ok(revision);
  assert.equal(isCurrentBookingPolicy(displayed, revision), true);
  assert.equal(isCurrentBookingPolicy({ ...displayed, policyText: "Cancel two days ahead" }, revision), false);
  assert.equal(isCurrentBookingPolicy({ ...displayed, policyVersion: "v2" }, revision), false);
  assert.equal(isCurrentBookingPolicy(displayed, null), false);
  assert.equal(isCurrentBookingPolicy({}, null), true);
  assert.equal(isCurrentBookingPolicy({}, revision), false);
});
