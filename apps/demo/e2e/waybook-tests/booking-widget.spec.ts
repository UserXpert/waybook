import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("booking widget completes a booking from a separate website and restores keyboard focus", async ({ page, request, baseURL }) => {
  for (const workspace of [
    { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
    { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
  ]) {
    await test.step(workspace.route, async () => {
      const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
      const [settings] = await db`SELECT tenant_id, booking_page, booking_page::text AS original FROM tenant_settings LIMIT 1`;
      const [preset] = await db`
        SELECT s.id AS service_id, s.title, l.id AS location_id, l.name AS location_name
        FROM service_locations sl JOIN services s ON s.id=sl.service_id AND s.is_active
        JOIN locations l ON l.id=sl.location_id AND l.is_active AND l.is_online_bookable
        WHERE sl.tenant_id=${settings.tenant_id} AND l.slug='primary' ORDER BY s.title LIMIT 1
      `;
      const bookingUrl = `${baseURL}/${workspace.route}/book`;
      const fallback = `${bookingUrl}?location=${preset.location_id}&service=${preset.service_id}`;
      const website = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Synthetic practice website</title><h1>Synthetic practice website</h1><a href="${fallback}">Booking page</a>
          <script src="${baseURL}/${workspace.route}/api/public/embed" data-location="${preset.location_id}" data-service="${preset.service_id}" async></script></html>`);
      });
      try {
        await new Promise<void>((resolve) => { website.listen(0, resolve); });
        const address = website.address();
        if (!address || typeof address === "string") throw new Error("Synthetic website has no assigned port.");
        const origin = `http://localhost:${address.port}`;
        const config = typeof settings.booking_page === "string" ? JSON.parse(settings.booking_page) : settings.booking_page;
        await db`UPDATE tenant_settings SET booking_page=${JSON.stringify({ ...config, embedOrigins: [origin] })}::text::jsonb WHERE tenant_id=${settings.tenant_id}`;
        const direct = await request.get(bookingUrl);
        expect(direct.headers()["x-frame-options"]).toBe("SAMEORIGIN");
        const unapproved = await request.get(`${baseURL}/${workspace.route}/embed`, { params: { source: "https://unapproved.example" } });
        expect(unapproved.status()).toBe(403);

        await page.goto(origin);
        const launcher = page.getByRole("button", { name: "Book an appointment" });
        const dialog = page.getByRole("dialog", { name: "Book an appointment" });
        const close = dialog.getByRole("button", { name: "Close booking" });
        await launcher.focus();
        await page.keyboard.press("Enter");
        await expect(close).toBeFocused();
        await page.locator("a[href]").evaluate((link) => link.focus(), undefined, { timeout: 5000 });
        await expect(close).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(launcher).toBeFocused();
        await launcher.click();

        const booking = page.frameLocator('iframe[title="Book an appointment"]').frameLocator("iframe");
        await expect(booking.getByRole("heading", { name: "Choose a time" })).toBeVisible();
        await expect(booking.getByRole("combobox", { name: "Location" })).toHaveValue(preset.location_name);
        await expect(booking.getByText(preset.title, { exact: false }).first()).toBeVisible();
        await booking.getByRole("button", { name: "Next dates" }).click();
        await booking.locator(".tenant-time-grid button").first().click();
        const email = `widget-${randomUUID()}@example.test`;
        await booking.getByRole("textbox", { name: /^(Name|Patient name)$/i }).fill("Synthetic widget visitor");
        await booking.getByRole("textbox", { name: "Email", exact: true }).fill(email);
        await booking.getByRole("button", { name: /Confirm booking/ }).click();
        await expect(booking.getByText("BOOKING CONFIRMED", { exact: true })).toBeVisible();
        expect(await db`
          SELECT b.service_id,b.location_id,a.metadata->>'source' AS source FROM bookings b
          JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
          JOIN tenant_audit_events a ON a.target_id=b.id::text AND a.tenant_id=b.tenant_id
          WHERE c.email=${email} AND a.action='booking.embed_source_verified'
        `).toEqual([{ service_id: preset.service_id, location_id: preset.location_id, source: origin }]);
        await close.click();
        await expect(launcher).toBeFocused();
        await page.getByRole("link", { name: "Booking page", exact: true }).click();
        await expect(page).toHaveURL(fallback);
        await expect(page.getByRole("heading", { name: "Choose a time" })).toBeVisible();
      } finally {
        await db`UPDATE tenant_settings SET booking_page=${settings.original}::text::jsonb WHERE tenant_id=${settings.tenant_id}`;
        await db.end();
        await new Promise<void>((resolve) => {
          website.close(() => resolve());
          website.closeAllConnections();
        });
      }
    });
  }
});
