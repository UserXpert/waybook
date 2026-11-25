import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

test("Services, Locations and Resources preserve disabled availability", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const label = `Isolated setup QA ${randomUUID()}`;
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    for (const { route, label: module, field, checkboxes, success } of [
      { route: "services", label: "service", field: "Service name", checkboxes: ["Available for booking"], success: "Service saved." },
      { route: "locations", label: "location", field: "Location name", checkboxes: ["Customers can book this location online", "Active location"], success: "Location saved." },
      { route: "resources", label: "resource", field: "Resource name", checkboxes: ["Active resource", /Mutually exclusive/], success: "Resource saved." },
    ]) {
      await test.step(module, async () => {
        await page.goto(`/nordic/app/${route}`);
        await page.getByRole("link", { name: `Add ${module}`, exact: true }).click();
        await expect(page).toHaveURL(/new=1/);
        await page.waitForLoadState("networkidle");
        await page.getByRole("textbox", { name: field, exact: true }).fill(label);
        if (module === "resource") await page.getByRole("textbox", { name: "Type", exact: true }).fill("Room");
        for (const name of checkboxes) await page.getByLabel(name).uncheck();
        await page.getByRole("button", { name: `Save ${module}`, exact: true }).click();
        await expect(page.getByText(success, { exact: true })).toBeVisible();
        await page.reload();
        for (const name of checkboxes) await expect(page.getByLabel(name)).not.toBeChecked();
        if (module === "service") {
          await db`UPDATE services SET buffer_before_minutes=15, buffer_after_minutes=10 WHERE title=${label}`;
          await page.getByRole("spinbutton", { name: "Duration (minutes)", exact: true }).fill("45");
          await page.getByRole("spinbutton", { name: "Price (DKK)", exact: true }).fill("175.95");
          await page.getByRole("button", { name: "Save service", exact: true }).click();
          await expect(page.getByText("Service saved.", { exact: true })).toBeVisible();
          const [details] = await db`SELECT duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents FROM services WHERE title=${label}`;
          expect(details).toEqual({ duration_minutes: 45, buffer_before_minutes: 15, buffer_after_minutes: 10, price_cents: 17_595 });
        }
      });
    }
    expect(await db`SELECT is_active FROM services WHERE title = ${label}`).toEqual([{ is_active: false }]);
    expect(await db`SELECT is_active, is_online_bookable FROM locations WHERE name = ${label}`).toEqual([{ is_active: false, is_online_bookable: false }]);
    expect(await db`SELECT is_active, is_mutually_exclusive FROM resources WHERE name = ${label}`).toEqual([{ is_active: false, is_mutually_exclusive: false }]);
  } finally {
    try {
      await db`DELETE FROM resources WHERE name = ${label}`;
      await db`DELETE FROM locations WHERE name = ${label}`;
      await db`DELETE FROM services WHERE title = ${label}`;
    } finally {
      await db.end();
    }
  }
});
