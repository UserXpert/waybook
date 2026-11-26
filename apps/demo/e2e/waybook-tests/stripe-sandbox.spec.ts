import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/calendars)?$/);
}

test("owners can resume their sandbox onboarding without creating a second account", async ({ page, browser, baseURL, viewport }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const path = "/nordic/app/settings?tab=payments";
  const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
  const connections = () => control`SELECT account_id, creation_key
    FROM waybook_stripe_sandbox_connections WHERE tenant_id=${tenantId}`;
  try {
    expect(await connections()).toHaveLength(0);
    await page.route("https://accounts.stripe.com/**", (route) => route.fulfill({ body: "Stripe onboarding fixture" }));
    await signIn(page, "owner@nordic.local");
    await page.goto("/nordic/app/settings");
    const payments = page.getByRole("link", { name: "Payments", exact: true });
    await expect(payments).toBeVisible();
    await payments.click();
    await expect(page.getByRole("heading", { name: "Stripe sandbox" })).toBeVisible();
    const start = page.getByRole("button", { name: "Set up Stripe sandbox" });
    await expect(start).toBeInViewport({ ratio: 1 });
    await start.press("Enter");
    await expect(page.getByRole("region", { name: "Stripe sandbox" }).getByRole("alert")).toContainText("Stripe setup could not open");
    const [interrupted] = await connections();
    expect(interrupted.account_id).toBeNull();

    const resume = page.getByRole("button", { name: "Continue Stripe setup", exact: true });
    await resume.click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.stripe\.com\/r\/acct_/);
    const [first] = await connections();
    expect(first.creation_key).toBe(interrupted.creation_key);
    expect(first.account_id).toBe(`acct_${interrupted.creation_key.replaceAll("-", "")}`);

    await page.goto(path + "&stripe=resume");
    await expect(page.getByText("Continue setup to open a fresh Stripe link.")).toBeVisible();
    await resume.click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.stripe\.com\/r\/acct_/);
    expect(await connections()).toEqual([first]);
    await page.goto(path);
    await expect(page.getByText("Stripe has verified your sandbox account for card payments.")).toBeVisible();

    const otherContext = await browser.newContext({ baseURL, viewport });
    try {
      const other = await otherContext.newPage();
      await signIn(other, "owner@copenhagen-physio.local");
      await other.goto("/copenhagen/app/settings?tab=payments");
      await expect(other.getByRole("button", { name: "Set up Stripe sandbox" })).toBeVisible();
      expect((await other.goto(path))?.status()).toBe(404);
    } finally {
      await otherContext.close();
    }

    for (const role of ["manager", "staff"]) {
      const context = await browser.newContext({ baseURL, viewport });
      const email = `stripe-${randomUUID()}@example.test`;
      let identityId: string | undefined;
      try {
        const [identity] = await control`INSERT INTO identities (email,password_hash,display_name)
          SELECT ${email},password_hash,'Stripe access QA' FROM identities WHERE email='owner@nordic.local' RETURNING id`;
        identityId = identity.id;
        await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identityId},${role})`;
        await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email)
          VALUES (${tenantId},${identityId},${role},'Stripe access QA',${email})`;
        const restricted = await context.newPage();
        await signIn(restricted, email);
        await restricted.goto("/nordic/app/settings");
        await expect(restricted.getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
        expect((await restricted.goto(path))?.status()).toBe(404);
        expect(await connections()).toEqual([first]);
      } finally {
        await context.close();
        if (identityId) {
          await tenant`DELETE FROM team_members WHERE tenant_id=${tenantId} AND identity_id=${identityId}`;
          await control`DELETE FROM identities WHERE id=${identityId}`;
        }
      }
    }
  } finally {
    await control`DELETE FROM waybook_stripe_sandbox_connections WHERE tenant_id=${tenantId}`;
    await Promise.all([control.end(), tenant.end()]);
  }
});
