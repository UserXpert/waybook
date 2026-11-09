import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { consumeManagementBuckets } from "../apps/demo/src/lib/waybook/booking-management-rate-limit-core";

// This verifier intentionally targets only the local development database.
async function main() {
const sql = postgres("postgresql://waybook@127.0.0.1:5440/waybook_nordic_studio", { max: 8, ssl: false });
const testTenant = randomUUID();
const otherTenant = randomUUID();
const globalTenant = randomUUID();
const reference = randomUUID();
const attempt = (tenantId: string, bookingId: string) => sql.begin(transaction => consumeManagementBuckets({ unsafe: (query, parameters) => transaction.unsafe(query, parameters) }, tenantId, bookingId));
try {
  const results = await Promise.all(Array.from({ length: 25 }, () => attempt(testTenant, reference)));
  assert.equal(results.filter(Boolean).length, 20, "concurrent attempts must obey the reference cap");
  assert.equal(await attempt(otherTenant, reference), true, "one tenant must not consume another tenant's allowance");
  const stored = await sql<{ bucketKey: string }[]>`SELECT bucket_key AS "bucketKey" FROM booking_management_rate_limits WHERE tenant_id = ${testTenant}`;
  assert.equal(stored.some(row => row.bucketKey.includes(reference)), false, "raw booking references must not be stored");
  await sql`UPDATE booking_management_rate_limits SET window_start=now()-interval '11 minutes' WHERE tenant_id=${testTenant}`;
  assert.equal(await attempt(testTenant, reference), true, "expired buckets must reset");
  const globalResults = await Promise.all(Array.from({ length: 125 }, () => attempt(globalTenant, randomUUID())));
  assert.equal(globalResults.filter(Boolean).length, 120, "rotating references must still obey the tenant cap");
  console.log("Booking-management limiter: concurrency, tenant isolation, reference privacy, expiry and tenant cap passed.");
} finally {
  await sql`DELETE FROM booking_management_rate_limits WHERE tenant_id IN (${testTenant}, ${otherTenant}, ${globalTenant})`;
  await sql.end();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
