import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

test("retail checkout totals two lines and closes with one manual tender", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  try {
    const [workspace] = await db`SELECT tenant_id FROM tenant_settings LIMIT 1`;
    const suffix = randomUUID();
    const client = `Retail QA ${suffix}`;
    const [customer] = await db`INSERT INTO customers (tenant_id,name,email) VALUES (${workspace.tenant_id},${client},${`retail-${suffix}@example.test`}) RETURNING id`;
    const products = await db`INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency)
      VALUES (${workspace.tenant_id},'product','Retail QA Shampoo',4500,'DKK'),
             (${workspace.tenant_id},'product','Retail QA Conditioner',6500,'DKK') RETURNING id,title`;
    const shampoo = products.find((item) => item.title === "Retail QA Shampoo")!;
    const conditioner = products.find((item) => item.title === "Retail QA Conditioner")!;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/sales");
    await page.getByRole("link", { name: "New checkout", exact: true }).click();
    await expect(page).toHaveURL(/\/sales\/retail/);
    await page.getByPlaceholder("Search name, email, or phone").fill(client);
    await page.getByRole("combobox", { name: "Client", exact: true }).selectOption(customer.id);
    await page.getByRole("combobox", { name: "Product", exact: true }).selectOption(shampoo.id);
    await page.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("2");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await expect(page).toHaveURL(/[?&]sale=/);
    const checkout = page.getByRole("complementary", { name: "Retail checkout details" });
    await expect(checkout.getByRole("heading", { name: client, exact: true })).toBeVisible();
    const saleId = new URL(page.url()).searchParams.get("sale");
    await checkout.getByRole("combobox", { name: "Product", exact: true }).selectOption(conditioner.id);
    await checkout.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page.getByText("Product added to checkout.", { exact: true })).toBeVisible();
    await checkout.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
    const collect = checkout.getByRole("button", { name: /^Collect / });
    await expect(collect).toContainText("155");
    await collect.click();
    await expect(page.getByText("Payment collected.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(checkout.getByText(/Closed checkout/i)).toBeVisible();
    await expect(collect).toHaveCount(0);
    await expect(checkout.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);

    await db`UPDATE commerce_catalog_items SET price_cents=99999 WHERE id=${shampoo.id}`;
    const lines = await db`SELECT title_snapshot, unit_price_cents, quantity FROM commerce_sale_lines WHERE sale_id=${saleId} ORDER BY title_snapshot`;
    expect(lines).toEqual([
      { title_snapshot: "Retail QA Conditioner", unit_price_cents: 6500, quantity: 1 },
      { title_snapshot: "Retail QA Shampoo", unit_price_cents: 4500, quantity: 2 },
    ]);
    expect(await db`SELECT method, amount_cents FROM commerce_sale_transactions WHERE sale_id=${saleId}`).toEqual([
      { method: "cash", amount_cents: 15_500 },
    ]);
  } finally {
    await db.end();
  }
});
