import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

test("waitlist preferences still save and historical free-text stays hidden", async ({ page }) => {
  // The Waybook E2E configuration requires a disposable local database.
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const suffix = randomUUID();
  const customerName = `Waitlist note test ${suffix}`;
  const historicalNote = `Synthetic historical waitlist note ${suffix}`;
  let customerId: string | undefined;

  try {
    const [workspace] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings LIMIT 1`;
    const [service] = await db<{ serviceId: string; locationId: string }[]>`
      SELECT sl.service_id AS "serviceId", sl.location_id AS "locationId"
      FROM service_locations sl
      JOIN services s ON s.tenant_id = sl.tenant_id AND s.id = sl.service_id
      JOIN locations l ON l.tenant_id = sl.tenant_id AND l.id = sl.location_id
      WHERE sl.tenant_id = ${workspace.tenantId} AND s.is_active AND l.is_active
      ORDER BY s.title, l.name LIMIT 1
    `;
    const [customer] = await db<{ id: string }[]>`INSERT INTO customers (tenant_id, name, email)
      VALUES (${workspace.tenantId}, ${customerName}, ${`waitlist-${suffix}@example.test`}) RETURNING id`;
    customerId = customer.id;
    const [oldEntry] = await db<{ id: string }[]>`INSERT INTO waitlist_entries (tenant_id, customer_id, service_id, location_id, notes)
      VALUES (${workspace.tenantId}, ${customer.id}, ${service.serviceId}, ${service.locationId}, ${historicalNote}) RETURNING id`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);

    await page.goto("/nordic/app/waitlist?add=1");
    await expect(page.getByText(customerName, { exact: true })).toBeVisible();
    await expect(page.getByText(historicalNote, { exact: true })).toHaveCount(0);
    const form = page.locator("form.waitlist-form");
    await expect(form.locator('[name="notes"]')).toHaveCount(0);
    await form.getByRole("textbox", { name: /(?:client|patient) search/i }).fill(suffix);
    await form.getByRole("combobox", { name: /^(?:Client|Patient)$/ }).selectOption(customer.id);
    await form.locator('select[name="locationId"]').selectOption(service.locationId);
    await form.locator('select[name="serviceId"]').selectOption(service.serviceId);
    await form.getByRole("button", { name: "Add to waitlist" }).click();
    await expect(form.getByRole("status")).toHaveText(/added to the waiting list/);

    const [old] = await db<{ notes: string }[]>`SELECT notes FROM waitlist_entries WHERE id = ${oldEntry.id}`;
    const newEntries = await db<{ notes: string | null }[]>`SELECT notes FROM waitlist_entries WHERE customer_id = ${customer.id} AND id <> ${oldEntry.id}`;
    expect(old.notes).toBe(historicalNote);
    expect(newEntries).toEqual([{ notes: null }]);
  } finally {
    try {
      if (customerId) {
        await db`DELETE FROM waitlist_entries WHERE customer_id = ${customerId}`;
        await db`DELETE FROM customers WHERE id = ${customerId}`;
      }
    } finally {
      await db.end();
    }
  }
});
