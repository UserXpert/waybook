import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

test.use({ actionTimeout: 6000 });

test("product editor preserves checkout availability, validates input and updates its photo", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const sku = `QA-${randomUUID()}`.toUpperCase();
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/products");
    await page.getByRole("link", { name: "Add product", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    await page.waitForLoadState("networkidle");
    const name = page.getByRole("textbox", { name: "Product name", exact: true });
    const availability = page.getByRole("switch", { name: "Available at checkout", exact: true });
    const upload = page.getByLabel("Product photo", { exact: true });
    const save = page.getByRole("button", { name: "Save product", exact: true });
    await name.fill("Synthetic Catalogue QA");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill(sku.toLowerCase());
    await page.getByRole("spinbutton", { name: "Price", exact: true }).fill("125.45");
    await page.getByText("Available at checkout", { exact: true }).click();
    await upload.setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("invalid image") });
    await save.click();
    await expect(page.getByRole("alert").filter({ hasText: "Use a genuine JPG" })).toBeVisible();
    await expect(name).toHaveValue("Synthetic Catalogue QA");
    expect(await db`SELECT id FROM commerce_catalog_items WHERE sku = ${sku}`).toHaveLength(0);

    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#a78bfa" } }).png().toBuffer();
    await upload.setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
    await save.click();
    await expect(page.getByRole("heading", { name: "Edit product", exact: true })).toBeVisible();
    const productUrl = page.url();
    await expect(availability).not.toBeChecked();
    await expect(page.getByRole("img", { name: "Current product" })).toBeVisible();
    const [first] = await db`SELECT is_active, price_cents, jsonb_typeof(metadata) AS metadata_type FROM commerce_catalog_items WHERE sku = ${sku}`;
    expect(first).toEqual({ is_active: false, price_cents: 12_545, metadata_type: "object" });
    await db`UPDATE commerce_catalog_items SET metadata = to_jsonb(metadata::text) WHERE sku = ${sku}`;
    await page.reload();
    await expect(page.getByRole("img", { name: "Current product" })).toBeVisible();

    await page.getByText("Remove photo", { exact: true }).click();
    await page.getByText("Available at checkout", { exact: true }).click();
    await save.click();
    await expect(page.getByText("Product saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(availability).toBeChecked();
    await expect(page.getByRole("img", { name: "Current product" })).toHaveCount(0);

    await page.getByRole("complementary", { name: "Edit product" }).getByRole("link", { name: "Close product editor" }).click();
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill(sku);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/\?q=/);
    await expect(page.getByRole("link", { name: "Open Synthetic Catalogue QA", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Add product", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    await name.fill("Duplicate SKU Draft");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
    await save.click();
    await expect(page.getByRole("alert").filter({ hasText: "That SKU already belongs" })).toBeVisible();
    await expect(name).toHaveValue("Duplicate SKU Draft");
    expect(await db`SELECT id FROM commerce_catalog_items WHERE sku = ${sku}`).toHaveLength(1);
    await page.goto(productUrl);
    await expect(name).toHaveValue("Synthetic Catalogue QA");
  } finally {
    try {
      await db`DELETE FROM commerce_catalog_items WHERE sku = ${sku} AND kind = 'product'`;
    } finally {
      await db.end();
    }
  }
});
