import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("report date ranges stay available to staff while monthly target changes require a manager", async ({ page, browser, baseURL }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const staffEmail = `reports-qa-${randomUUID()}@example.test`;
  const staffContext = await browser.newContext({ baseURL });
  const month = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 7);
  let identityId: string | undefined;
  let staffId: string | undefined;
  let serviceId: string | undefined;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${staffEmail},${owner.password_hash},'Reports QA staff') RETURNING id`;
    identityId = identity.id;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identityId},'staff')`;
    const [member] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${identityId},'staff','Reports QA staff',${staffEmail}) RETURNING id`;
    staffId = member.id;
    await tenant`INSERT INTO staff_permissions (tenant_id,team_member_id,can_access_reports) VALUES (${workspace.id},${staffId},true)`;
    const [service] = await tenant`SELECT id FROM services WHERE tenant_id=${workspace.id} AND title='Studio session' AND is_active=true`;
    serviceId = service.id;

    const staff = await staffContext.newPage();
    await signIn(staff, staffEmail);
    await expect(staff).toHaveURL(/\/nordic\/app/);
    await staff.goto("/nordic/app/reports");
    const ranges = staff.getByRole("navigation", { name: "Report date range" });
    await expect(ranges.getByRole("link", { name: "Monthly targets" })).toHaveCount(0);
    for (const days of [7, 90, 30]) {
      const range = ranges.getByRole("link", { name: `Last ${days} days`, exact: true });
      await range.click();
      await expect(range).toHaveAttribute("aria-current", "page");
    }
    await staff.goto("/nordic/app/targets?new=1");
    await expect(staff).toHaveURL(/\/nordic\/app\/reports$/);

    await signIn(page, "owner@nordic.local");
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/reports");
    await page.getByRole("link", { name: "Monthly targets", exact: true }).click();
    await page.getByRole("link", { name: "Set target", exact: true }).click();
    const target = page.getByRole("complementary", { name: "Set monthly target" });
    await target.getByRole("combobox", { name: "Target applies to" }).selectOption("service");
    await target.getByLabel("Search target service").fill("Studio session");
    await target.locator('select[name="scopeId"]').selectOption(serviceId!);
    await target.locator('input[name="periodStart"]').fill(month);
    await target.getByRole("spinbutton", { name: "Monthly booking target" }).fill("18");
    await target.getByRole("button", { name: "Save target", exact: true }).click();
    await expect(target.getByRole("status")).toHaveText("Monthly target saved.");
    await target.getByRole("link", { name: "Close target editor" }).click();
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: month }).filter({ hasText: "Studio session" });
    await expect(row.getByRole("cell", { name: "18", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: "0%", exact: true })).toBeVisible();
  } finally {
    try {
      await staffContext.close();
      if (serviceId) await tenant`DELETE FROM performance_targets WHERE scope_type='service' AND scope_id=${serviceId} AND period_start=${`${month}-01`}::date`;
      if (staffId) await tenant`DELETE FROM team_members WHERE id=${staffId}`;
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
