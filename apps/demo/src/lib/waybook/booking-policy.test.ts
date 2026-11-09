import { strict as assert } from "node:assert";
import { test } from "node:test";
import { requiresPolicyAgreement } from "./booking-policy";

test("policy agreement is required for named text or linked policies", () => {
  assert.equal(requiresPolicyAgreement({ policyVersion: "Cancellation policy", policyText: "Cancel 24 hours ahead" }), true);
  assert.equal(requiresPolicyAgreement({ policyVersion: "v1", policyUrl: "https://example.com/policy" }), true);
  assert.equal(requiresPolicyAgreement({ policyVersion: "v1", policyText: "  " }), false);
  assert.equal(requiresPolicyAgreement({ policyText: "Cancel 24 hours ahead" }), false);
});
