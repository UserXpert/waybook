import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

test("online booking branding, policy and price settings persist for only the selected tenant", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const marker = randomUUID().slice(0, 8);
  const buttonLabel = `Book Nordic ${marker}`;
  const headline = `Nordic booking ${marker}`;
  const policy = `Changes need 24 hours of notice. QA ${marker}.`;
  const [before] = await db`SELECT tenant_id, booking_page::text AS booking_page FROM tenant_settings LIMIT 1`;
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/online-booking");

    const tabs = page.getByRole("navigation", { name: "Booking settings" });
    await page.getByLabel("Button label", { exact: true }).fill(buttonLabel);
    await page.getByLabel("Headline", { exact: true }).fill(headline);
    await tabs.getByText("Services", { exact: true }).click();
    await page.getByText("Show prices", { exact: true }).click();
    await expect(page.getByRole("switch", { name: /Show prices/ })).not.toBeChecked();
    await tabs.getByText("Locations", { exact: true }).click();
    const enabled = page.locator('input[name="onlineLocationIds"]:checked');
    await expect(enabled).toHaveCount(1);
    await enabled.locator("..").click();
    await expect(page.getByText("Keep at least one location enabled for online booking.")).toBeVisible();
    await expect(enabled).toHaveCount(1);
    await tabs.getByText("Cancellation / Reschedule", { exact: true }).click();
    await page.getByRole("textbox", { name: /^Cancellation and reschedule policy/ }).fill(policy);
    await page.getByRole("textbox", { name: /^Policy name or version/ }).fill(`QA-${marker}`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();

    await expect.poll(async () => {
      const [row] = await db`SELECT booking_page FROM tenant_settings WHERE tenant_id=${before.tenant_id}`;
      return typeof row.booking_page === "string" ? JSON.parse(row.booking_page) : row.booking_page;
    }).toMatchObject({ embedButtonLabel: buttonLabel, embedPanelTitle: headline, policyText: policy, policyVersion: `QA-${marker}`, showPrices: false });
    await page.reload();
    await expect(page.getByLabel("Button label", { exact: true })).toHaveValue(buttonLabel);
    await expect(page.getByLabel("Headline", { exact: true })).toHaveValue(headline);

    const launcher = page.locator(".booking-page-launcher button");
    await page.goto("/nordic/book");
    await expect(launcher).toHaveText(buttonLabel);
    await expect(page.getByText(headline, { exact: true })).toBeVisible();
    const service = page.getByRole("button", { name: /Studio session/ });
    await expect(service).toBeVisible();
    await expect(service).not.toContainText(/kr\.?|DKK/i);
    await page.goto("/copenhagen/book");
    await expect(launcher).not.toHaveText(buttonLabel);
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
  } finally {
    try {
      await db`UPDATE tenant_settings SET booking_page=${before.booking_page}::text::jsonb WHERE tenant_id=${before.tenant_id}`;
    } finally {
      await db.end();
    }
  }
});
