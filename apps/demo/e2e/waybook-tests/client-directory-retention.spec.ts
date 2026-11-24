import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`Clients keeps later rows, keyboard return and saved details in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const batch = `QA clients ${randomUUID()}`;
    let fixtureStaffId: string | undefined;
    try {
      const [{ tenant_id: tenantId }] = await db`SELECT tenant_id FROM tenant_settings`;
      await db`INSERT INTO customers (tenant_id,name,email) SELECT ${tenantId}, ${batch} || ' ' || lpad((n / 2)::text,3,'0'),
        ${batch.toLowerCase().replaceAll(" ", "-")} || '-' || n || '@example.test' FROM generate_series(1,107) n`;
      const expected = await db<{ id: string; name: string; email: string }[]>`SELECT id,name,email FROM customers
        WHERE tenant_id=${tenantId} AND name LIKE ${`${batch} %`} ORDER BY name,id`;
      const target = expected[103];
      const [{ service_id: serviceId, location_id: locationId }] = await db`SELECT service_id,location_id FROM service_locations WHERE tenant_id=${tenantId} LIMIT 1`;
      const [fixtureStaff] = await db`INSERT INTO team_members (tenant_id,role,name,email)
        VALUES (${tenantId},'staff',${batch},${`${randomUUID()}@example.test`}) RETURNING id`;
      fixtureStaffId = fixtureStaff.id;
      await db`WITH blocks AS (
        INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        SELECT ${tenantId},${fixtureStaff.id},${locationId}, now() + n * interval '1 day', now() + n * interval '1 day' + interval '30 minutes','confirmed'
        FROM unnest(ARRAY[-1,1,2]) AS days(n) RETURNING id,starts_at,ends_at
      ) INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
        SELECT ${tenantId},id,${serviceId},${fixtureStaff.id},${locationId},
          CASE WHEN starts_at > now() + interval '36 hours' THEN ${expected[104].id}::uuid ELSE ${target.id}::uuid END,
          starts_at,ends_at,CASE WHEN starts_at < now() THEN 'completed' WHEN starts_at > now() + interval '36 hours' THEN 'cancelled' ELSE 'confirmed' END,'tenant',10000
        FROM blocks`;
      const app = `/${workspace.route}/app`;
      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname === app);
      await page.goto(`${app}/customers?q=${encodeURIComponent(batch)}`);

      const rows = page.locator(".customer-table-row");
      const summary = page.locator(".client-pulse strong");
      await expect(summary).toHaveText(["107", "1", "1"]);
      await rows.nth(49).scrollIntoViewIfNeeded();
      await rows.nth(99).scrollIntoViewIfNeeded();
      await expect(rows).toHaveCount(expected.length);
      expect(await rows.evaluateAll((items) => items.map((row) => new URL(row.querySelector("a")!.href).searchParams.get("customer"))))
        .toEqual(expected.map(({ id }) => id));

      const row = rows.filter({ hasText: target.email });
      const opener = row.getByRole("link").first();
      const record = page.getByRole("dialog", { name: `Client record for ${target.name}`, exact: true });
      await opener.focus();
      await opener.press("Enter");
      await expect(record).toContainText(target.email);
      await page.keyboard.press("Escape");
      await expect(record).toHaveCount(0);
      await expect(rows).toHaveCount(expected.length);
      await expect(opener).toBeFocused();
      await expect(page.getByRole("searchbox")).toHaveValue(batch);

      await opener.press("Enter");
      await record.getByRole("link", { name: "Edit", exact: true }).click();
      const editor = page.getByRole("dialog", { name: `Edit client ${target.name}`, exact: true });
      const phone = "+45 55 42 11 01";
      await editor.getByRole("textbox", { name: "Phone", exact: true }).fill(phone);
      await editor.getByRole("button", { name: "Save client", exact: true }).click();
      await expect(editor.getByRole("status")).toHaveText("Contact details saved.");
      await editor.getByRole("link", { name: "Close client form" }).click();
      await expect(editor).toHaveCount(0);
      await record.getByRole("link", { name: "Close client record" }).click();
      await expect(record).toHaveCount(0);
      await expect(row).toContainText(phone);
      await expect(rows).toHaveCount(expected.length);
      await expect(opener).toBeFocused();

      const search = page.getByRole("searchbox");
      await search.fill(target.email);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(target.email);
      await expect(summary).toHaveText(["1", "1", "1"]);

      await opener.press("Enter");
      await record.getByRole("link", { name: "Edit", exact: true }).click();
      const updatedEmail = `updated-${target.email}`.replace("@example.test", "@example.invalid");
      await editor.getByRole("textbox", { name: "Email", exact: true }).fill(updatedEmail);
      await editor.getByRole("button", { name: "Save client", exact: true }).click();
      await expect(editor.getByRole("status")).toHaveText("Contact details saved.");
      await editor.getByRole("link", { name: "Close client form" }).click();
      await expect(editor).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(record).toHaveCount(0);
      await expect(rows).toHaveCount(0);
      await expect(summary).toHaveText(["0", "0", "0"]);
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(target.email);
    } finally {
      try {
        if (fixtureStaffId) {
          await db`DELETE FROM commerce_sales WHERE booking_id IN (SELECT id FROM bookings WHERE team_member_id=${fixtureStaffId})`;
          await db`DELETE FROM bookings WHERE team_member_id=${fixtureStaffId}`;
          await db`DELETE FROM booking_blocks WHERE team_member_id=${fixtureStaffId}`;
          await db`DELETE FROM team_members WHERE id=${fixtureStaffId}`;
        }
        await db`DELETE FROM customers WHERE name LIKE ${`${batch} %`}`;
      } finally {
        await db.end();
      }
    }
  });
}
