import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`public booking retries an interrupted request without duplicate confirmation in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const name = "QA interrupted public booking";
    const email = `qa-booking-retry-${randomUUID()}@example.test`;
    try {
      const [preset] = await db`SELECT s.title, l.id AS location_id
        FROM service_locations sl JOIN services s ON s.id=sl.service_id AND s.is_active
        JOIN locations l ON l.id=sl.location_id AND l.is_active AND l.is_online_bookable
        WHERE l.slug='primary' ORDER BY s.title LIMIT 1`;
      const api = `**/${workspace.route}/api/public`;
      await page.goto(`/${workspace.route}/book?location=${preset.location_id}`);
      await page.getByRole("button", { name: new RegExp(preset.title) }).first().click();
      await page.getByRole("button", { name: "Next dates" }).click();
      const firstSlot = page.locator(".tenant-time-grid button").first();
      await expect(firstSlot).toBeVisible();

      const date = page.locator(".tenant-day-list button[aria-pressed=true]");
      const chosenDate = (await date.textContent())!;
      const availabilityRequests = `${api}/availability?**`;
      await page.route(availabilityRequests, (route) => route.abort("failed"), { times: 1 });
      await date.click();
      await expect(page.getByRole("status")).toContainText("Could not find availability");
      await expect(date).toHaveText(chosenDate);
      const retryAvailability = page.getByRole("button", { name: "Retry availability" });
      await expect(retryAvailability).toBeVisible();
      await retryAvailability.click();
      await expect(firstSlot).toBeEnabled();
      await expect(date).toHaveText(chosenDate);

      await page.route(`${api}/holds`, (route) => route.abort("failed"), { times: 1 });
      await firstSlot.click();
      await expect(page.getByRole("status")).toContainText("Could not reserve this time");
      await expect(firstSlot).toBeEnabled();
      await firstSlot.click();

      const nameField = page.locator('input[name="name"]');
      const emailField = page.getByLabel("Email", { exact: true });
      await nameField.fill(name);
      await emailField.fill(email);
      const policy = page.locator('input[name="acceptedPolicy"]');
      if (await policy.count()) await policy.check();

      const confirmations = `${api}/confirmations`;
      let firstStatus: number | undefined;
      await page.route(confirmations, async (route) => {
        const response = await route.fetch();
        firstStatus = response.status();
        await route.abort("failed");
      }, { times: 1 });
      const submit = page.getByRole("button", { name: "Confirm booking" });
      await submit.click();
      await expect(page.getByRole("status")).toContainText("Could not confirm the booking");
      expect(firstStatus).toBe(201);
      await expect(nameField).toHaveValue(name);
      await expect(emailField).toHaveValue(email);
      if (await policy.count()) await expect(policy).toBeChecked();

      const replay = page.waitForResponse((response) => response.url().endsWith("/api/public/confirmations") && response.request().method() === "POST");
      await submit.click();
      expect((await replay).status()).toBe(200);
      await expect(page.locator(".tenant-complete-stage")).toContainText("Booking number:");
      const stored = await db`SELECT b.booking_number, (SELECT count(*)::int FROM email_outbox o WHERE o.booking_id=b.id AND o.message_type='confirmation') AS confirmations
        FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id WHERE c.email=${email}`;
      expect(stored).toHaveLength(1);
      expect(stored[0].confirmations).toBe(1);
      await expect(page.locator(".tenant-complete-stage")).toContainText(stored[0].booking_number);
    } finally {
      await db.end();
    }
  });
}
