import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`appointment sales can find older records and count all matches in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const tag = `QA sales ${randomUUID().slice(0, 8)}`;
    const olderName = `${tag} older`;
    try {
      const fixture = await db.begin(async (tx) => {
        const [preset] = await tx`SELECT tm.tenant_id, tm.id AS member_id, l.id AS location_id, s.id AS service_id
          FROM team_members tm JOIN locations l ON l.tenant_id=tm.tenant_id AND l.slug='primary'
          JOIN services s ON s.tenant_id=tm.tenant_id AND s.is_active WHERE tm.role='owner' ORDER BY s.id LIMIT 1`;
        const [newer, older] = await tx`INSERT INTO customers (tenant_id,name,email)
          VALUES (${preset.tenant_id}, ${tag}, ${`${randomUUID()}@example.test`}),
            (${preset.tenant_id}, ${olderName}, ${`${randomUUID()}@example.test`}) RETURNING id`;
        const bookings = await tx`
          WITH intervals AS (
            SELECT '2041-01-01 09:00:00Z'::timestamptz + i * interval '2 hours' AS starts_at
            FROM generate_series(1,152) i
          ), blocks AS (
            INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
            SELECT ${preset.tenant_id},${preset.member_id},${preset.location_id},starts_at,starts_at + interval '1 hour',
              CASE WHEN starts_at=(SELECT min(starts_at) FROM intervals) THEN 'cancelled' ELSE 'confirmed' END
            FROM intervals RETURNING id, starts_at, ends_at
          )
          INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
          SELECT ${preset.tenant_id},id,${preset.service_id},${preset.member_id},${preset.location_id},
            CASE WHEN starts_at=(SELECT min(starts_at) FROM intervals) THEN ${older.id}::uuid ELSE ${newer.id}::uuid END,
            starts_at,ends_at,CASE WHEN starts_at=(SELECT min(starts_at) FROM intervals) THEN 'cancelled' ELSE 'confirmed' END,'tenant',10025
          FROM blocks RETURNING id,booking_block_id,customer_id`;
        const olderBooking = bookings.find((booking) => booking.customer_id === older.id)!;
        const [sale] = await tx`SELECT id FROM commerce_sales WHERE booking_id=${olderBooking.id}`;
        return { saleId: sale.id, locationId: preset.location_id, bookings, customerIds: [newer.id, older.id] };
      });
      try {
        const path = `/${workspace.route}/app/sales`;
        const query = new URLSearchParams({ q: tag, location: fixture.locationId });
        await page.goto("/login");
        await page.getByLabel("Work email").fill(workspace.owner);
        await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${workspace.route}/app`));
        await page.goto(`${path}?${query}`);
        const sort = page.getByRole("combobox", { name: "Sort by", exact: true });
        const paymentActivity = page.getByRole("combobox", { name: "Payment activity", exact: true });
        await expect(sort).toHaveValue("appointment-today");
        await expect(page.getByRole("columnheader", { name: "Appointment date" })).toHaveAttribute("aria-sort", "other");
        await expect(page.locator("tbody tr").first()).toContainText(olderName);
        await sort.selectOption("appointment-newest");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(sort).toHaveValue("appointment-newest");
        await expect(page.getByRole("columnheader", { name: "Appointment date" })).toHaveAttribute("aria-sort", "descending");
        const summary = page.locator(".waybook-data-metrics article").filter({ hasText: "Open balance" });
        const expected = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(151 * 100.25);
        await expect(summary.locator("strong")).toHaveText(expected);
        await expect(page.getByRole("cell", { name: olderName, exact: true })).toHaveCount(0);
        const pagination = page.getByRole("navigation", { name: "Appointment sales pages" });
        await expect(pagination).toContainText("Showing 1–150 of 152");
        await pagination.getByRole("link", { name: "Next page" }).click();
        await expect(pagination).toContainText("Showing 151–152 of 152");
        const olderRow = page.getByRole("row").filter({ hasText: olderName });
        await expect(olderRow).toContainText("No checkout");
        await expect(olderRow).not.toContainText("Open to checkout");
        await olderRow.getByRole("link", { name: /Appointment/ }).click();
        const details = page.getByLabel(`Sale details for ${olderName}`);
        await expect(details).toBeVisible();
        await details.getByRole("link", { name: "Close sale details" }).click();
        await expect(olderRow).toBeVisible();
        await expect(summary.locator("strong")).toHaveText(expected);
        await pagination.getByRole("link", { name: "Previous page" }).click();
        await expect(olderRow).toHaveCount(0);
        await page.getByLabel("Status").selectOption("cancelled");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(olderRow).toBeVisible();
        await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
        await page.getByLabel("Status").selectOption("all");
        await sort.selectOption("appointment-oldest");
        await paymentActivity.selectOption("without");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(page.getByRole("columnheader", { name: "Appointment date" })).toHaveAttribute("aria-sort", "ascending");
        await expect(page.locator("tbody tr").first()).toContainText(olderName);
        await pagination.getByRole("link", { name: "Next page" }).click();
        await expect(pagination).toContainText("Showing 151–152 of 152");
        await expect(sort).toHaveValue("appointment-oldest");
        await expect(paymentActivity).toHaveValue("without");
        await pagination.getByRole("link", { name: "Previous page" }).click();
        await olderRow.getByRole("link", { name: /Appointment/ }).click();
        await expect(details).toBeVisible();
        await details.getByRole("link", { name: "Close sale details" }).click();
        await expect(sort).toHaveValue("appointment-oldest");
        await expect(paymentActivity).toHaveValue("without");
        await expect(page.locator("tbody tr").first()).toContainText(olderName);

        await page.getByLabel("Appointment date range from").fill("2041-01-01");
        await page.getByLabel("Appointment date range to").fill("2041-01-01");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(page.locator("tbody tr")).toHaveCount(6);
        await expect(olderRow).toBeVisible();
        await olderRow.getByRole("link", { name: /Appointment/ }).click();
        await details.getByRole("link", { name: "Close sale details" }).click();
        await expect(page.getByLabel("Appointment date range to")).toHaveValue("2041-01-01");

        await paymentActivity.selectOption("with");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(page.getByText("No appointment sales match these filters.")).toBeVisible();
        await page.goto(`${path}?sale=${fixture.saleId}`);
        await expect(details).toBeVisible();
      } finally {
        await db.begin(async (tx) => {
          const bookingIds = fixture.bookings.map((row) => row.id);
          const blockIds = fixture.bookings.map((row) => row.booking_block_id);
          await tx`DELETE FROM commerce_sale_lines WHERE sale_id IN (SELECT id FROM commerce_sales WHERE booking_id=ANY(${bookingIds}::uuid[]))`;
          await tx`DELETE FROM commerce_sales WHERE booking_id=ANY(${bookingIds}::uuid[])`;
          await tx`DELETE FROM bookings WHERE id=ANY(${bookingIds}::uuid[])`;
          await tx`DELETE FROM booking_blocks WHERE id=ANY(${blockIds}::uuid[])`;
          await tx`DELETE FROM customers WHERE id=ANY(${fixture.customerIds}::uuid[])`;
        });
      }
    } finally {
      await db.end();
    }
  });
}
