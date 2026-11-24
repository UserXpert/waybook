import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

test("owners can create and assign a role and manage its access in Settings", async ({ page, browser }) => {
  // The Waybook E2E configuration requires disposable local databases.
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const suffix = randomUUID().slice(0, 8);
  const roleName = `Reception ${suffix}`;
  const spareRole = `Training ${suffix}`;
  const email = `role-test-${suffix}@example.test`;
  const name = `Role test ${suffix}`;
  const signIn = async (target: typeof page, account: string) => {
    await target.goto("/login");
    await target.getByLabel("Work email").fill(account);
    await target.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await target.getByRole("button", { name: "Sign in" }).click();
    await expect(target).toHaveURL(/\/nordic\/app/);
  };
  let workspaceId: string | undefined;
  try {
    const [workspace] = await control<{ id: string }[]>`SELECT id FROM tenants WHERE slug = 'nordic-studio'`;
    workspaceId = workspace.id;
    await signIn(page, "owner@nordic.local");
    await page.goto("/nordic/app/team?new=1");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    const rolePicker = page.locator(".staff-role-picker");
    const label = await rolePicker.getByText("Role", { exact: true }).boundingBox();
    const add = rolePicker.getByRole("button", { name: "Add role" });
    const button = await add.boundingBox();
    expect(button!.x).toBeGreaterThan(label!.x + label!.width);
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add role" });
    await expect(dialog).toBeVisible();
    const frame = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    const createButton = dialog.getByRole("button", { name: "Create role" });
    const footer = (await createButton.boundingBox())!;
    expect(Math.abs(frame.x + frame.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(frame.y + frame.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(footer.y + footer.height).toBeLessThan(frame.y + frame.height);
    await dialog.getByLabel("Role name").fill(roleName);
    await dialog.getByRole("switch", { name: "Can access clients" }).press("Space");
    await expect(dialog.getByRole("switch", { name: "Can access clients" })).toBeChecked();
    await createButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(rolePicker.locator("option:checked")).toHaveText(roleName);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
    await page.getByRole("button", { name: "Create staff member" }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(rolePicker.locator("option:checked")).toHaveText(roleName);

    const [identity] = await control<{ id: string }[]>`INSERT INTO identities (email, password_hash, display_name)
      SELECT ${email}, password_hash, ${name} FROM identities WHERE email = 'owner@nordic.local' RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${workspace.id}, ${identity.id}, 'staff')`;
    await db`UPDATE team_members SET identity_id = ${identity.id} WHERE tenant_id = ${workspace.id} AND email = ${email}`;

    const staffContext = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: page.viewportSize() });
    try {
      const staff = await staffContext.newPage();
      await signIn(staff, email);
      await staff.goto("/nordic/app/customers");
      await expect(staff).toHaveURL(/\/nordic\/app\/customers/);
      await expect(staff.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
      const restricted = await staff.goto("/nordic/app/settings?tab=roles");
      expect(restricted?.status()).toBe(404);

      await page.goto("/nordic/app/settings");
      const settingsNav = page.getByRole("navigation", { name: "Settings sections" });
      await expect(settingsNav.getByRole("link")).toHaveText(["Appearance", "Business setup", "Roles & permissions"]);
      await expect(page.locator("#business-settings").getByRole("link", { name: /^Roles & permissions/ })).toHaveCount(0);
      const rolesTab = settingsNav.getByRole("link", { name: "Roles & permissions" });
      await rolesTab.click();
      await expect(page).toHaveURL(/\/nordic\/app\/settings\?tab=roles$/);
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      await expect(rolesTab).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name: "Built-in roles" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Custom roles" })).toBeVisible();
      const details = page.locator("#role-details");
      await expect(details.getByRole("heading", { name: "Owner" })).toBeVisible();
      await page.getByRole("link", { name: "Manager", exact: true }).click();
      await expect(details.getByRole("heading", { name: "Manager" })).toBeVisible();
      await expect(details.getByText("Manage staff and day-to-day operations.")).toBeVisible();
      await expect(details.getByRole("switch")).toHaveCount(0);
      await page.getByRole("link", { name: roleName, exact: true }).click();
      await expect(page.getByText("Saving changes updates access for 1 assigned staff member.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete role" })).toHaveCount(0);
      await page.getByRole("switch", { name: "Can access clients" }).locator("..").click();
      await expect(page.getByRole("switch", { name: "Can access clients" })).not.toBeChecked();
      await page.getByRole("button", { name: "Save role" }).click();
      await expect(page.getByRole("status")).toHaveText("Role saved.");
      await staff.goto("/nordic/app/customers");
      await expect(staff).not.toHaveURL(/\/nordic\/app\/customers/);
    } finally {
      await staffContext.close();
    }

    await page.getByRole("link", { name: "Add role", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add role", exact: true })).toBeVisible();
    await page.getByLabel("Role name").fill(spareRole);
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByRole("heading", { name: `Edit ${spareRole}` })).toBeVisible();
    await page.getByLabel("Role name").fill(`${spareRole} updated`);
    await page.getByRole("button", { name: "Save role" }).click();
    await expect(page.getByRole("link", { name: `${spareRole} updated`, exact: true })).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("button", { name: "Delete role" }).click();
    await expect(page.getByRole("link", { name: `${spareRole} updated`, exact: true })).toHaveCount(0);
    await page.goto("/nordic/app/settings/roles?role=read-only");
    await expect(page).toHaveURL(/\/settings\?tab=roles&role=read-only$/);
    await expect(page.locator("#role-details").getByRole("heading", { name: "Read-only" })).toBeVisible();
  } finally {
    try {
      if (workspaceId) {
        await db`DELETE FROM team_members WHERE tenant_id = ${workspaceId} AND email = ${email}`;
        await db`DELETE FROM staff_roles WHERE tenant_id = ${workspaceId} AND name IN (${roleName}, ${spareRole}, ${`${spareRole} updated`})`;
      }
      await control`DELETE FROM identities WHERE email = ${email}`;
    } finally {
      await Promise.all([db.end(), control.end()]);
    }
  }
});
