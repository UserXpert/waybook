import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const workspace of [
  { route: "nordic", email: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", email: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) {
  test(`Waitlist preserves valid preferred hours without requiring a date in ${workspace.route}`, async ({ page }) => {
    const url = new URL(process.env[workspace.database]!);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toMatch(/^\/waybook_e2e_/);
    const db = postgres(url.toString(), { max: 1, ssl: false });
    try {
      const [{ tenantId }] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings`;
      const [eligible] = await db<{ serviceId: string; locationId: string }[]>`
        SELECT s.id AS "serviceId", l.id AS "locationId"
        FROM service_locations sl JOIN services s ON s.tenant_id=sl.tenant_id AND s.id=sl.service_id
        JOIN locations l ON l.tenant_id=sl.tenant_id AND l.id=sl.location_id
        WHERE sl.tenant_id=${tenantId} AND s.is_active AND l.is_active AND l.slug='primary' LIMIT 1
      `;
      const tag = randomUUID().slice(0, 8);
      const [client] = await db<{ id: string }[]>`
        INSERT INTO customers (tenant_id,name,email) VALUES (${tenantId},${`QA waitlist time ${tag}`},${`qa-waitlist-${tag}@example.test`}) RETURNING id
      `;
      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.email);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const app = `/${workspace.route}/app`;
      await expect(page).toHaveURL((url) => url.pathname === app);
      await page.goto(`${app}/waitlist?add=1`);
      const form = page.locator("form.waitlist-form");
      await form.getByRole("textbox", { name: /(?:client|patient) search/i }).fill(tag);
      await form.getByRole("combobox", { name: /^(?:Client|Patient)$/ }).selectOption(client.id);
      await form.locator('select[name="locationId"]').selectOption(eligible.locationId);
      await form.locator('select[name="serviceId"]').selectOption(eligible.serviceId);
      await form.getByRole("switch", { name: "Set a preferred time", exact: true }).click();
      const start = form.getByRole("slider", { name: "Preferred appointment window starts" });
      const end = form.getByRole("slider", { name: "Preferred appointment window ends" });
      await start.press("End");
      await start.press("ArrowRight");
      await end.press("Home");
      await end.press("ArrowLeft");
      await expect(form.locator('input[name="preferredStartTime"]')).toHaveValue("16:30");
      await expect(form.locator('input[name="preferredEndTime"]')).toHaveValue("17:00");
      await form.getByRole("button", { name: "Add to waitlist" }).click();
      await expect(form.getByRole("status").filter({ hasText: /added to the waiting list/ })).toBeVisible();
      const stored = await db`
        SELECT preferred_start_time::text AS start,preferred_end_time::text AS "end", preferred_local_date AS date
        FROM waitlist_entries WHERE tenant_id=${tenantId} AND customer_id=${client.id}
      `;
      expect(stored).toEqual([{ start: "16:30:00", end: "17:00:00", date: null }]);
      await page.goto(`${app}/waitlist`);
      const row = page.getByRole("row").filter({ hasText: `QA waitlist time ${tag}` });
      await expect(row).toContainText("Any date");
      await expect(row).toContainText("16:30–17:00");
    } finally {
      await db.end();
    }
  });
}
