import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const kroner = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`Bookings shows exact paid and outstanding amounts in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const suffix = randomUUID();
  const customer = `Booking settlement ${suffix.slice(0, 8)}`;
  try {
    const booking = await db.begin(async (sql) => {
      const [workspace] = await sql`SELECT tenant_id,timezone FROM tenant_settings LIMIT 1`;
      const [location] = await sql`SELECT id FROM locations WHERE tenant_id=${workspace.tenant_id} AND is_active ORDER BY slug='primary' DESC,id LIMIT 1`;
      const [service] = await sql`SELECT id FROM services WHERE tenant_id=${workspace.tenant_id} AND is_active ORDER BY id LIMIT 1`;
      const [member] = await sql`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${workspace.tenant_id},'Settlement QA member',${`staff-${suffix}@example.test`},'staff') RETURNING id`;
      const [client] = await sql`INSERT INTO customers (tenant_id,name,email)
        VALUES (${workspace.tenant_id},${customer},${`${suffix}@example.test`}) RETURNING id`;
      const [block] = await sql`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${workspace.tenant_id},${member.id},${location.id},now()-interval '25 hours',now()-interval '24 hours','confirmed') RETURNING id,starts_at,ends_at`;
      const [created] = await sql`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,booked_price_cents)
        VALUES (${workspace.tenant_id},${block.id},${service.id},${member.id},${location.id},${client.id},${block.starts_at},${block.ends_at},'completed',25075)
        RETURNING id,tenant_id,customer_id`;
      return created;
    });

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const app = `/${tenant.route}/app`;
    await expect(page).toHaveURL((url) => url.pathname === app);
    const bookingList = `${app}/bookings?q=${encodeURIComponent(customer)}`;
    await page.goto(`${bookingList}&booking=${booking.id}`);
    const detail = page.getByRole("complementary", { name: `Appointment with ${customer}` });
    const payment = detail.locator(".appointment-payment-form");
    await payment.getByRole("combobox", { name: "Payment", exact: true }).selectOption("payment");
    await payment.getByLabel("Method").selectOption("cash");
    await payment.getByRole("spinbutton", { name: "Amount (DKK)" }).fill("150.50");
    await payment.getByRole("button", { name: "Record entry" }).click();
    await expect(payment.getByRole("status")).toContainText("Payment recorded");

    await page.goto(bookingList);
    const row = page.getByRole("row").filter({ hasText: customer });
    const paid = row.getByRole("link", { name: `${kroner.format(150.50)} paid`, exact: true });
    await expect(paid).toBeVisible({ timeout: 3000 });
    await expect(row).toContainText(`${kroner.format(100.25)} due`);
    await paid.click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/sales` && url.searchParams.has("sale"));
    await expect(page.getByRole("link", { name: "Open appointment", exact: true })).toBeVisible();
    expect(await db`SELECT kind,amount_cents,method FROM payment_records WHERE booking_id=${booking.id}`).toEqual([
      { kind: "payment", amount_cents: 15050, method: "cash" },
    ]);

    await db`INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method)
      SELECT ${booking.tenant_id},${booking.id},'payment',101,'cash' FROM generate_series(1,11)`;
    await db`INSERT INTO payment_records (tenant_id,booking_id,kind,amount_cents,method)
      VALUES (${booking.tenant_id},${booking.id},'refund',101,'cash')`;
    await page.goto(`${app}/customers?customer=${booking.customer_id}`);
    const client = page.getByRole("complementary", { name: new RegExp(`record for ${customer}$`) });
    await expect(client.getByText("Booked value", { exact: true }).locator("..")).toContainText(kroner.format(250.75));
    await expect(client.getByText("Paid to date", { exact: true }).locator("..")).toContainText(kroner.format(160.60));
    const recent = client.locator("#client-wallet").getByRole("listitem");
    await expect(recent).toHaveCount(12);
    await expect(recent.filter({ hasText: `−${kroner.format(1.01)}` })).toHaveCount(1);
  } finally {
    await db.end();
  }
});
