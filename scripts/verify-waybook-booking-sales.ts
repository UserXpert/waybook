import assert from "node:assert/strict";
import postgres from "postgres";

const tenantUrls = [
  ["Nordic Studio", process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? "postgresql://waybook@127.0.0.1:5440/waybook_nordic_studio"],
  ["Copenhagen Physio", process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL ?? "postgresql://waybook@127.0.0.1:5440/waybook_copenhagen_physio"],
] as const;

async function verifyTenant(label: string, url: string) {
  const db = postgres(url, { max: 1, ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require" });
  try {
    const [counts] = await db<{ bookings: number; linkedSales: number; orphanedBookingSales: number; copiedPaymentEntries: number }[]>`
      SELECT
        (SELECT count(*)::int FROM bookings) AS bookings,
        (SELECT count(*)::int FROM bookings b JOIN commerce_sales cs ON cs.tenant_id=b.tenant_id AND cs.booking_id=b.id) AS "linkedSales",
        (SELECT count(*)::int FROM commerce_sales cs LEFT JOIN bookings b ON b.tenant_id=cs.tenant_id AND b.id=cs.booking_id WHERE cs.booking_id IS NOT NULL AND b.id IS NULL) AS "orphanedBookingSales",
        (SELECT count(*)::int FROM commerce_sale_transactions cst JOIN commerce_sales cs ON cs.id=cst.sale_id AND cs.tenant_id=cst.tenant_id WHERE cs.booking_id IS NOT NULL) AS "copiedPaymentEntries"
    `;
    assert.ok(counts, `${label} did not return booking-sale counts`);
    assert.equal(counts.bookings, counts.linkedSales, `${label} must give every booking exactly one commerce sale`);
    assert.equal(counts.orphanedBookingSales, 0, `${label} has an orphaned booking sale`);
    assert.equal(counts.copiedPaymentEntries, 0, `${label} copied appointment payments into commerce transactions`);
    console.log(`${label}: ${counts.bookings} booking sale identities; appointment payments remain single-ledger.`);
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function main() {
  for (const [label, url] of tenantUrls) await verifyTenant(label, url);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
