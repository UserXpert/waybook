import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? "postgresql://waybook@127.0.0.1:5440/waybook_nordic_studio";
const db = postgres(databaseUrl, { max: 1, ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : "require" });

type Appointment = { tenantId: string; bookingId: string; saleId: string; customerId: string; serviceId: string };

async function rejectsWithinSavepoint(sql: postgres.Sql, query: () => Promise<unknown>, expected: RegExp) {
  await sql.unsafe("SAVEPOINT expected_rejection");
  try {
    await query();
    assert.fail("Expected database mutation to be rejected");
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), expected);
  } finally {
    await sql.unsafe("ROLLBACK TO SAVEPOINT expected_rejection");
  }
}

async function issueTestPackage(sql: postgres.Sql, appointment: Appointment) {
  const [item] = await sql<{ id: string }[]>`INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency) VALUES (${appointment.tenantId},'package','Verifier package',0,'DKK') RETURNING id`;
  await sql`INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units) VALUES (${appointment.tenantId},${item.id},${appointment.serviceId},2)`;
  const [clientPackage] = await sql<{ id: string }[]>`INSERT INTO commerce_packages (tenant_id,catalog_item_id,customer_id,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot) VALUES (${appointment.tenantId},${item.id},${appointment.customerId},'Verifier package',0,'DKK','Verifier service') RETURNING id`;
  await sql`INSERT INTO commerce_entitlement_entries (tenant_id,package_id,service_id,kind,direction,units,reason) VALUES (${appointment.tenantId},${clientPackage.id},${appointment.serviceId},'grant','credit',2,'Verifier issue')`;
  return clientPackage.id;
}

async function main() {
  await db.unsafe("BEGIN");
  try {
    const sql = db;
    const [appointment] = await sql<Appointment[]>`
      SELECT b.tenant_id AS "tenantId",b.id AS "bookingId",cs.id AS "saleId",b.customer_id AS "customerId",b.service_id AS "serviceId"
      FROM bookings b JOIN commerce_sales cs ON cs.booking_id=b.id AND cs.tenant_id=b.tenant_id
      WHERE b.status IN ('confirmed','arrived')
        AND NOT EXISTS (SELECT 1 FROM payment_records pr WHERE pr.tenant_id=b.tenant_id AND pr.booking_id=b.id)
        AND NOT EXISTS (SELECT 1 FROM commerce_entitlement_entries ce WHERE ce.tenant_id=b.tenant_id AND ce.booking_id=b.id AND ce.kind='redeem')
      ORDER BY b.starts_at DESC LIMIT 1 FOR UPDATE OF b,cs
    `;
    assert.ok(appointment, "Nordic needs an unpaid confirmed or arrived appointment sale for this verifier.");
    const packageId = await issueTestPackage(sql, appointment);
    const [entry] = await sql<{ id: string }[]>`INSERT INTO commerce_entitlement_entries (tenant_id,package_id,booking_id,sale_id,service_id,kind,direction,units,reason) VALUES (${appointment.tenantId},${packageId},${appointment.bookingId},${appointment.saleId},${appointment.serviceId},'redeem','debit',1,'Verifier redemption') RETURNING id`;
    assert.ok(entry, "matching package visit was not redeemed");
    await rejectsWithinSavepoint(sql, () => sql`INSERT INTO commerce_entitlement_entries (tenant_id,package_id,booking_id,sale_id,service_id,kind,direction,units,reason) VALUES (${appointment.tenantId},${packageId},${appointment.bookingId},${appointment.saleId},${appointment.serviceId},'redeem','debit',1,'Duplicate verifier redemption')`, /duplicate key|once|remaining visits/i);
    await rejectsWithinSavepoint(sql, () => sql`INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method) VALUES (${appointment.tenantId},${appointment.bookingId},'payment',100,'cash')`, /package-redeemed appointments cannot receive payment/i);
  } finally {
    await db.unsafe("ROLLBACK");
  }
  console.log("Booking package redemption passed: matching visit is atomic; duplicate redemption and mixed payment are rejected.");
  await db.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await db.end({ timeout: 5 });
  process.exitCode = 1;
});
