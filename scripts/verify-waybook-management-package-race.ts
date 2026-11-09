import assert from "node:assert/strict";
import postgres from "postgres";

// Only the disposable schema-only fixture database is used by this verifier.
const db = postgres("postgresql://waybook@127.0.0.1:5440/waybook_management_test", { max: 4, ssl: false });
const tenant = "459cd62f-caa8-406d-9b15-58c69feb95ec";
const booking = "60000000-0000-4000-8000-000000000004";
const service = "30000000-0000-4000-8000-000000000001";
const customer = "40000000-0000-4000-8000-000000000001";
async function cancel() {
  const response = await fetch("http://localhost:3336/nordic/api/public/manage", { method: "POST", headers: { origin: "http://localhost:3336", "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", bookingId: booking, email: "customer@example.invalid" }) });
  return { status: response.status, body: await response.json() };
}
async function main() {
  const [sale] = await db<{ id: string }[]>`SELECT id FROM commerce_sales WHERE tenant_id=${tenant} AND booking_id=${booking}`;
  const [item] = await db<{ id: string }[]>`INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency) VALUES (${tenant},'package','Test package',0,'DKK') RETURNING id`;
  await db`INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units) VALUES (${tenant},${item.id},${service},2)`;
  const [pkg] = await db<{ id: string }[]>`INSERT INTO commerce_packages (tenant_id,catalog_item_id,customer_id,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot) VALUES (${tenant},${item.id},${customer},'Test package',0,'DKK','Test Service') RETURNING id`;
  await db`INSERT INTO commerce_entitlement_entries (tenant_id,package_id,service_id,kind,direction,units,reason) VALUES (${tenant},${pkg.id},${service},'grant','credit',2,'Synthetic fixture')`;
  let pending!: Promise<{ status: number; body: any }>;
  await db.begin(async tx => {
    await tx.unsafe("INSERT INTO commerce_entitlement_entries (tenant_id,package_id,booking_id,sale_id,service_id,kind,direction,units,reason) VALUES ($1,$2,$3,$4,$5,'redeem','debit',1,'Synthetic fixture')", [tenant,pkg.id,booking,sale.id,service]);
    pending = cancel();
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  const result = await pending;
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.match(result.body.error, /payment or package/);
  const [current] = await db<{ status: string }[]>`SELECT status FROM bookings WHERE id=${booking}`;
  assert.equal(current.status, "confirmed");
  console.log("Package race: committed redemption blocks an in-flight cancellation.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.end());
