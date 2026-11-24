import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

test.use({ actionTimeout: 6000 });

test("a new package definition keeps its photo and issuing availability", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const title = `Synthetic package ${randomUUID()}`;
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/packages");
    await page.getByRole("link", { name: "Create definition", exact: true }).click();
    await expect(page).toHaveURL(/setup=new/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Package name", exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Search service", exact: true }).fill("Studio session");
    await page.getByRole("button", { name: "Studio session", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Included visits", exact: true }).fill("4");
    await page.getByRole("spinbutton", { name: "Package price (DKK)", exact: true }).fill("200.75");
    await page.getByText("Available to issue", { exact: true }).click();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#5fc4cd" } }).png().toBuffer();
    await page.getByLabel("Package photo", { exact: true }).setInputFiles({ name: "package.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Save package", exact: true }).click();
    await expect(page.getByText("Package saved.", { exact: true })).toBeVisible();

    const row = page.getByRole("link", { name: `Open ${title}`, exact: true });
    await expect(row).toContainText("Inactive");
    await row.click();
    await expect(page.getByRole("img", { name: "Current package" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Available to issue", exact: true })).not.toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Included visits", exact: true })).toHaveValue("4");
    const [persisted] = await db`SELECT is_active, price_cents, jsonb_typeof(metadata) AS metadata_type FROM commerce_catalog_items WHERE kind='package' AND title=${title}`;
    expect(persisted).toEqual({ is_active: false, price_cents: 20_075, metadata_type: "object" });
  } finally {
    try {
      await db`DELETE FROM commerce_package_service_entitlements WHERE catalog_item_id IN (SELECT id FROM commerce_catalog_items WHERE kind='package' AND title=${title})`;
      await db`DELETE FROM commerce_catalog_items WHERE kind='package' AND title=${title}`;
    } finally {
      await db.end();
    }
  }
});
