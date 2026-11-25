import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`issued-package history opens older snapshots and keeps the current page in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const id = randomUUID();
  const customer = `Package register ${id.slice(0, 8)}`;
  const title = `Previous terms ${id.slice(0, 8)}`;
  const definition = `Updated terms ${id.slice(0, 8)}`;
  const route = `/${tenant.route}/app/packages`;
  const amount = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(200.75);
  try {
    const [service] = await db`SELECT tenant_id,id,title FROM services ORDER BY id LIMIT 1`;
    await db.begin(async (sql) => {
      await sql`INSERT INTO customers (id,tenant_id,name,email) VALUES (${id},${service.tenant_id},${customer},${`${id}@example.test`})`;
      await sql`INSERT INTO commerce_catalog_items (id,tenant_id,kind,title,price_cents,currency,is_active)
        VALUES (${id},${service.tenant_id},'package',${definition},30025,'DKK',false)`;
      await sql`INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units)
        VALUES (${service.tenant_id},${id},${service.id},4)`;
      await sql`INSERT INTO commerce_packages
        (id,tenant_id,catalog_item_id,customer_id,status,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot,created_at)
        VALUES (${id},${service.tenant_id},${id},${id},'active',${title},20075,'DKK',${service.title},now()-interval '1 second')`;
      await sql`WITH newer AS (
        INSERT INTO commerce_packages (tenant_id,catalog_item_id,customer_id,status,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot)
        SELECT ${service.tenant_id},${id},${id},'active','Newer package',30000,'DKK',${service.title} FROM generate_series(1,151)
        RETURNING id
      )
      INSERT INTO commerce_entitlement_entries (tenant_id,package_id,service_id,kind,direction,units,reason)
      SELECT ${service.tenant_id},id,${service.id},'grant','credit',4,'Synthetic register fixture' FROM newer
      UNION ALL SELECT ${service.tenant_id}::uuid,${id}::uuid,${service.id}::uuid,'grant','credit',4,'Synthetic register fixture'`;
    });
    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    await page.goto(`${route}?package=${id}`);
    const detail = page.getByRole("dialog", { name: "Package details" });
    await expect(detail.getByRole("heading", { name: title })).toBeVisible({ timeout: 3000 });
    await expect(detail.getByText(amount, { exact: true })).toBeVisible();
    await expect(detail.getByText("4", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL((url) => url.pathname === route && !url.search);
    const pagination = page.getByRole("navigation", { name: "Issued package pages" });
    await pagination.getByRole("link", { name: "Next page" }).click();
    const open = page.getByRole("link", { name: `Open ${title} for ${customer}`, exact: true });
    await expect(open).toBeVisible();
    await open.press("Enter");
    await expect(detail.getByRole("link", { name: "Close package details" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL((url) => url.search === "?page=2");
    await expect(open).toBeFocused();
    await pagination.getByRole("link", { name: "Previous page" }).click();
    await expect(page).toHaveURL((url) => url.pathname === route && !url.search);
    await expect(page.getByRole("link", { name: `Open ${definition}`, exact: true })).toContainText(
      new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(300.25),
    );
    expect(await db`SELECT units FROM commerce_entitlement_entries WHERE package_id=${id}`).toEqual([{ units: 4 }]);

    const other = tenant.route === "nordic"
      ? { route: "copenhagen", owner: "owner@copenhagen-physio.local" }
      : { route: "nordic", owner: "owner@nordic.local" };
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(other.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${other.route}/app`);
    await page.goto(`/${other.route}/app/packages?package=${id}`);
    await expect(page.getByRole("heading", { name: "Packages", exact: true })).toBeVisible();
    await expect(detail).toHaveCount(0);
  } finally {
    await db.end();
  }
});
