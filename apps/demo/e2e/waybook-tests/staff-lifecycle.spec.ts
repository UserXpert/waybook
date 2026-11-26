import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const workspaces = [
  { route: "nordic", slug: "nordic-studio", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", slug: "copenhagen-physio", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspaceCase of workspaces) test(`staff grants and deactivation govern open time-off forms in ${workspaceCase.route}`, async ({ page, browser, baseURL }) => {
  const app = `/${workspaceCase.route}/app`;
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env[workspaceCase.database]!, { max: 1, ssl: false });
  const testId = randomUUID();
  const email = `lifecycle-qa-${testId}@example.test`;
  const name = "Z QA staff lifecycle";
  const colleagueName = `Z QA time-off colleague ${testId.slice(0, 8)}`;
  const staffContext = await browser.newContext({ baseURL, viewport: page.viewportSize() ?? undefined });
  let identityId: string | undefined;
  let memberId: string | undefined;
  let colleagueId: string | undefined;
  let bookingId: string | undefined;
  let blockId: string | undefined;
  let customerId: string | undefined;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug=${workspaceCase.slug}`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email=${workspaceCase.owner}`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${email},${owner.password_hash},${name}) RETURNING id`;
    identityId = identity.id;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identityId},'staff')`;
    const [member] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${identityId},'staff',${name},${email}) RETURNING id`;
    memberId = member.id;
    const [colleague] = await tenant`INSERT INTO team_members (tenant_id,role,name,email)
      VALUES (${workspace.id},'staff',${colleagueName},${`colleague-${email}`}) RETURNING id`;
    colleagueId = colleague.id;
    const profile = `${app}/team?employee=${memberId}`;
    const timeOff = profile + "&tab=time-off";
    const colleagueTimeOff = `${app}/team?employee=${colleague.id}&tab=time-off`;
    const overridesFor = (id: string) => tenant`SELECT local_date::text, is_unavailable FROM availability_overrides WHERE tenant_id=${workspace.id} AND team_member_id=${id}`;

    const staff = await staffContext.newPage();
    await signIn(staff, email);
    await expect(staff).toHaveURL((url) => url.pathname === `${app}/calendars`);
    const save = staff.getByRole("button", { name: "Save time off", exact: true });
    await staff.goto(timeOff);
    await expect(save).toHaveCount(0);
    await tenant`INSERT INTO staff_permissions (tenant_id,team_member_id,can_manage_own_time_off)
      VALUES (${workspace.id},${member.id},true)`;
    await staff.reload();
    await expect(save).toBeEnabled();
    await staff.goto(colleagueTimeOff);
    await expect(staff.getByRole("heading", { name: colleagueName, exact: true })).toHaveCount(0);

    await tenant`UPDATE staff_permissions SET can_manage_team_time_off=true
      WHERE tenant_id=${workspace.id} AND team_member_id=${member.id}`;
    await staff.goto(timeOff);
    await staff.getByRole("link", { name: new RegExp(colleagueName) }).click();
    await expect(staff).toHaveURL(colleagueTimeOff);
    await expect(staff.getByRole("heading", { name: colleagueName, exact: true })).toBeVisible();
    await expect(staff.getByText(`colleague-${email}`, { exact: true })).toHaveCount(0);
    await save.click();
    await expect(staff.getByText("Time off saved.", { exact: true })).toBeVisible();
    expect(await overridesFor(colleague.id)).toHaveLength(1);
    await staff.locator(".staff-exception-list__row").click();
    const saveChanges = staff.getByRole("button", { name: "Save changes", exact: true });
    const editForm = staff.locator("form.staff-timeoff-form").filter({ has: saveChanges });
    const fullDay = editForm.getByRole("switch", { name: /Full day/ });
    await expect(fullDay).toHaveAttribute("aria-checked", "true");
    await fullDay.click();
    await expect(fullDay).toHaveAttribute("aria-checked", "false");
    await saveChanges.click();
    await expect(staff.getByText("Time off updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT left(start_time::text, 5) AS start, left(end_time::text, 5) AS "end" FROM availability_overrides WHERE team_member_id=${colleague.id}`)
      .toEqual([{ start: "09:00", end: "17:00" }]);
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Remove time off", exact: true }).click();
    await expect(staff.getByText("Time off removed.", { exact: true })).toBeVisible();
    expect(await overridesFor(colleague.id)).toEqual([]);
    await staff.goto(`${app}/team?employee=${colleague.id}&tab=details`);
    await expect(staff.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(staff.getByText(`colleague-${email}`, { exact: true })).toHaveCount(0);
    await tenant`UPDATE staff_permissions SET can_manage_team_time_off=false
      WHERE tenant_id=${workspace.id} AND team_member_id=${member.id}`;
    await staff.goto(timeOff);
    await expect(save).toBeEnabled();

    await signIn(page, workspaceCase.owner);
    await expect(page).toHaveURL((url) => url.pathname === app);
    await page.goto(profile);
    const actions = page.getByLabel(`Actions for ${name}`);
    await actions.click();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.getByRole("heading", { name, exact: true }).click();
    await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeHidden();
    await actions.click();
    await page.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: false }]);
    await actions.click();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await save.click();
    await expect(staff).toHaveURL(/\/login\?access=inactive/);
    expect(await overridesFor(member.id)).toEqual([]);
    await expect(staff.getByRole("alert").filter({ hasText: "Your staff access is inactive." })).toBeVisible();
    await signIn(staff, email);
    await expect(staff).toHaveURL(/\/login\?access=inactive/);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Reactivate", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: true }]);
    await signIn(staff, email);
    await expect(staff).toHaveURL((url) => url.pathname === `${app}/calendars`);

    await staff.goto(timeOff);
    await save.click();
    await expect(staff.getByText("Time off saved.", { exact: true })).toBeVisible();
    expect(await overridesFor(member.id)).toHaveLength(1);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active, archived_at IS NOT NULL AS archived FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: false, archived: true }]);
    await staff.goto(`${app}/calendars`);
    await expect(staff).toHaveURL(/\/login\?access=inactive/);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active, archived_at IS NOT NULL AS archived FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: true, archived: false }]);
    await signIn(staff, email);
    await expect(staff).toHaveURL((url) => url.pathname === `${app}/calendars`);

    const [service] = await tenant`SELECT id FROM services WHERE tenant_id=${workspace.id} LIMIT 1`;
    const [customer] = await tenant`INSERT INTO customers (tenant_id,name,email) VALUES (${workspace.id},'QA lifecycle customer',${`customer-${email}`}) RETURNING id`;
    customerId = customer.id;
    const [booking] = await tenant`
      WITH block AS (
        INSERT INTO booking_blocks (tenant_id,team_member_id,starts_at,ends_at,state)
        VALUES (${workspace.id},${memberId},now()-interval '1 day',now()-interval '1 day'+interval '30 minutes','confirmed')
        RETURNING id,starts_at,ends_at
      )
      INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,customer_id,starts_at,ends_at,status,source,booked_price_cents)
      SELECT ${workspace.id},id,${service.id},${memberId},${customer.id},starts_at,ends_at,'completed','tenant',0 FROM block
      RETURNING id,booking_block_id
    `;
    bookingId = booking.id;
    blockId = booking.booking_block_id;
    await actions.click();
    const archiveBeforeDeletion = workspaceCase.route === "nordic";
    await page.getByRole("button", { name: archiveBeforeDeletion ? "Archive" : "Deactivate", exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true }).locator("..")).toContainText("Inactive");
    await actions.click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const confirmation = page.getByRole("form", { name: "Delete staff profile" });
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(actions).toBeFocused();
    await actions.click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete profile" }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
    expect(await tenant`SELECT is_active, deleted_at IS NOT NULL AS deleted FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: false, deleted: true }]);
    expect(await tenant`SELECT status, team_member_id FROM bookings WHERE id=${bookingId}`).toEqual([{ status: "completed", team_member_id: memberId }]);
    expect(await overridesFor(member.id)).toHaveLength(1);
    await staff.goto(`${app}/calendars`);
    await expect(staff).toHaveURL(/\/login\?access=inactive/);
  } finally {
    try {
      await staffContext.close();
      if (bookingId) {
        await tenant`DELETE FROM commerce_sales WHERE booking_id=${bookingId}`;
        await tenant`DELETE FROM bookings WHERE id=${bookingId}`;
      }
      if (blockId) await tenant`DELETE FROM booking_blocks WHERE id=${blockId}`;
      if (customerId) await tenant`DELETE FROM customers WHERE id=${customerId}`;
      if (colleagueId) await tenant`DELETE FROM team_members WHERE id=${colleagueId}`;
      if (memberId) await tenant`DELETE FROM team_members WHERE id=${memberId}`;
      if (identityId) {
        await control`DELETE FROM sessions WHERE identity_id=${identityId}`;
        await control`DELETE FROM tenant_memberships WHERE identity_id=${identityId}`;
        await control`DELETE FROM identities WHERE id=${identityId}`;
      }
    } finally {
      await Promise.all([tenant.end(), control.end()]);
    }
  }
});
