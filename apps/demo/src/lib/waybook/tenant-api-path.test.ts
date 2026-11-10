import assert from "node:assert/strict";
import test from "node:test";
import { tenantApiPrefixFromPath } from "./tenant-api-path.ts";

test("selector APIs require an explicit dashboard workspace", () => {
  assert.equal(tenantApiPrefixFromPath("/nordic/app"), "/nordic");
  assert.equal(tenantApiPrefixFromPath("/copenhagen/app/calendars"), "/copenhagen");
  assert.throws(() => tenantApiPrefixFromPath("/app/calendars"));
  assert.throws(() => tenantApiPrefixFromPath("/nordic/book"));
});
