import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`older gift cards show exact ledger amounts and keep register filters in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const id = randomUUID();
  const owner = `Gift register ${id.slice(0, 8)}`;
  const route = `/${tenant.route}/app/gift-cards`;
  const amount = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(100.50);
  try {
    const [workspace] = await db`SELECT tenant_id FROM tenant_settings LIMIT 1`;
    await db`INSERT INTO customers (id,tenant_id,name,email) VALUES (${id},${workspace.tenant_id},${owner},${`${id}@example.test`})`;
    await db`INSERT INTO commerce_gift_cards (id,tenant_id,issued_to_customer_id,code_hash,code_last_four,created_at)
      VALUES (${id},${workspace.tenant_id},${id},${id},'OLD1','2000-01-01T00:00:00Z')`;
    await db`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason)
      VALUES (${workspace.tenant_id},${id},'issue','credit',10050,'DKK','Synthetic register fixture')`;
    await db`INSERT INTO commerce_gift_cards (tenant_id,issued_to_customer_id,code_hash,code_last_four,created_at)
      SELECT ${workspace.tenant_id},${id},${id}::text || n::text,'NEW1','2000-01-02T00:00:00Z' FROM generate_series(1,151) n`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    await page.goto(`${route}?card=${id}`);
    const detail = page.getByRole("complementary", { name: "Gift-card details" });
    await expect(detail.getByRole("heading", { name: "Card ending OLD1" })).toBeVisible({ timeout: 3000 });
    await expect(detail.getByText(amount, { exact: true })).toBeVisible();
    await expect(detail.getByText(`+${amount}`, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL((url) => url.pathname === route && !url.search);
    const search = page.getByRole("searchbox", { name: "Search" });
    await search.fill(owner);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === owner);
    const pager = page.getByRole("navigation", { name: "Gift-card register pages" });
    await expect(pager).toContainText("of 152");
    await pager.getByRole("link", { name: "Next page" }).click();
    const open = page.getByRole("link", { name: "Open gift card ending OLD1" });
    await expect(open).toBeVisible();
    await expect(open).toContainText(amount);
    await open.press("Enter");
    await detail.getByRole("link", { name: "Edit owner and presentation" }).click();
    await detail.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Gift card saved.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL((url) => url.searchParams.get("page") === "2" && url.searchParams.get("q") === owner);
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    await expect(search).toHaveValue(owner);
    await pager.getByRole("link", { name: "Previous page" }).click();
    await expect(pager).toContainText("Showing 1–150 of 152");
    expect(await db`SELECT amount_cents FROM commerce_gift_card_entries WHERE gift_card_id=${id}`).toEqual([{ amount_cents: 10050 }]);
    await search.fill(`missing-${id}`);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No gift cards match this search.", { exact: true })).toBeVisible();

    const other = tenant.route === "nordic"
      ? { route: "copenhagen", owner: "owner@copenhagen-physio.local" }
      : { route: "nordic", owner: "owner@nordic.local" };
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(other.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${other.route}/app`);
    await page.goto(`/${other.route}/app/gift-cards?card=${id}`);
    await expect(page.getByRole("heading", { name: "Gift-card register", exact: true })).toBeVisible();
    await expect(detail).toHaveCount(0);
  } finally {
    try {
      await db`DELETE FROM commerce_gift_cards WHERE issued_to_customer_id=${id} AND id<>${id}`;
    } finally {
      await db.end();
    }
  }
});
