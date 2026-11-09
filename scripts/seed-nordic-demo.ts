/** Explicit, additive fixture import. Never runs during deployment or migrations. */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

type Entry = { key: string; name?: string; city?: string; email?: string; location?: string; service?: string; staff?: string; customer?: string; durationMinutes?: number; priceCents?: number; units?: number; amountCents?: number; lastFour?: string; dayOffset?: number; hour?: number; status?: string };
type Fixture = { fixture: string; timezone: string; locations: Entry[]; staff: Entry[]; services: Entry[]; products: Entry[]; packages: Entry[]; giftCards: Entry[]; customers: Entry[]; bookings: Entry[] };
const fixture = JSON.parse(readFileSync(new URL("../fixtures/nordic-demo.json", import.meta.url), "utf8")) as Fixture;
const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL;
const tenantUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL;
const giftSecret = process.env.WAYBOOK_GIFT_CARD_CODE_SECRET;
const dryRun = process.argv[2] === "--dry-run";
if ((!dryRun && process.argv[2] !== "--apply-nordic-demo") || !controlUrl || !tenantUrl || !giftSecret) throw new Error("Explicit --dry-run or --apply-nordic-demo, Control and Nordic database URLs, and WAYBOOK_GIFT_CARD_CODE_SECRET are required.");
if (fixture.fixture !== "waybook-nordic-demo-v1" || fixture.locations.length !== 4 || fixture.staff.length !== 10 || fixture.services.length !== 10 || fixture.products.length !== 10 || fixture.packages.length !== 5 || fixture.giftCards.length !== 5 || fixture.bookings.length !== 50) throw new Error("Unexpected fixture shape or counts.");
const ssl = (url: string) => url.includes("127.0.0.1") || url.includes("localhost") ? false : "require" as const;
const control = postgres(controlUrl, { max: 1, ssl: ssl(controlUrl) });
const db = postgres(tenantUrl, { max: 1, ssl: ssl(tenantUrl) });
function id(tenant: string, key: string) { const hash = createHash("sha256").update(`${fixture.fixture}:${tenant}:${key}`).digest("hex").slice(0,32).split(""); hash[12] = "4"; hash[16] = "8"; const hex = hash.join(""); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
async function main() {
  const [tenant] = await control<{id:string}[]>`SELECT id FROM tenants WHERE slug='nordic-studio' AND lifecycle_status='active'`;
  if (!tenant) throw new Error("Active Nordic Studio tenant not found; no data imported.");
  const tenantId = tenant.id;
  try { await db.begin(async tx => {
    const run = (query: string, args: unknown[]) => tx.unsafe(query, args as never[]);
    const ref = (key: string | undefined) => { if (!key) throw new Error("Missing fixture reference"); return id(tenantId,key); };
    for (const item of fixture.locations) {
      await run("INSERT INTO locations (id,tenant_id,slug,name,city,timezone) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [ref(item.key),tenantId,`demo-${item.key}`,`Demo · ${item.name}`,item.city,fixture.timezone]);
      for (let day=0;day<=6;day++) await run("INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time) VALUES ($1,$2,$3,'09:00','18:00') ON CONFLICT DO NOTHING",[tenantId,ref(item.key),day]);
    }
    for (const item of fixture.staff) {
      await run("INSERT INTO team_members (id,tenant_id,role,name,email) VALUES ($1,$2,'staff',$3,$4) ON CONFLICT (id) DO NOTHING",[ref(item.key),tenantId,`Demo · ${item.name}`,item.email]);
      await run("INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[tenantId,ref(item.key),ref(item.location)]);
      await run("INSERT INTO availability_rules (id,tenant_id,team_member_id,rrule,start_time,end_time,timezone) VALUES ($1,$2,$3,'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','18:00',$4) ON CONFLICT (id) DO NOTHING",[id(tenantId,`${item.key}-hours`),tenantId,ref(item.key),fixture.timezone]);
    }
    for (const item of fixture.services) {
      await run("INSERT INTO services (id,tenant_id,slug,title,duration_minutes,price_cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",[ref(item.key),tenantId,`demo-${item.key}`,`Demo · ${item.name}`,item.durationMinutes,item.priceCents]);
      for(const loc of fixture.locations) await run("INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[tenantId,ref(item.key),ref(loc.key)]);
      for(const member of fixture.staff) await run("INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[tenantId,ref(item.key),ref(member.key)]);
    }
    for (const item of fixture.customers) await run("INSERT INTO customers (id,tenant_id,name,email) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",[ref(item.key),tenantId,`Demo · ${item.name}`,item.email]);
    for (const item of fixture.products) await run("INSERT INTO commerce_catalog_items (id,tenant_id,kind,title,sku,price_cents,currency) VALUES ($1,$2,'product',$3,$4,$5,'DKK') ON CONFLICT (id) DO NOTHING",[ref(item.key),tenantId,`Demo · ${item.name}`,`DEMO-${item.key}`,item.priceCents]);
    for (const item of fixture.packages) {
      await run("INSERT INTO commerce_catalog_items (id,tenant_id,kind,title,sku,price_cents,currency) VALUES ($1,$2,'package',$3,$4,$5,'DKK') ON CONFLICT (id) DO NOTHING",[ref(item.key),tenantId,`Demo · ${item.name}`,`DEMO-${item.key}`,item.priceCents]);
      await run("INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,catalog_item_id,service_id) DO NOTHING",[tenantId,ref(item.key),ref(item.service),item.units]);
    }
    for (const item of fixture.giftCards) {
      // Keep demo card codes unguessable even though this fixture is committed.
      const secretPart = createHmac("sha256",giftSecret!).update(`${fixture.fixture}:${tenantId}:${item.key}`).digest("hex").slice(0,16).toUpperCase();
      const code = `DEMO-${secretPart}-${item.lastFour}`;
      const digest = createHmac("sha256",giftSecret!).update(code).digest("hex");
      const inserted = await run("INSERT INTO commerce_gift_cards (id,tenant_id,issued_to_customer_id,code_hash,code_hash_version,code_last_four,currency,metadata) VALUES ($1,$2,$3,$4,2,$5,'DKK',$6::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",[ref(item.key),tenantId,ref(item.customer),digest,item.lastFour,JSON.stringify({notes:"Demo fixture: not a real purchase"})]);
      if (inserted.length) await run("INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason) VALUES ($1,$2,'issue','credit',$3,'DKK','Demo fixture')",[tenantId,ref(item.key),item.amountCents]);
    }
    for (const item of fixture.bookings) {
      const member=fixture.staff.find(x=>x.key===item.staff); const service=fixture.services.find(x=>x.key===item.service);
      if (!member || !service || member.location!==item.location) throw new Error(`Invalid booking reference ${item.key}`);
      const existing=await run("SELECT id FROM bookings WHERE id=$1 AND tenant_id=$2",[ref(item.key),tenantId]);
      if (existing.length) continue;
      const [slot] = await run("SELECT ((now() AT TIME ZONE $1)::date + $2::int + make_interval(hours => $3::int)) AT TIME ZONE $1 AS starts_at",[fixture.timezone,item.dayOffset,item.hour]);
      const start = slot.starts_at as Date; const end = new Date(start.getTime()+service.durationMinutes!*60_000);
      await run("INSERT INTO booking_blocks (id,tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES ($1,$2,$3,$4,$5,$6,'confirmed')",[id(tenantId,`${item.key}-block`),tenantId,ref(item.staff),ref(item.location),start,end]);
      await run("INSERT INTO bookings (id,tenant_id,booking_block_id,service_id,location_id,team_member_id,customer_id,starts_at,ends_at,status,source,booked_price_cents,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'tenant',$11,$12)",[ref(item.key),tenantId,id(tenantId,`${item.key}-block`),ref(item.service),ref(item.location),ref(item.staff),ref(item.customer),start,end,item.status,service.priceCents,`${fixture.fixture}:${item.key}`]);
    }
    if (dryRun) throw new Error("DEMO_DRY_RUN_ROLLBACK");
  }); } catch (error) { if (!(dryRun && error instanceof Error && error.message === "DEMO_DRY_RUN_ROLLBACK")) throw error; }
  console.log(`${dryRun ? "Validated (rolled back)" : "Imported"} ${fixture.fixture}: 4 locations, 10 staff, 10 services, 10 products, 5 package definitions, 5 gift cards, 15 clients and 50 bookings.`);
}
main().finally(async () => { await db.end(); await control.end(); }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Import failed"); process.exitCode=1; });
