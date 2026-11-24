import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`search reflects staff access in ${tenant.route}`, async ({ page }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const suffix = randomUUID().slice(0, 8);
  const email = `search-staff-${suffix}@example.test`;
  const clientName = `QA search access ${suffix}`;
  const app = `/${tenant.route}/app`;

  try {
    const [workspace] = await db`SELECT tenant_id FROM tenant_settings`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email=${tenant.owner}`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name)
      VALUES (${email},${owner.password_hash},'QA search staff') RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role)
      VALUES (${workspace.tenant_id},${identity.id},'staff')`;
    const [member] = await db`INSERT INTO team_members (tenant_id,identity_id,name,email,role)
      VALUES (${workspace.tenant_id},${identity.id},'QA search staff',${email},'staff') RETURNING id`;
    await db`INSERT INTO customers (tenant_id,name,email)
      VALUES (${workspace.tenant_id},${clientName},${`search-client-${suffix}@example.test`})`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars`);
    const search = page.getByRole("button", { name: /^Search (bookings|clients|patients)/ });
    await expect(search).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notifications unavailable" })).toBeDisabled();
    await page.goto(`${app}/search?q=${encodeURIComponent(clientName)}`);
    await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars`);

    await db`INSERT INTO staff_permissions (tenant_id,team_member_id,can_manage_own_appointments)
      VALUES (${workspace.tenant_id},${member.id},true)`;
    await page.reload();
    await expect(search).toHaveAccessibleName("Search bookings");
    await search.click();
    const bookingSearch = page.getByRole("textbox", { name: "Search bookings", exact: true });
    await bookingSearch.fill(clientName);
    await bookingSearch.press("Enter");
    await expect(page.getByRole("heading", { name: "0 matching results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appointments", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: clientName, exact: true })).toHaveCount(0);

    await db`UPDATE staff_permissions SET can_manage_own_appointments=false,can_view_clients=true
      WHERE tenant_id=${workspace.tenant_id} AND team_member_id=${member.id}`;
    await page.reload();
    await expect(search).toHaveAccessibleName(/^Search (clients|patients)$/);
    await expect(page.getByRole("link", { name: clientName, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appointments", exact: true })).toHaveCount(0);

    const response = await page.goto(`${app}/notifications`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Appointments needing review" })).toHaveCount(0);
  } finally {
    await Promise.all([db.end(), control.end()]);
  }
});
