import assert from "node:assert/strict";
import postgres from "postgres";
import { bookingListQuery, type BookingRow } from "../apps/demo/src/lib/waybook/booking-list-query.ts";
import type { tenantDb } from "../apps/demo/src/lib/waybook/database.ts";

const url = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL to a local PostgreSQL database.");
}
const tenant = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
type Filters = { isManager: boolean; teamMemberId: string | null; locationId?: string; status?: string; search: string };

async function main() {
  const db = postgres(url!, { max: 1, ssl: false });
  try {
    await db.begin(async (tx) => {
      await tx.unsafe(`CREATE TEMP TABLE customers (id uuid PRIMARY KEY, tenant_id uuid, name text, email text, phone text) ON COMMIT DROP;
        CREATE TEMP TABLE services (id uuid PRIMARY KEY, tenant_id uuid, title text) ON COMMIT DROP;
        CREATE TEMP TABLE team_members (id uuid PRIMARY KEY, tenant_id uuid, name text) ON COMMIT DROP;
        CREATE TEMP TABLE locations (id uuid PRIMARY KEY, tenant_id uuid, name text) ON COMMIT DROP;
        CREATE TEMP TABLE resources (id uuid PRIMARY KEY, tenant_id uuid, name text) ON COMMIT DROP;
        CREATE TEMP TABLE bookings (id uuid PRIMARY KEY,tenant_id uuid,booking_number text,service_id uuid,customer_id uuid,team_member_id uuid,location_id uuid,starts_at timestamptz,ends_at timestamptz,status text,source text,booked_price_cents integer) ON COMMIT DROP;
        CREATE TEMP TABLE booking_resource_assignments (tenant_id uuid,booking_id uuid,resource_id uuid,released_at timestamptz,UNIQUE(tenant_id,booking_id)) ON COMMIT DROP;
        CREATE TEMP TABLE commerce_sales (id uuid PRIMARY KEY,tenant_id uuid,booking_id uuid,UNIQUE(tenant_id,booking_id)) ON COMMIT DROP;
        CREATE TEMP TABLE payment_records (id uuid PRIMARY KEY,tenant_id uuid,booking_id uuid,kind text,amount_cents integer) ON COMMIT DROP;
        CREATE INDEX ON bookings (tenant_id,starts_at); CREATE INDEX ON payment_records (tenant_id,booking_id);`);
      await tx.unsafe(`INSERT INTO customers SELECT md5('customer'||n)::uuid,'${tenant}'::uuid,'Client '||n,'client'||n||'@example.test',null FROM generate_series(1,3000) n;
        INSERT INTO services VALUES (md5('service1')::uuid,'${tenant}'::uuid,'Massage'),(md5('service2')::uuid,'${tenant}'::uuid,'Consultation');
        INSERT INTO team_members SELECT md5('staff'||n)::uuid,'${tenant}'::uuid,'Staff '||n FROM generate_series(1,10) n;
        INSERT INTO locations VALUES (md5('location1')::uuid,'${tenant}'::uuid,'North'),(md5('location2')::uuid,'${tenant}'::uuid,'South');
        INSERT INTO resources VALUES (md5('room1')::uuid,'${tenant}'::uuid,'Room');
        INSERT INTO bookings SELECT md5('booking'||n)::uuid,'${tenant}'::uuid,'B'||n,md5('service'||((n-1)%2+1))::uuid,md5('customer'||((n-1)%3000+1))::uuid,md5('staff'||((n-1)%10+1))::uuid,md5('location'||((n-1)%2+1))::uuid,now()-interval '3 years'+(n/30)*interval '1 day',now()-interval '3 years'+(n/30)*interval '1 day'+interval '1 hour',CASE WHEN n%9=0 THEN 'cancelled' ELSE 'completed' END,'tenant',70000 FROM generate_series(1,30000) n;
        INSERT INTO customers VALUES (md5('other-customer')::uuid,'${other}'::uuid,'Other tenant client','other@example.test',null);
        INSERT INTO services VALUES (md5('other-service')::uuid,'${other}'::uuid,'Other tenant service');
        INSERT INTO bookings VALUES (md5('other-booking')::uuid,'${other}'::uuid,'OTHER',md5('other-service')::uuid,md5('other-customer')::uuid,null,null,now()+interval '1 year',now()+interval '1 year 1 hour','confirmed','tenant',70000);
        INSERT INTO commerce_sales SELECT md5('sale'||n)::uuid,'${tenant}'::uuid,md5('booking'||n)::uuid FROM generate_series(1,30000) n;
        INSERT INTO payment_records SELECT md5('payment'||n)::uuid,'${tenant}'::uuid,md5('booking'||n)::uuid,'payment',70000 FROM generate_series(1,30000) n;
        INSERT INTO payment_records SELECT md5('refund'||n)::uuid,'${tenant}'::uuid,md5('booking'||n)::uuid,'refund',10000 FROM generate_series(1,30000) n WHERE n%7=0;
        INSERT INTO payment_records VALUES (md5('foreign')::uuid,'${other}'::uuid,md5('booking30000')::uuid,'payment',999999);
        INSERT INTO booking_resource_assignments SELECT '${tenant}'::uuid,md5('booking'||n)::uuid,md5('room1')::uuid,CASE WHEN n%6=0 THEN now() ELSE null END FROM generate_series(1,30000) n WHERE n%3=0;
        ANALYZE customers; ANALYZE services; ANALYZE team_members; ANALYZE locations; ANALYZE resources; ANALYZE bookings; ANALYZE booking_resource_assignments; ANALYZE commerce_sales; ANALYZE payment_records;`);
      const baseline = (filters: Filters) => {
        const pattern = `%${filters.search}%`;
        return tx<BookingRow[]>`SELECT b.id, b.booking_number AS "bookingNumber", b.service_id AS "serviceId", bra.resource_id AS "resourceId", c.phone AS "customerPhone", cs.id AS "saleId", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source, b.booked_price_cents AS "bookedPriceCents", coalesce(sum(CASE WHEN pr.kind='payment' THEN pr.amount_cents ELSE -pr.amount_cents END),0)::int AS "paidCents",c.name AS "customerName",c.email AS "customerEmail",s.title AS "serviceTitle",tm.id AS "teamMemberId",tm.name AS "teamMemberName",b.location_id AS "locationId",l.name AS "locationName",r.name AS "resourceName"
          FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id LEFT JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id LEFT JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL LEFT JOIN resources r ON r.id=bra.resource_id AND r.tenant_id=b.tenant_id LEFT JOIN commerce_sales cs ON cs.booking_id=b.id AND cs.tenant_id=b.tenant_id LEFT JOIN payment_records pr ON pr.booking_id=b.id AND pr.tenant_id=b.tenant_id
          WHERE b.tenant_id=${tenant} ${filters.isManager ? tx`` : tx`AND b.team_member_id=${filters.teamMemberId}`} ${filters.locationId ? tx`AND b.location_id=${filters.locationId}` : tx``} ${filters.status ? tx`AND b.status=${filters.status}` : tx``} ${filters.search ? tx`AND (c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR b.booking_number ILIKE ${pattern} OR s.title ILIKE ${pattern} OR coalesce(tm.name,'') ILIKE ${pattern})` : tx``}
          GROUP BY b.id,cs.id,c.id,s.id,tm.id,l.id,r.id,bra.resource_id ORDER BY b.starts_at DESC,b.id DESC LIMIT 100`;
      };
      const [staff] = await tx<{ id: string }[]>`SELECT id FROM team_members WHERE name='Staff 1'`;
      const [location] = await tx<{ id: string }[]>`SELECT id FROM locations WHERE name='North'`;
      const cases: [string, Filters][] = [
        ["manager", { isManager: true, teamMemberId: null, search: "" }],
        ["staff", { isManager: false, teamMemberId: staff.id, search: "" }],
        ["location and status", { isManager: true, teamMemberId: null, locationId: location.id, status: "cancelled", search: "" }],
        ["search", { isManager: true, teamMemberId: null, search: "Client 27" }],
        ["booking number search", { isManager: true, teamMemberId: null, search: "B30000" }],
        ["service search", { isManager: true, teamMemberId: null, search: "Consultation" }],
        ["staff search", { isManager: true, teamMemberId: null, search: "Staff 3" }],
        ["staff without identity", { isManager: false, teamMemberId: null, search: "" }],
      ];
      for (const [label, filters] of cases) {
        const oldRows = await baseline(filters);
        const newRows = await bookingListQuery(tx as unknown as ReturnType<typeof tenantDb>, tenant, filters);
        assert.deepEqual(newRows, oldRows, `${label} returned different bookings`);
        assert.ok(newRows.every((row) => row.bookingNumber !== "OTHER"), `${label} included another tenant's booking`);
        assert.ok(newRows.every((row) => row.paidCents === 60000 || row.paidCents === 70000), `${label} included a cross-tenant payment`);
        console.log(`${label}: ${newRows.length} rows match`);
      }
      const filters = cases[0][1];
      for (const [label, run] of [["previous", () => baseline(filters)], ["current", () => bookingListQuery(tx as unknown as ReturnType<typeof tenantDb>, tenant, filters)]] as const) {
        const times: number[] = [];
        for (let n = 0; n < 3; n++) { const start = performance.now(); await run(); times.push(Math.round((performance.now() - start) * 10) / 10); }
        console.log(`${label} query ms: ${times.join(", ")}`);
      }
    });
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
