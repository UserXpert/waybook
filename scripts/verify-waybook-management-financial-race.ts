import assert from "node:assert/strict";
import postgres from "postgres";

// Requires the schema-only disposable database and synthetic fixtures, never a real tenant DB.
const db = postgres("postgresql://waybook@127.0.0.1:5440/waybook_management_test", { max: 4, ssl: false });
const tenant = "459cd62f-caa8-406d-9b15-58c69feb95ec";
const paidFirst = "60000000-0000-4000-8000-000000000006";
const cancelledFirst = "60000000-0000-4000-8000-000000000007";
const endpoint = "http://localhost:3336/nordic/api/public/manage";
async function cancel(bookingId: string) {
  const response = await fetch(endpoint, { method: "POST", headers: { origin: "http://localhost:3336", "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", bookingId, email: "customer@example.invalid" }) });
  return { status: response.status, body: await response.json() };
}
async function main() {
  let pending!: Promise<{ status: number; body: any }>;
  await db.begin(async tx => {
    await tx.unsafe("INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method) VALUES ($1,$2,'payment',5000,'cash')", [tenant, paidFirst]);
    pending = cancel(paidFirst);
    // Give the request time to reach the locked booking while payment is uncommitted.
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  const blocked = await pending;
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /payment or package/);
  const [stillConfirmed] = await db<{ status: string }[]>`SELECT status FROM bookings WHERE id=${paidFirst}`;
  assert.equal(stillConfirmed.status, "confirmed");
  const cancelled = await cancel(cancelledFirst);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  await assert.rejects(() => db`INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method) VALUES (${tenant},${cancelledFirst},'payment',5000,'cash')`, /cancelled appointments cannot receive payment/);
  const [sale] = await db<{ id: string }[]>`SELECT id FROM commerce_sales WHERE booking_id=${paidFirst} AND tenant_id=${tenant}`;
  await assert.rejects(() => db`INSERT INTO commerce_sale_transactions (tenant_id,sale_id,kind,method,amount_cents,currency) VALUES (${tenant},${sale.id},'payment','cash',5000,'DKK')`, /booking payments must be recorded/);
  await assert.rejects(() => db`UPDATE commerce_sales SET booking_id=NULL WHERE id=${sale.id}`, /cannot be attached to or detached/);
  console.log("Financial race: committed payment blocks cancellation; cancelled bookings reject payment; booking sale tender and identity guards passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.end());
