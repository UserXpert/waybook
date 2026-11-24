import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`retail checkout preserves a paid sale after a catalogue change in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
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
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    await page.goto(`/${tenant.route}/app/sales`);
    await page.getByRole("link", { name: "New checkout", exact: true }).click();
    await expect(page).toHaveURL(/\/sales\/retail/);
    await page.getByPlaceholder("Search name, email, or phone").fill(client);
    await page.getByRole("combobox", { name: /^(Client|Patient)$/ }).selectOption(customer.id);
    await page.getByRole("combobox", { name: "Product", exact: true }).selectOption(shampoo.id);
    await page.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("2");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await expect(page).toHaveURL(/[?&]sale=/);
    const checkout = page.getByRole("complementary", { name: "Retail checkout details" });
    await expect(checkout.getByRole("heading", { name: client, exact: true })).toBeVisible();
    const saleId = new URL(page.url()).searchParams.get("sale");
    const saleUrl = page.url();
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

    await page.goto(`/${tenant.route}/app/products?product=${shampoo.id}`);
    const product = page.getByRole("complementary", { name: "Edit product" });
    await product.getByRole("textbox", { name: "Product name", exact: true }).fill("Retired QA Shampoo");
    await product.getByRole("spinbutton", { name: "Price", exact: true }).fill("99.99");
    await product.getByText("Available at checkout", { exact: true }).click();
    await product.getByRole("button", { name: "Save product", exact: true }).click();
    await expect(page.getByText("Product saved.", { exact: true })).toBeVisible();
    expect(await db`SELECT title, price_cents, is_active FROM commerce_catalog_items WHERE id=${shampoo.id}`).toEqual([
      { title: "Retired QA Shampoo", price_cents: 9999, is_active: false },
    ]);

    await page.goto(saleUrl);
    await expect(checkout.getByText(/Closed checkout/i)).toBeVisible();
    await expect(checkout.getByText("Retail QA Shampoo", { exact: true })).toBeVisible();
    await expect(checkout.getByText("Retired QA Shampoo", { exact: true })).toHaveCount(0);
    await expect(collect).toHaveCount(0);
    await expect(checkout.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
    await checkout.getByRole("link", { name: "Close checkout", exact: true }).click();
    await expect(checkout).toHaveCount(0);
    const productsForSale = page.getByRole("combobox", { name: "Product", exact: true });
    await expect(productsForSale.locator(`option[value="${shampoo.id}"]`)).toHaveCount(0);
    await expect(productsForSale.locator(`option[value="${conditioner.id}"]`)).toHaveCount(1);
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
