import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`retail history opens and updates a checkout outside the first page in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const id = randomUUID();
  const client = `Retail history ${id.slice(0, 8)}`;
  const path = `/${tenant.route}/app/sales/retail`;
  try {
    const [workspace] = await db`SELECT tenant_id FROM tenant_settings LIMIT 1`;
    await db`INSERT INTO customers (id, tenant_id, name, email) VALUES (${id}, ${workspace.tenant_id}, ${client}, ${`retail-history-${id}@example.test`})`;
    const [product] = await db`INSERT INTO commerce_catalog_items (id, tenant_id, kind, title, price_cents, currency)
      VALUES (${id}, ${workspace.tenant_id}, 'product', 'History fixture item', 5025, 'DKK') RETURNING id`;
    // Equal timestamps among newer sales exercise the stable tie-breaker.
    await db`INSERT INTO commerce_sales (tenant_id, customer_id, currency, created_at)
      SELECT ${workspace.tenant_id}, ${id}, 'DKK', '2000-01-02T12:00:00Z' FROM generate_series(1, 101)`;
    await db`INSERT INTO commerce_sales (id, tenant_id, customer_id, currency, created_at)
      VALUES (${id}, ${workspace.tenant_id}, ${id}, 'DKK', '2000-01-01T12:00:00Z')`;
    await db`INSERT INTO commerce_sale_lines (tenant_id, sale_id, catalog_item_id, line_kind, title_snapshot, unit_price_cents)
      VALUES (${workspace.tenant_id}, ${id}, ${product.id}, 'product', 'History fixture item', 5025)`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    const drawer = page.getByRole("complementary", { name: "Retail checkout details" });
    const close = drawer.getByRole("link", { name: "Close checkout" });
    await page.goto(`${path}?sale=${id}`);
    await expect(drawer.getByRole("heading", { name: client })).toBeVisible({ timeout: 3000 });
    await close.click();
    const rows = page.getByRole("link", { name: "Retail checkout", exact: true });
    await expect(rows).toHaveCount(100);
    const firstPage = await rows.evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("sale")));
    const pages = page.getByRole("navigation", { name: "Retail checkout pages" });
    await pages.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    const older = rows.and(page.locator(`a[href*="sale=${id}"]`));
    await expect(older).toBeVisible();
    const secondPage = await rows.evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("sale")));
    expect(secondPage.every((sale) => !firstPage.includes(sale))).toBe(true);
    await older.press("Enter");
    await expect(close).toBeFocused();
    await drawer.getByRole("combobox", { name: "Product", exact: true }).selectOption(product.id);
    await drawer.getByRole("button", { name: "Add item" }).click();
    await expect(drawer.getByText("History fixture item", { exact: true })).toHaveCount(2);
    await expect(page).toHaveURL(/[?&]page=2/);
    await drawer.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
    await drawer.getByRole("button", { name: /^Collect / }).click();
    await expect(drawer.getByRole("heading", { name: "Collected payment", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]page=2/);
    expect(await db`SELECT method, amount_cents FROM commerce_sale_transactions WHERE sale_id=${id}`).toEqual([{ method: "cash", amount_cents: 10050 }]);
    const success = page.getByRole("status").filter({ hasText: "Payment collected." });
    await expect(success).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL((url) => url.search === "?page=2");
    await expect(older).toBeFocused();
    await expect(success).toHaveCount(0, { timeout: 1200 });
    await pages.getByRole("link", { name: "Previous page" }).click();
    await expect(page).toHaveURL((url) => url.pathname === path && url.search === "");
    await expect(rows).toHaveCount(100);
  } finally {
    try {
      // Leave the single audited checkout intact in the disposable database.
      await db`DELETE FROM commerce_sales WHERE customer_id=${id} AND id<>${id} AND status='draft'`;
    } finally {
      await db.end();
    }
  }
});
