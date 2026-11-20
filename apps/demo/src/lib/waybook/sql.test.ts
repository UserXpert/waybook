import assert from "node:assert/strict";
import test from "node:test";

import { connectWaybookPostgres } from "./sql";

test("keeps local and hosted database pool settings compatible", async () => {
  for (const [host, expectedSsl] of [
    ["127.0.0.1", false],
    ["localhost", false],
    ["[::1]", "require"],
    ["tenant.example.invalid", "require"],
  ] as const) {
    const sql = connectWaybookPostgres(`postgresql://waybook@${host}:5440/disposable`);
    try {
      assert.equal(sql.options.max, 5, host);
      assert.equal(sql.options.ssl, expectedSsl, host);
    } finally {
      await sql.end();
    }
  }
});
