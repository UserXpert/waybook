import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const tenants = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const tenant of tenants) {
  test(`retail checkout recovers interrupted draft, item and payment saves in ${tenant.route}`, async ({ page }) => {
    const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
    try {
      const [workspace] = await db`SELECT tenant_id FROM tenant_settings LIMIT 1`;
      const suffix = randomUUID();
      const client = `Retail recovery QA ${suffix}`;
      const [customer] = await db`INSERT INTO customers (tenant_id,name,email)
        VALUES (${workspace.tenant_id},${client},${`retail-recovery-${suffix}@example.test`}) RETURNING id`;
      const [product] = await db`INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency)
        VALUES (${workspace.tenant_id},'product',${`Retail recovery product ${suffix}`},5025,'DKK') RETURNING id`;

      await page.goto("/login");
      await page.getByLabel("Work email").fill(tenant.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
      const path = `/${tenant.route}/app/sales/retail`;
      await page.goto(path);
      await page.getByPlaceholder("Search name, email, or phone").fill(client);
      await page.getByRole("combobox", { name: /^(Client|Patient)$/ }).selectOption(customer.id);
      await page.getByRole("combobox", { name: "Product", exact: true }).selectOption(product.id);

      let drop = false;
      let replies = 0;
      await page.route(`**${path}**`, async (route) => {
        const request = route.request();
        if (!drop || request.method() !== "POST" || !request.headers()["next-action"]) {
          await route.continue();
          return;
        }
        drop = false;
        const responses = await Promise.all([route.fetch({ maxRedirects: 0 }), route.fetch({ maxRedirects: 0 })]);
        replies += responses.length;
        await route.abort("failed");
      });

      drop = true;
      await page.getByRole("button", { name: "Create draft", exact: true }).click();
      await expect.poll(() => replies).toBe(2);
      const sales = () => db`SELECT id,status FROM commerce_sales WHERE customer_id=${customer.id} AND booking_id IS NULL`;
      const [sale, ...duplicates] = await sales();
      expect(sale).toBeDefined();
      expect(duplicates).toHaveLength(0);
      const ledger = () => db`SELECT method,amount_cents FROM commerce_sale_transactions WHERE sale_id=${sale.id}`;
      const lines = () => db`SELECT unit_price_cents,quantity FROM commerce_sale_lines WHERE sale_id=${sale.id}`;
      await expect(page.getByRole("alert").filter({ hasText: "Could not confirm" })).toBeVisible();
      const retry = page.getByRole("button", { name: "Retry checkout", exact: true });
      await expect(retry).toBeFocused();
      await page.keyboard.press("Enter");
      const details = page.getByRole("complementary", { name: "Retail checkout details" });
      await expect(details.getByRole("heading", { name: client, exact: true })).toBeVisible();
      expect(await sales()).toEqual([sale]);
      expect(await lines()).toEqual([{ unit_price_cents: 5025, quantity: 1 }]);

      await details.getByRole("combobox", { name: "Product", exact: true }).selectOption(product.id);
      drop = true;
      await details.getByRole("button", { name: "Add item", exact: true }).click();
      await expect.poll(() => replies).toBe(4);
      await expect(details.getByRole("alert")).toContainText("Could not confirm");
      expect(await lines()).toHaveLength(2);
      await expect(retry).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Product added to checkout.", { exact: true })).toBeVisible();
      expect(await lines()).toHaveLength(2);

      await details.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
      const collect = details.getByRole("button", { name: /^Collect / });
      await expect(collect).toContainText(new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(100.50));
      const [laterItem] = await db`INSERT INTO commerce_sale_lines (tenant_id,sale_id,catalog_item_id,line_kind,title_snapshot,unit_price_cents,quantity)
        VALUES (${workspace.tenant_id},${sale.id},${product.id},'product','Synthetic item added from another register',5025,1) RETURNING id`;
      try {
        await collect.click();
        await expect(details.getByRole("alert")).toContainText("The total changed");
        expect(await ledger()).toHaveLength(0);
      } finally {
        await db`DELETE FROM commerce_sale_lines WHERE id=${laterItem.id}`;
      }
      drop = true;
      await collect.click();
      await expect.poll(() => replies).toBe(6);
      await expect(details.getByRole("alert")).toContainText("Could not confirm");
      await expect(page.getByText("Product added to checkout.", { exact: true })).toHaveCount(0);
      expect(await ledger()).toEqual([{ method: "cash", amount_cents: 10050 }]);
      await expect(retry).toBeFocused();
      await retry.click({ trial: true });
      await page.keyboard.press("Enter");
      await expect(details.getByText(/Closed checkout/i)).toBeVisible();
      expect(await ledger()).toEqual([{ method: "cash", amount_cents: 10050 }]);
      expect(await sales()).toEqual([{ id: sale.id, status: "closed" }]);
      const audit = await db`SELECT action FROM tenant_audit_events
        WHERE target_type='commerce_sale' AND target_id=${sale.id} AND action LIKE 'retail_checkout.%' ORDER BY created_at`;
      expect(audit).toEqual([{ action: "retail_checkout.created" }, { action: "retail_checkout.line_added" }, { action: "retail_checkout.closed" }]);
    } finally {
      await db.end();
    }
  });
}
