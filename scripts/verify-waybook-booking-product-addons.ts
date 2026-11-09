import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? "postgresql://waybook@127.0.0.1:5440/waybook_nordic_studio";
const db = postgres(databaseUrl, { max: 1, ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : "require" });

type Sale = { id: string; bookingId: string };
type Product = { id: string; title: string; priceCents: number };

async function main() {
  await db.unsafe("BEGIN");
  try {
    const [sale] = await db<Sale[]>`
      SELECT cs.id,b.id AS "bookingId" FROM commerce_sales cs
      JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id
      WHERE b.status IN ('confirmed','arrived') ORDER BY b.starts_at DESC LIMIT 1 FOR UPDATE OF cs,b
    `;
    const [product] = await db<Product[]>`
      SELECT id,title,price_cents AS "priceCents" FROM commerce_catalog_items
      WHERE kind='product' AND is_active=TRUE ORDER BY created_at LIMIT 1 FOR SHARE
    `;
    assert.ok(sale && product, "Nordic needs an active product and confirmed or arrived appointment sale for this verifier.");

    const [line] = await db<{ id: string; title: string; priceCents: number }[]>`
      INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity)
      SELECT cs.tenant_id,cs.id,${product.id},'product',${product.title},${product.priceCents},2
      FROM commerce_sales cs WHERE cs.id=${sale.id}
      RETURNING id,title_snapshot AS title,unit_price_cents AS "priceCents"
    `;
    assert.ok(line, "active appointment product line was not created");
    await db`UPDATE commerce_catalog_items SET title=${`${product.title} revised`},price_cents=${product.priceCents + 100} WHERE id=${product.id}`;
    const [snapshot] = await db<{ title: string; priceCents: number }[]>`SELECT title_snapshot AS title,unit_price_cents AS "priceCents" FROM commerce_sale_lines WHERE id=${line.id}`;
    assert.deepEqual(snapshot, { title: product.title, priceCents: product.priceCents }, "booking product line did not retain its immutable product snapshot");

    const [terminalSale] = await db<Sale[]>`
      SELECT cs.id,b.id AS "bookingId" FROM commerce_sales cs
      JOIN bookings b ON b.id=cs.booking_id AND b.tenant_id=cs.tenant_id
      WHERE b.status IN ('completed','cancelled','no_show') ORDER BY b.starts_at DESC LIMIT 1
    `;
    assert.ok(terminalSale, "Nordic needs a terminal booking sale for lifecycle verification.");
    await assert.rejects(
      () => db`
        INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity)
        SELECT cs.tenant_id,cs.id,${product.id},'product',${product.title},${product.priceCents},1
        FROM commerce_sales cs WHERE cs.id=${terminalSale.id}
      `,
      /confirmed or arrived appointments/,
    );
    console.log("Booking product add-ons passed: active appointment snapshot retained; terminal appointment insert rejected.");
  } finally {
    await db.unsafe("ROLLBACK");
    await db.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
