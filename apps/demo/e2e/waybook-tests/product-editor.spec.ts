import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

test.use({ actionTimeout: 6000 });

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`product editor preserves availability and search, validates input and updates its photo in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const sku = `QA-${randomUUID()}`.toUpperCase();
  const revisedSku = `REVISED-${randomUUID()}`.toUpperCase();
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    await page.goto(`/${tenant.route}/app/products`);
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
    const options = page.getByRole("button", { name: "Options", exact: true });
    await options.click();
    await expect(page.getByRole("dialog", { name: "Edit product" })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill(sku);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === sku);
    await expect(page.getByRole("link", { name: "Open Synthetic Catalogue QA", exact: true })).toBeVisible();
    const openProduct = page.getByRole("link", { name: "Open Synthetic Catalogue QA", exact: true });
    const closeProduct = (label: string) => page.getByRole("complementary", { name: label }).getByRole("link", { name: "Close product editor" });
    await openProduct.click();
    await closeProduct("Edit product").click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === sku && !url.searchParams.has("product"));
    await options.click();
    await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue(sku);
    await page.getByRole("button", { name: "Close options" }).click();
    await page.getByRole("link", { name: "Add product", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    await name.fill("Duplicate SKU Draft");
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
    await save.click();
    await expect(page.getByRole("alert").filter({ hasText: "That SKU already belongs" })).toBeVisible();
    await expect(name).toHaveValue("Duplicate SKU Draft");
    await closeProduct("Add product").click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === sku && !url.searchParams.has("new"));
    await options.click();
    await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue(sku);
    await page.getByRole("button", { name: "Close options" }).click();
    expect(await db`SELECT id FROM commerce_catalog_items WHERE sku = ${sku}`).toHaveLength(1);
    await page.goto(productUrl);
    await expect(name).toHaveValue("Synthetic Catalogue QA");
    const filteredProductUrl = new URL(productUrl);
    filteredProductUrl.searchParams.set("q", sku);
    await page.goto(filteredProductUrl.toString());
    await page.getByRole("textbox", { name: "SKU", exact: true }).fill(revisedSku);
    await save.click();
    await expect(page.getByText("Product saved.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === sku && url.searchParams.has("product"));
    await expect(page.getByRole("textbox", { name: "SKU", exact: true })).toHaveValue(revisedSku);
    await closeProduct("Edit product").click();
    await options.click();
    await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue(sku);
    await page.getByRole("button", { name: "Close options" }).click();
    await expect(page.getByText("No matching products. Try a different name or SKU.", { exact: true })).toBeVisible();
  } finally {
    try {
      await db`DELETE FROM commerce_catalog_items WHERE sku IN (${sku}, ${revisedSku}) AND kind = 'product'`;
    } finally {
      await db.end();
    }
  }
});
