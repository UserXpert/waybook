import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`delegated staff can progress an eligible waitlist entry in ${workspace.route}`, async ({ page }) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    // Playwright validates that all three connection strings target disposable local databases.
    const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const tag = randomUUID().slice(0, 8);
    const staffEmail = `waitlist-staff-${tag}@example.test`;
    const clientName = `QA waitlist client ${tag}`;
    const clientEmail = `waitlist-client-${tag}@example.test`;
    const app = `/${workspace.route}/app`;
    const path = `${app}/waitlist`;

    try {
      const [{ tenantId, timezone, day }] = await db<{ tenantId: string; timezone: string; day: string }[]>`
        SELECT tenant_id AS "tenantId",timezone,((now() AT TIME ZONE timezone)::date+3)::text AS day FROM tenant_settings
      `;
      const [identity] = await control<{ id: string }[]>`
        INSERT INTO identities (email,password_hash,display_name)
        SELECT ${staffEmail},password_hash,'QA waitlist staff' FROM identities WHERE email=${workspace.owner} RETURNING id
      `;
      await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identity.id},'staff')`;
      const [member] = await db<{ id: string }[]>`
        INSERT INTO team_members (tenant_id,identity_id,name,email,role)
        VALUES (${tenantId},${identity.id},${`Z QA waitlist staff ${tag}`},${staffEmail},'staff') RETURNING id
      `;
      const [location] = await db<{ id: string; name: string }[]>`
        INSERT INTO locations (tenant_id,slug,name,timezone)
        VALUES (${tenantId},${`qa-waitlist-${tag}`},${`Z QA waitlist branch ${tag}`},${timezone}) RETURNING id,name
      `;
      const [service] = await db<{ id: string; title: string }[]>`
        INSERT INTO services (tenant_id,slug,title,duration_minutes)
        VALUES (${tenantId},${`qa-waitlist-${tag}`},${`Z QA waitlist service ${tag}`},30) RETURNING id,title
      `;

      try {
        await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
          SELECT ${tenantId},${location.id},day,'09:00','15:00' FROM generate_series(0,6) day`;
        await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${service.id},${location.id})`;
        await db`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${member.id},${location.id})`;
        await db`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
        await db`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
          VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','15:00',${timezone})`;
        await db`INSERT INTO staff_permissions (tenant_id,team_member_id,can_manage_waitlist) VALUES (${tenantId},${member.id},true)`;
        const [client] = await db<{ id: string }[]>`
          INSERT INTO customers (tenant_id,name,email,phone) VALUES (${tenantId},${clientName},${clientEmail},'+4510101010') RETURNING id
        `;

        await page.goto("/login");
        await page.getByLabel("Work email").fill(staffEmail);
        await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars`);
        await page.goto(path);
        const opener = page.getByRole("link", { name: /^Add (client|patient)$/i });
        await opener.focus();
        await opener.press("Enter");
        const dialog = page.getByRole("dialog", { name: /^Add (client|patient) to waitlist$/i });
        const clientSearch = dialog.getByRole("textbox", { name: /^(Client|Patient) search$/ });
        await expect(clientSearch).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await opener.click();
        const form = page.locator("form.waitlist-form");
        await expect(form.getByRole("link", { name: /^Create a new (client|patient)$/ })).toHaveCount(0);
        await clientSearch.fill(tag);
        await form.getByRole("combobox", { name: /^(Client|Patient)$/ }).selectOption(client.id);
        await form.getByRole("textbox", { name: "Search waitlist locations" }).fill(location.name);
        await form.locator('select[name="locationId"]').selectOption(location.id);
        await form.getByRole("textbox", { name: "Search waitlist services" }).fill(service.title);
        await form.locator('select[name="serviceId"]').selectOption(service.id);
        await form.locator('select[name="preferredTeamMemberId"]').selectOption(member.id);
        await form.locator('input[name="preferredLocalDate"]').fill(day);
        const preferredTime = form.getByRole("switch", { name: "Set a preferred time", exact: true });
        await preferredTime.press("Space");
        await expect(preferredTime).toBeChecked();
        await expect(form.locator('input[name="preferredStartTime"]')).toHaveValue("09:00");
        await expect(form.locator('input[name="preferredEndTime"]')).toHaveValue("17:00");
        await preferredTime.press("Space");
        await expect(preferredTime).not.toBeChecked();
        await form.getByRole("button", { name: "Add to waitlist", exact: true }).click();
        await expect(form.getByRole("status")).toHaveText(/added to the waiting list/);

        const [entry] = await db`
          SELECT id,status,preferred_team_member_id AS "memberId",preferred_local_date::text AS day,notes
          FROM waitlist_entries WHERE tenant_id=${tenantId} AND customer_id=${client.id}
        `;
        expect(entry).toMatchObject({ status: "waiting", memberId: member.id, day, notes: null });
        await page.goto(path);
        const row = page.getByRole("row").filter({ hasText: clientName });
        await expect(row).toBeVisible();
        await expect(row).not.toContainText("null");
        await expect(row.getByRole("link", { name: "Find a slot" })).toHaveCount(0);
        await row.locator('select[name="status"]').selectOption("offered");
        await row.getByRole("button", { name: "Save", exact: true }).click();
        await expect(row).toHaveCount(0);
        await page.goto(`${path}?status=offered`);
        await expect(row).toContainText("Offer sent");
        await expect.poll(async () => (await db`SELECT status FROM waitlist_entries WHERE id=${entry.id}`)[0].status).toBe("offered");

        await db`UPDATE staff_permissions SET can_manage_own_appointments=true WHERE tenant_id=${tenantId} AND team_member_id=${member.id}`;
        await page.reload();
        await row.getByRole("link", { name: "Find a slot", exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars` && url.searchParams.get("waitlist") === entry.id);
        await page.locator(`a.is-bookable[data-calendar-team-member-id="${member.id}"][data-calendar-starts-at="${day}T10:00"]`).click();
        const appointment = page.getByRole("complementary", { name: "New appointment" });
        await expect(appointment.getByLabel(/^(Client|Patient) name$/)).toHaveValue(clientName);
        await expect(appointment.getByLabel("Email", { exact: true })).toHaveValue(clientEmail);
        await expect(appointment.getByLabel("Phone", { exact: true })).toHaveValue("");
        await appointment.getByRole("button", { name: "10:00", exact: true }).click();
        await appointment.getByRole("button", { name: "Confirm appointment" }).click();
        await expect(appointment.getByText("Appointment confirmed and added to the calendar.")).toBeVisible();
        const appointments = await db`
          SELECT status FROM bookings WHERE tenant_id=${tenantId} AND customer_id=${client.id}
            AND service_id=${service.id} AND location_id=${location.id}
        `;
        expect(appointments).toEqual([{ status: "confirmed" }]);
        await page.goto(`${path}?status=offered`);
        await row.locator('select[name="status"]').selectOption("booked");
        await row.getByRole("button", { name: "Save", exact: true }).click();
        await expect(row).toHaveCount(0);
        await page.goto(`${path}?status=booked`);
        await expect(row).toContainText("Booked");
        await expect(row.getByRole("link", { name: "Find a slot" })).toHaveCount(0);

        await control`UPDATE tenant_memberships SET role='read-only' WHERE tenant_id=${tenantId} AND identity_id=${identity.id}`;
        await db`UPDATE team_members SET role='read-only' WHERE tenant_id=${tenantId} AND id=${member.id}`;
        await page.context().clearCookies();
        await page.goto("/login");
        await page.getByLabel("Work email").fill(staffEmail);
        await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === `${app}/calendars`);
        const denied = await page.goto(path);
        expect(denied?.status()).toBe(404);
        await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
      } finally {
        await db`UPDATE team_members SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${member.id}`;
        await db`UPDATE services SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${service.id}`;
        await db`UPDATE locations SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${location.id}`;
      }
    } finally {
      await Promise.all([control.end(), db.end()]);
    }
  });
}
