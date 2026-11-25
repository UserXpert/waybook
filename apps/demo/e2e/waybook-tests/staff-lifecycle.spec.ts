import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("staff deactivation and archive show an access message and reversible actions restore access", async ({ page, browser, baseURL }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const email = `lifecycle-qa-${randomUUID()}@example.test`;
  const name = "Z QA staff lifecycle";
  const staffContext = await browser.newContext({ baseURL });
  let identityId: string | undefined;
  let memberId: string | undefined;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${email},${owner.password_hash},${name}) RETURNING id`;
    identityId = identity.id;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identityId},'staff')`;
    const [member] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${identityId},'staff',${name},${email}) RETURNING id`;
    memberId = member.id;

    const staff = await staffContext.newPage();
    await signIn(staff, email);
    await expect(staff).toHaveURL(/\/nordic\/app\/calendars/);
    await signIn(page, "owner@nordic.local");
    await expect(page).toHaveURL(/\/nordic\/app/);
    const profile = `/nordic/app/team?employee=${memberId}`;
    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: false }]);

    await staff.goto("/nordic/app/calendars");
    await expect(staff).toHaveURL(/\/login\?access=inactive/);
    await expect(staff.getByRole("alert").filter({ hasText: "Your staff access is inactive." })).toBeVisible();
    await signIn(staff, email);
    await expect(staff).toHaveURL(/\/login\?access=inactive/);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Reactivate", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: true }]);
    await signIn(staff, email);
    await expect(staff).toHaveURL(/\/nordic\/app\/calendars/);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active, archived_at IS NOT NULL AS archived FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: false, archived: true }]);
    await staff.goto("/nordic/app/calendars");
    await expect(staff).toHaveURL(/\/login\?access=inactive/);

    await page.goto(profile);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByText("Staff access updated.", { exact: true })).toBeVisible();
    expect(await tenant`SELECT is_active, archived_at IS NOT NULL AS archived FROM team_members WHERE id=${memberId}`).toEqual([{ is_active: true, archived: false }]);
    await signIn(staff, email);
    await expect(staff).toHaveURL(/\/nordic\/app\/calendars/);
  } finally {
    try {
      await staffContext.close();
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
