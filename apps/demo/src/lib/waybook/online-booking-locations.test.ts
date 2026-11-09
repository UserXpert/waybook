import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hasRequiredOnlineLocation } from "./online-booking-locations";

test("active booking locations cannot all be disabled", () => {
  assert.equal(hasRequiredOnlineLocation(1, 0), false);
  assert.equal(hasRequiredOnlineLocation(2, 0), false);
  assert.equal(hasRequiredOnlineLocation(2, 1), true);
  assert.equal(hasRequiredOnlineLocation(0, 0), true);
});
