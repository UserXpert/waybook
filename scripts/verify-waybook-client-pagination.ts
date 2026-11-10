import assert from "node:assert/strict";
import postgres from "postgres";
import { clientLookupQuery } from "../apps/demo/src/lib/waybook/client-lookup-query.ts";

// Uses temporary tables only. Never run this synthetic workload on a remote DB.
const url = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL to a local PostgreSQL database.");
}
const tenant = "00000000-0000-4000-8000-000000000001";
const otherTenant = "00000000-0000-4000-8000-000000000002";
const previousQuery = `SELECT c.id,c.name,c.email,c.phone,c.tags,count(b.id)::int AS "bookingCount",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS "bookedValueCents",max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS "lastBookingAt",min(b.starts_at) FILTER (WHERE b.status IN ('confirmed','arrived') AND b.starts_at >= now()) AS "nextBookingAt" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.email ILIKE $3 OR coalesce(c.phone,'') ILIKE $3) AND ($4::uuid IS NULL OR (c.name,c.id) > (coalesce((SELECT name FROM customers WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid)) GROUP BY c.id ORDER BY c.name,c.id LIMIT $5`;
async function main() {
  const db = postgres(url!, { max: 1, ssl: false });
  try {
  await db.begin(async (tx) => {
    await tx.unsafe("CREATE TEMP TABLE customers (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL, email text NOT NULL, phone text, tags text[]) ON COMMIT DROP");
    await tx.unsafe("CREATE TEMP TABLE bookings (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, customer_id uuid NOT NULL, booked_price_cents integer NOT NULL, status text NOT NULL, starts_at timestamptz NOT NULL) ON COMMIT DROP");
    await tx.unsafe("CREATE INDEX ON bookings (tenant_id,customer_id)");
    await tx.unsafe(`INSERT INTO customers SELECT md5('customer'||n)::uuid, CASE WHEN n <= 3000 THEN '${tenant}'::uuid ELSE '${otherTenant}'::uuid END, 'Client '||lpad((n%1500)::text,5,'0'), 'client'||n||'@example.test', NULL, ARRAY[]::text[] FROM generate_series(1,3100) n`);
    await tx.unsafe(`INSERT INTO bookings SELECT md5('booking'||n)::uuid,'${tenant}'::uuid,md5('customer'||((n-1)%3000+1))::uuid,70000,CASE WHEN n%13=0 THEN 'cancelled' ELSE 'completed' END,now()-interval '3 years'+(n/30)*interval '1 day' FROM generate_series(1,30000) n`);
    await tx.unsafe(`INSERT INTO bookings VALUES (md5('foreign-booking')::uuid,'${otherTenant}'::uuid,md5('customer1')::uuid,999999,'completed',now())`);
    await tx.unsafe("ANALYZE customers");
    await tx.unsafe("ANALYZE bookings");
    const [cursor] = await tx<{ id: string }[]>`SELECT id FROM customers WHERE tenant_id=${tenant} ORDER BY name,id OFFSET 51 LIMIT 1`;
    const [foreign] = await tx<{ id: string }[]>`SELECT id FROM customers WHERE tenant_id=${otherTenant} LIMIT 1`;
    for (const [label, query, after, limit] of [
      ["first page", "", null, 51], ["later page", "", cursor.id, 51], ["search", "Client 00", null, 21],
      ["selector", "", null, 3], ["foreign cursor", "", foreign.id, 21],
    ] as const) {
      const args = [tenant, query, `%${query}%`, after, limit];
      const previous = await tx.unsafe(previousQuery, args);
      const current = await tx.unsafe(clientLookupQuery, args);
      assert.deepEqual(current, previous, `${label} changed`);
      assert.ok(current.every((row) => row.bookingCount === 10), `${label} included another tenant's booking`);
      console.log(`${label}: ${current.length} rows match`);
    }
    for (const [label, sql] of [["previous", previousQuery], ["current", clientLookupQuery]] as const) {
      const plan = await tx.unsafe<{ "QUERY PLAN": { "Execution Time": number }[] }[]>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, [tenant, "", "%%", null, 51]);
      console.log(`${label} query: ${plan[0]["QUERY PLAN"][0]["Execution Time"]} ms`);
    }
  });
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
