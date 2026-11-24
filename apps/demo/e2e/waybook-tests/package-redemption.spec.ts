import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`an issued package grants one visit and only settles a matching appointment in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const suffix = randomUUID().slice(0, 8);
  const title = `QA one-visit package ${suffix}`;
  const clientName = `QA package client ${suffix}`;
  const email = `package-${suffix}@example.test`;
  const app = `/${tenant.route}/app`;
  try {
    const [workspace] = await db<{ id: string; currency: string; locationId: string; serviceId: string; serviceTitle: string }[]>`
      SELECT ts.tenant_id AS id, ts.currency, l.id AS "locationId", s.id AS "serviceId", s.title AS "serviceTitle"
      FROM tenant_settings ts
      JOIN locations l ON l.tenant_id=ts.tenant_id AND l.slug='primary'
      JOIN service_locations sl ON sl.tenant_id=ts.tenant_id AND sl.location_id=l.id
      JOIN services s ON s.tenant_id=ts.tenant_id AND s.id=sl.service_id AND s.is_active
      ORDER BY s.id LIMIT 1`;
    const [client] = await db<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email)
      VALUES (${workspace.id},${clientName},${email}) RETURNING id`;
    const [staff] = await db<{ id: string }[]>`INSERT INTO team_members (tenant_id,name,email,role)
      VALUES (${workspace.id},${`QA package staff ${suffix}`},${`staff-${suffix}@example.test`},'staff') RETURNING id`;
    const [otherService] = await db<{ id: string }[]>`INSERT INTO services (tenant_id,slug,title,duration_minutes)
      VALUES (${workspace.id},${`qa-other-${suffix}`},${`QA different service ${suffix}`},30) RETURNING id`;
    const [item] = await db<{ id: string }[]>`INSERT INTO commerce_catalog_items (tenant_id,kind,title,price_cents,currency)
      VALUES (${workspace.id},'package',${title},25000,${workspace.currency}) RETURNING id`;
    await db`INSERT INTO commerce_package_service_entitlements (tenant_id,catalog_item_id,service_id,included_units,expires_after_days)
      VALUES (${workspace.id},${item.id},${workspace.serviceId},1,30)`;

    const appointment = async (serviceId: string, daysAhead: number) => {
      const starts = new Date(Date.now() + daysAhead * 86_400_000);
      const ends = new Date(starts.getTime() + 30 * 60_000);
      const [block] = await db<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${workspace.id},${staff.id},${workspace.locationId},${starts},${ends},'confirmed') RETURNING id`;
      const [booking] = await db<{ id: string; booking_number: string }[]>`INSERT INTO bookings
        (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
        VALUES (${workspace.id},${block.id},${serviceId},${staff.id},${workspace.locationId},${client.id},${starts},${ends},'confirmed','tenant',25000)
        RETURNING id,booking_number`;
      const [sale] = await db<{ id: string }[]>`SELECT id FROM commerce_sales WHERE tenant_id=${workspace.id} AND booking_id=${booking.id}`;
      return { booking, saleId: sale.id };
    };
    const matching = await appointment(workspace.serviceId, 4);
    const different = await appointment(otherService.id, 5);
    const later = await appointment(workspace.serviceId, 6);

    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === app);

    // Give this separate fixture time to expire with its original visit intact.
    const expiredPackageId = await db.begin(async (tx) => {
      const [issued] = await tx<{ id: string }[]>`INSERT INTO commerce_packages
        (tenant_id,catalog_item_id,customer_id,expires_at,title_snapshot,price_cents_snapshot,currency_snapshot,service_title_snapshot)
        VALUES (${workspace.id},${item.id},${client.id},now()+interval '2 seconds',${title},25000,${workspace.currency},${workspace.serviceTitle}) RETURNING id`;
      await tx`INSERT INTO commerce_entitlement_entries (tenant_id,package_id,service_id,kind,direction,units,reason)
        VALUES (${workspace.id},${issued.id},${workspace.serviceId},'grant','credit',1,'Synthetic expiry fixture')`;
      return issued.id;
    });
    await expect.poll(async () => (await db`SELECT expires_at <= now() AS expired FROM commerce_packages
      WHERE id=${expiredPackageId}`)[0].expired).toBe(true);
    await page.goto(`${app}/sales?sale=${matching.saleId}`);
    await expect(page.getByText(/No eligible package can be redeemed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Redeem package visit" })).toHaveCount(0);
    expect(await db`SELECT kind,units FROM commerce_entitlement_entries WHERE package_id=${expiredPackageId}`)
      .toEqual([{ kind: "grant", units: 1 }]);

    await page.goto(`${app}/packages`);
    await page.getByRole("link", { name: "Add package", exact: true }).click();
    await page.getByPlaceholder("Search name, email, or phone").fill(clientName);
    await page.getByRole("combobox", { name: /^(Client|Patient)$/ }).selectOption(client.id);
    await page.getByRole("combobox", { name: "Package", exact: true }).selectOption(item.id);
    await page.getByRole("button", { name: "Create package", exact: true }).click();
    await expect(page.getByText("Package issued.", { exact: true })).toBeVisible();
    const packageId = new URL(page.url()).searchParams.get("package");
    const detailsUrl = `${app}/packages?package=${packageId}`;
    const terms = await db`SELECT customer_id, title_snapshot, price_cents_snapshot,
        round(extract(epoch FROM expires_at-created_at)/86400)::int AS expiry_days
      FROM commerce_packages WHERE tenant_id=${workspace.id} AND id=${packageId}`;
    expect(terms).toEqual([{ customer_id: client.id, title_snapshot: title, price_cents_snapshot: 25000, expiry_days: 30 }]);
    const ledger = () => db`SELECT kind,direction,units,service_id,booking_id FROM commerce_entitlement_entries
      WHERE package_id=${packageId} ORDER BY CASE kind WHEN 'grant' THEN 0 ELSE 1 END, id`;
    const grant = { kind: "grant", direction: "credit", units: 1, service_id: workspace.serviceId, booking_id: null };
    expect(await ledger()).toEqual([grant]);

    await page.goto(`${app}/sales?sale=${different.saleId}`);
    await expect(page.getByText(/No eligible package can be redeemed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Redeem package visit" })).toHaveCount(0);
    expect(await ledger()).toEqual([grant]);

    await page.goto(`${app}/sales?sale=${matching.saleId}`);
    await page.getByRole("combobox", { name: /^Eligible (client|patient) package$/ }).selectOption(packageId!);
    const redeem = page.getByRole("button", { name: "Redeem package visit", exact: true });
    await redeem.click();
    await expect(page.getByText("Package redeemed.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/A package visit has been redeemed/)).toBeVisible();
    await expect(redeem).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use gift card" })).toHaveCount(0);
    const redeemed = { kind: "redeem", direction: "debit", units: 1, service_id: workspace.serviceId, booking_id: matching.booking.id };
    expect(await ledger()).toEqual([grant, redeemed]);

    await page.goto(`${app}/sales?sale=${later.saleId}`);
    await expect(page.getByText(/No eligible package can be redeemed/)).toBeVisible();
    await expect(redeem).toHaveCount(0);
    await page.goto(detailsUrl);
    const balance = page.locator(".appointment-drawer .client-record__overview").getByText("Visits remaining", { exact: true });
    await expect(balance.locator("..").getByText("0", { exact: true })).toBeVisible();

    await page.goto(`/${tenant.route}/book`);
    await page.getByRole("button", { name: "Manage booking" }).click();
    await page.getByLabel("Booking number").fill(matching.booking.booking_number);
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Find booking" }).click();
    await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
    await expect(page.getByText("Please contact the business to cancel this booking because it has payment or package activity.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm cancellation" })).toHaveCount(0);
    const [stored] = await db`SELECT status FROM bookings WHERE tenant_id=${workspace.id} AND id=${matching.booking.id}`;
    expect(stored.status).toBe("confirmed");
    expect(await ledger()).toEqual([grant, redeemed]);
  } finally {
    await db.end();
  }
});
