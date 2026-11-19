import { expect, test } from "@playwright/test";

test("password reset revokes an active staff session and accepts only the replacement password", async ({ page, browser }) => {
  const { randomUUID } = await import("node:crypto");
  const { default: postgres } = await import("postgres");
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  const tenantUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  for (const raw of [controlUrl, tenantUrl]) {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
      throw new Error("Session revocation tests require disposable local databases.");
    }
  }

  const control = postgres(controlUrl, { max: 1, ssl: false });
  const tenant = postgres(tenantUrl, { max: 1, ssl: false });
  const suffix = randomUUID();
  const email = `session-revocation-${suffix}@example.test`;
  const oldPassword = "waybook-local-only";
  const replacementPassword = "Replacement-password-2026";
  let identityId = "";
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [identity] = await control`
      INSERT INTO identities (email,password_hash,display_name)
      VALUES (${email},${owner.password_hash},'Session revocation test')
      RETURNING id
    `;
    identityId = identity.id;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identity.id},'staff')`;
    const [member] = await tenant`
      INSERT INTO team_members (tenant_id,identity_id,role,name,email)
      VALUES (${workspace.id},${identity.id},'staff','Session revocation test',${email})
      RETURNING id
    `;

    const staffContext = await browser.newContext({ baseURL: "http://localhost:3336" });
    const staffPage = await staffContext.newPage();
    await staffPage.goto("/login");
    await staffPage.getByLabel("Work email").fill(email);
    await staffPage.getByPlaceholder("Enter your password").fill(oldPassword);
    await staffPage.getByRole("button", { name: "Sign in" }).click();
    await expect(staffPage).toHaveURL(/\/nordic\/app\/calendars/);

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill(oldPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto(`/nordic/app/team?employee=${member.id}`);
    await page.getByLabel("Actions for Session revocation test").click();
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel("Temporary password").fill(replacementPassword);
    await page.getByLabel("Confirm password").fill(replacementPassword);
    await page.getByRole("button", { name: "Change password", exact: true }).click();

    await expect.poll(async () => {
      const [session] = await control<{ revoked: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM sessions WHERE identity_id=${identity.id} AND revoked_at IS NOT NULL) AS revoked
      `;
      return session.revoked;
    }).toBe(true);
    await staffPage.goto("/nordic/app/calendars");
    await expect(staffPage).toHaveURL(/\/login/);

    await staffPage.getByLabel("Work email").fill(email);
    await staffPage.getByPlaceholder("Enter your password").fill(oldPassword);
    await staffPage.getByRole("button", { name: "Sign in" }).click();
    await expect(staffPage.getByRole("alert")).toContainText("Invalid email or password.");
    await staffPage.getByPlaceholder("Enter your password").fill(replacementPassword);
    await staffPage.getByRole("button", { name: "Sign in" }).click();
    await expect(staffPage).toHaveURL(/\/nordic\/app\/calendars/);
    await staffContext.close();
  } finally {
    if (identityId) await control`DELETE FROM sessions WHERE identity_id=${identityId}`;
    if (identityId) await control`DELETE FROM tenant_memberships WHERE identity_id=${identityId}`;
    if (identityId) await control`DELETE FROM identities WHERE id=${identityId}`;
    await tenant`DELETE FROM team_members WHERE email=${email}`;
    await control.end();
    await tenant.end();
  }
});
