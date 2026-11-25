import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`Manage booking ignores previous lookups and retries the same day in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const email = `qa-manage-reopen-${randomUUID()}@example.test`;
    try {
      const [preset] = await db`SELECT s.title, l.id AS location_id
        FROM service_locations sl JOIN services s ON s.id=sl.service_id AND s.is_active
        JOIN locations l ON l.id=sl.location_id AND l.is_active AND l.is_online_bookable
        WHERE l.slug='primary' ORDER BY s.title LIMIT 1`;
      await page.goto(`/${workspace.route}/book?location=${preset.location_id}`);
      await page.getByRole("button", { name: new RegExp(preset.title) }).first().click();
      await page.getByRole("button", { name: "Next dates" }).click();
      await page.locator(".tenant-time-grid button").first().click();
      await page.locator('input[name="name"]').fill("QA booking dialog reopen");
      await page.getByLabel("Email", { exact: true }).fill(email);
      const policy = page.locator('input[name="acceptedPolicy"]');
      if (await policy.count()) await policy.check();
      await page.getByRole("button", { name: "Confirm booking" }).click();
      const confirmation = page.locator(".tenant-complete-stage");
      await expect(confirmation).toContainText("Booking number:");
      const number = (await confirmation.innerText()).match(/Booking number:\s*([A-Z0-9]+)/)?.[1];
      expect(number).toBeTruthy();

      let releaseLookup!: () => void;
      const heldResponse = new Promise<void>((resolve) => { releaseLookup = resolve; });
      let reportLookupStatus!: (status: number) => void;
      const lookupStatus = new Promise<number>((resolve) => { reportLookupStatus = resolve; });
      await page.route(`**/${workspace.route}/api/public/manage`, async (route) => {
        const response = await route.fetch();
        reportLookupStatus(response.status());
        await heldResponse;
        await route.fulfill({ response });
      }, { times: 1 });
      const open = page.getByRole("button", { name: "Manage booking" });
      const dialog = page.getByRole("dialog");
      const numberField = dialog.getByLabel("Booking number");
      const emailField = dialog.getByLabel("Email address");
      const lookup = dialog.getByRole("button", { name: "Find booking", exact: true });
      await open.click();
      await numberField.fill(number!);
      await emailField.fill(email);
      await lookup.click();
      try {
        expect(await lookupStatus).toBe(200);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await expect(dialog).toBeHidden();
        await open.click();
        await expect(dialog.getByRole("heading", { name: "Find your booking" })).toBeVisible();
        const response = page.waitForResponse((value) => value.url().endsWith("/api/public/manage"));
        releaseLookup();
        await (await response).finished();
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await expect(dialog.getByRole("heading", { name: "Find your booking" })).toBeVisible();
        await expect(numberField).toHaveValue("");
        await expect(emailField).toHaveValue("");
        await numberField.fill(number!);
        await emailField.fill(email);
        await lookup.click();
        await expect(dialog.getByRole("heading", { name: "Your booking", exact: true })).toBeVisible();
        await expect(dialog).toContainText(preset.title);

        const [appointment] = await db`SELECT starts_at::text AS starts_at,
          to_char(starts_at AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD') AS day
          FROM bookings WHERE booking_number=${number}`;
        await dialog.getByRole("button", { name: "Reschedule booking" }).click();
        await expect(dialog.getByRole("status")).toBeHidden();
        const date = dialog.getByLabel("Day");
        await page.route(`**/${workspace.route}/api/public/manage`, (route) => route.abort("failed"), { times: 1 });
        await date.fill(appointment.day);
        await expect(dialog.getByRole("alert")).toContainText("We couldn’t connect");
        await expect(date).toHaveValue(appointment.day);
        await dialog.getByRole("button", { name: "Retry availability" }).click();
        await expect(dialog.locator(".booking-manage-times button").first()).toBeVisible();
        await expect(dialog.getByRole("alert")).toBeHidden();
        await expect(date).toHaveValue(appointment.day);
        const [unchanged] = await db`SELECT starts_at::text AS starts_at FROM bookings WHERE booking_number=${number}`;
        expect(unchanged.starts_at).toBe(appointment.starts_at);
      } finally {
        releaseLookup();
      }
    } finally {
      await db.end();
    }
  });
}
