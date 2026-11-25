import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function openSession(page: Page, email: string, route: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.startsWith(`/${route}/app`));
}

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`client directory follows effective permissions in ${tenant.route}`, async ({ page, browser, baseURL, ignoreHTTPSErrors }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const name = `Client access QA ${tag}`;
  const clientEmail = `client-${tag}@example.test`;
  const phone = "+45 11 22 33 44";
  const app = `/${tenant.route}/app`;
  const roles = ["staff", "read-only", "manager"];
  const accounts = roles.map(role => `${role}-${tag}@example.test`);
  const contexts = await Promise.all(roles.map(() =>
    browser.newContext({ baseURL, ignoreHTTPSErrors, viewport: page.viewportSize() ?? undefined })));
  try {
    const [{ tenant_id: tenantId }] = await db`SELECT tenant_id FROM tenant_settings LIMIT 1`;
    const [seed] = await control`SELECT password_hash FROM identities WHERE email=${tenant.owner}`;
    const [customer] = await db`INSERT INTO customers (tenant_id,name,email) VALUES (${tenantId},${name},${clientEmail}) RETURNING id`;
    const createAccount = async (role: string) => {
      const email = `${role}-${tag}@example.test`;
      const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${email},${seed.password_hash},${role}) RETURNING id`;
      await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identity.id},${role})`;
      const [staff] = await db`INSERT INTO team_members (tenant_id,identity_id,role,name,email)
        VALUES (${tenantId},${identity.id},${role},${`QA ${role} ${tag}`},${email}) RETURNING id`;
      return { id: staff.id, email };
    };
    const staffAccount = await createAccount("staff");
    const readonlyAccount = await createAccount("read-only");
    const managerAccount = await createAccount("manager");
    await db`INSERT INTO staff_permissions (tenant_id,team_member_id,can_view_clients,can_manage_clients)
      VALUES (${tenantId},${readonlyAccount.id},true,true)`;

    const [staffPage, readonlyPage, managerPage] = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all([
      openSession(page, tenant.owner, tenant.route),
      openSession(staffPage, staffAccount.email, tenant.route),
      openSession(readonlyPage, readonlyAccount.email, tenant.route),
      openSession(managerPage, managerAccount.email, tenant.route),
    ]);

    const clients = `${app}/customers?customer=${customer.id}`;
    const record = (p: Page) => p.getByRole("dialog", { name: new RegExp(`record for ${name}$`, "i") });
    const save = (p: Page) => p.getByRole("button", { name: /^Save (client|patient)$/ });
    const blocked = async (p: Page) => {
      await p.goto(clients);
      await expect(p).toHaveURL((url) => url.pathname === `${app}/calendars`);
      await expect(record(p)).toHaveCount(0);
    };
    const viewOnly = async (p: Page) => {
      await p.goto(`${clients}&edit=1`);
      await expect(record(p)).toBeVisible();
      await expect(record(p).getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(save(p)).toHaveCount(0);
      await expect(record(p)).toContainText(phone);
    };

    await blocked(staffPage);
    const perms = (memberId: string) => `${app}/team?employee=${memberId}&tab=permissions`;
    const view = page.getByRole("switch", { name: /^Can access clients/ });
    const edit = page.getByRole("switch", { name: /^Can create and change clients/ });
    const savePermissions = async () => {
      await page.getByRole("button", { name: "Save permissions" }).click();
      await expect(page.getByText("Staff permissions saved.", { exact: true })).toBeVisible();
    };
    await page.goto(perms(staffAccount.id));
    await view.check();
    await savePermissions();
    await staffPage.goto(clients);
    await expect(record(staffPage)).toBeVisible();
    await expect(record(staffPage).getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

    await edit.check();
    await savePermissions();
    await staffPage.goto(clients);
    await record(staffPage).getByRole("link", { name: "Edit", exact: true }).click();
    await staffPage.getByRole("dialog", { name: /^Edit (client|patient) / }).getByLabel("Phone").fill(phone);
    await save(staffPage).click();
    await expect(staffPage.getByText("Contact details saved.", { exact: true })).toBeVisible();
    expect(await db`SELECT phone FROM customers WHERE id=${customer.id}`).toEqual([{ phone }]);

    await page.goto(perms(staffAccount.id));
    await edit.uncheck();
    await savePermissions();
    await viewOnly(staffPage);
    await viewOnly(readonlyPage);

    await managerPage.goto(clients);
    await expect(record(managerPage).getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    await page.goto(perms(readonlyAccount.id));
    await expect(view).toBeChecked();
    await expect(page.locator(".staff-permissions-form").getByRole("switch")).toHaveCount(3);
    await expect(edit).toHaveCount(0);
    await view.uncheck();
    await savePermissions();
    await blocked(readonlyPage);
    expect(await db`SELECT can_view_clients,can_manage_clients FROM staff_permissions WHERE team_member_id=${readonlyAccount.id}`)
      .toEqual([{ can_view_clients: false, can_manage_clients: true }]);
    await view.check();
    await savePermissions();
    await viewOnly(readonlyPage);
    expect(await db`SELECT can_view_clients,can_manage_clients FROM staff_permissions WHERE team_member_id=${readonlyAccount.id}`)
      .toEqual([{ can_view_clients: true, can_manage_clients: true }]);
  } finally {
    try {
      await Promise.all(contexts.map(context => context.close()));
      await db`DELETE FROM team_members WHERE email=ANY(${accounts})`;
      await db`DELETE FROM customers WHERE email=${clientEmail}`;
      await control`DELETE FROM identities WHERE email=ANY(${accounts})`;
    } finally {
      await Promise.all([control.end(), db.end()]);
    }
  }
});
