import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`retiring a service only removes it from new public bookings in ${tenant.route}`, async ({ page, browser, baseURL, ignoreHTTPSErrors }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const customer = await browser.newContext({ baseURL, ignoreHTTPSErrors });
  const suffix = randomUUID().slice(0, 8);
  const title = `QA public service ${suffix}`;
  const clientName = `QA service history ${suffix}`;
  const email = `service-${suffix}@example.test`;
  const app = `/${tenant.route}/app`;

  try {
    const fixture = await db.begin(async (tx) => {
      const [workspace] = await tx<{ id: string; locationId: string }[]>`
        SELECT l.tenant_id AS id, l.id AS "locationId" FROM locations l WHERE l.slug='primary'`;
      const [service] = await tx<{ id: string }[]>`INSERT INTO services
        (tenant_id,slug,title,duration_minutes,price_cents)
        VALUES (${workspace.id},${`qa-public-${suffix}`},${title},30,14550) RETURNING id`;
      const [staff] = await tx<{ id: string }[]>`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${workspace.id},${`QA service staff ${suffix}`},${`staff-${suffix}@example.test`},'staff') RETURNING id`;
      await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${workspace.id},${staff.id},${workspace.locationId})`;
      await tx`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${workspace.id},${service.id},${workspace.locationId})`;
      await tx`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${workspace.id},${service.id},${staff.id})`;
      const [client] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email)
        VALUES (${workspace.id},${clientName},${email}) RETURNING id`;
      const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${workspace.id},${staff.id},${workspace.locationId},now()-interval '2 days',now()-interval '2 days'+interval '30 minutes','confirmed')
        RETURNING id`;
      const [booking] = await tx<{ id: string }[]>`INSERT INTO bookings
        (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
        SELECT ${workspace.id},id,${service.id},${staff.id},${workspace.locationId},${client.id},starts_at,ends_at,'completed','tenant',14550
        FROM booking_blocks WHERE id=${block.id} RETURNING id`;
      return { workspace, service, booking };
    });

    const bookingPage = await customer.newPage();
    const publicUrl = `/${tenant.route}/book?location=${fixture.workspace.locationId}`;
    await bookingPage.goto(publicUrl);
    const serviceButton = bookingPage.getByRole("button", { name: new RegExp(title) });
    await expect(serviceButton).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === app);
    const editorUrl = `${app}/services?service=${fixture.service.id}`;
    await page.goto(editorUrl);
    const active = page.getByLabel("Available for booking");
    await active.uncheck();
    await page.getByRole("button", { name: "Save service", exact: true }).click();
    await expect(page.getByText("Service saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(active).not.toBeChecked();

    await bookingPage.reload();
    await expect(serviceButton).toHaveCount(0);
    await page.goto(`${app}/bookings?booking=${fixture.booking.id}`);
    const details = page.getByRole("complementary", { name: `Appointment with ${clientName}` });
    await expect(details.getByText(title, { exact: true }).first()).toBeVisible();
    const [saved] = await db`SELECT status,service_id,booked_price_cents FROM bookings
      WHERE id=${fixture.booking.id} AND tenant_id=${fixture.workspace.id}`;
    expect(saved).toEqual({ status: "completed", service_id: fixture.service.id, booked_price_cents: 14550 });

    await page.goto(editorUrl);
    await active.check();
    await page.getByRole("button", { name: "Save service", exact: true }).click();
    await expect(page.getByText("Service saved.", { exact: true })).toBeVisible();
    await bookingPage.reload();
    await expect(serviceButton).toBeVisible();
  } finally {
    await Promise.all([customer.close(), db.end()]);
  }
});
