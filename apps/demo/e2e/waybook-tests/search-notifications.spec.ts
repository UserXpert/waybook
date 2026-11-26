import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`global search and overdue notifications open the intended appointment in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const suffix = randomUUID().slice(0, 8);
  const prefix = `QA Search ${suffix}`;
  const clientName = `${prefix} Ann`;
  const similarName = `${prefix} Anna`;
  const email = `ann-${suffix}@example.test`;
  const app = `/${tenant.route}/app`;

  try {
    const fixture = await db.begin(async (tx) => {
      const [workspace] = await tx<{ id: string; locationId: string; serviceId: string }[]>`
        SELECT ts.tenant_id AS id, l.id AS "locationId", s.id AS "serviceId"
        FROM tenant_settings ts
        JOIN locations l ON l.tenant_id=ts.tenant_id AND l.slug='primary'
        JOIN service_locations sl ON sl.tenant_id=ts.tenant_id AND sl.location_id=l.id
        JOIN services s ON s.tenant_id=ts.tenant_id AND s.id=sl.service_id AND s.is_active
        ORDER BY s.id LIMIT 1`;
      const [client] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email)
        VALUES (${workspace.id},${clientName},${email}) RETURNING id`;
      await tx`INSERT INTO customers (tenant_id,name,email)
        VALUES (${workspace.id},${similarName},${`anna-${suffix}@example.test`})`;
      const [staff] = await tx<{ id: string }[]>`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${workspace.id},${`QA Search Staff ${suffix}`},${`staff-${suffix}@example.test`},'staff') RETURNING id`;
      await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id)
        VALUES (${workspace.id},${staff.id},${workspace.locationId})`;
      const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${workspace.id},${staff.id},${workspace.locationId},now()-interval '2 hours',now()-interval '90 minutes','confirmed')
        RETURNING id`;
      const [booking] = await tx<{ id: string; number: string }[]>`INSERT INTO bookings
        (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
        SELECT ${workspace.id},id,${workspace.serviceId},${staff.id},${workspace.locationId},${client.id},starts_at,ends_at,'arrived','tenant',10000
        FROM booking_blocks WHERE id=${block.id} RETURNING id,booking_number AS number`;
      return { client, booking, workspace };
    });

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === app);

    const search = page.getByRole("button", { name: /^Search bookings or / });
    const apps = page.getByRole("button", { name: "Apps", exact: true });
    const header = page.locator('header[aria-label="Tenant dashboard navigation"]');
    const closedAppsBox = await apps.boundingBox();
    const closedHeaderBox = await header.boundingBox();
    await search.click();
    const query = page.getByRole("textbox", { name: /^Search bookings or / });
    await expect(query).toBeFocused();
    await expect(query).toHaveCSS("outline-style", "none");
    await expect(page.getByRole("search")).toHaveCSS("box-shadow", "none");
    const closeSearch = page.getByRole("button", { name: "Close search", exact: true });
    const closeColor = await closeSearch.evaluate((element) => getComputedStyle(element).color);
    await closeSearch.hover();
    await expect(closeSearch).toHaveCSS("border-radius", "50%");
    await expect(closeSearch).toHaveCSS("color", closeColor);
    const [appsBox, searchBox] = await Promise.all([
      apps.boundingBox(),
      page.getByRole("search").boundingBox(),
    ]);
    expect(appsBox).toEqual(closedAppsBox);
    expect(await header.boundingBox()).toEqual(closedHeaderBox);
    expect(appsBox!.x + appsBox!.width <= searchBox!.x || appsBox!.y + appsBox!.height <= searchBox!.y).toBe(true);
    await query.press("Escape");
    await expect(search).toBeFocused();
    await search.press("Enter");
    await expect(query).toBeFocused();
    await page.getByRole("button", { name: "Close search", exact: true }).click();
    await expect(search).toBeFocused();
    await search.press("Enter");
    await query.fill(prefix);
    await query.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === `${app}/search` && url.searchParams.get("q") === prefix);
    await expect(page.getByRole("heading", { name: "3 matching results" })).toBeVisible();
    const appointment = page.getByRole("row").filter({ hasText: email }).filter({ hasText: "arrived" });
    await appointment.getByRole("link").click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars` && url.searchParams.get("booking") === fixture.booking.id);
    await expect(page.getByText("Current: arrived", { exact: true })).toBeVisible();
    await page.getByRole("complementary", { name: `Appointment with ${clientName}` })
      .getByRole("button", { name: "Close appointment" }).click();

    await search.click();
    await query.fill(fixture.booking.number);
    await query.press("Enter");
    await expect(page.getByRole("heading", { name: "1 matching result", exact: true })).toBeVisible();
    await page.getByRole("row").filter({ hasText: fixture.booking.number }).getByRole("link").click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars`
      && url.searchParams.get("booking") === fixture.booking.id
      && url.searchParams.get("location") === fixture.workspace.locationId);
    const referenceDrawer = page.getByRole("complementary", { name: `Appointment with ${clientName}` });
    await expect(referenceDrawer.getByText(fixture.booking.number, { exact: true })).toBeVisible();
    await referenceDrawer.getByRole("button", { name: "Close appointment" }).click();

    await search.click();
    await query.fill(prefix);
    await query.press("Enter");
    await expect(page.getByRole("link", { name: similarName, exact: true })).toBeVisible();
    await page.getByRole("link", { name: clientName, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/customers` && url.searchParams.get("customer") === fixture.client.id);
    await expect(page.getByRole("heading", { name: clientName, exact: true })).toBeVisible();
    await page.locator(".client-record").getByRole("link", { name: /^Close (client|patient) record$/ }).click();

    const notifications = page.getByRole("link", { name: "Notifications: appointments need review" });
    const bell = notifications.locator("svg");
    const unread = notifications.locator(".tenant-nav-tools__notification-dot");
    await expect(unread).toHaveCSS("background-color", "rgb(25, 132, 93)");
    const [iconBox, dotBox] = await Promise.all([bell.boundingBox(), unread.boundingBox()]);
    const dotCenterX = dotBox!.x + dotBox!.width / 2;
    const dotCenterY = dotBox!.y + dotBox!.height / 2;
    expect(dotCenterX).toBeGreaterThan(iconBox!.x + iconBox!.width / 2);
    expect(dotCenterY).toBeLessThan(iconBox!.y + iconBox!.height / 2);
    await notifications.click();
    await expect(page.getByRole("heading", { name: "Appointments needing review" })).toBeVisible();
    const review = page.getByRole("row").filter({ hasText: clientName });
    await review.getByRole("link", { name: "Review booking" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars` && url.searchParams.get("booking") === fixture.booking.id);
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await page.getByRole("button", { name: "Save status", exact: true }).click();
    await expect(page.getByText("This appointment’s status is final and cannot be changed.")).toBeVisible();
    await page.goto(`${app}/notifications`);
    await expect(review).toHaveCount(0);
    const [stored] = await db`SELECT status FROM bookings WHERE tenant_id=${fixture.workspace.id} AND id=${fixture.booking.id}`;
    expect(stored.status).toBe("completed");
  } finally {
    await db.end();
  }
});
