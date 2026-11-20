import assert from "node:assert/strict";
import test from "node:test";
import { canManageEmailProvider } from "./email-provider-access.ts";

test("controlled email-provider operations remain manager-only", () => {
  assert.equal(canManageEmailProvider({ isManager: true }), true);
  assert.equal(canManageEmailProvider({ isManager: false }), false);
});
