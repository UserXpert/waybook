import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

type ProviderProfile = { subject: string; email: string; verified: boolean };

async function acceptWithGoogle(page: Page, entry: string, profile: ProviderProfile) {
  const authorize = "https://accounts.google.com/o/oauth2/v2/auth?*";
  await page.route(authorize, async (route) => {
    const oauth = new URL(route.request().url());
    const callback = new URL(oauth.searchParams.get("redirect_uri")!);
    expect(callback.href).toBe("http://localhost:3336/api/auth/callback/google");
    expect(oauth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(oauth.searchParams.get("state")).toBeTruthy();
    const code = {
      ...profile,
      challenge: oauth.searchParams.get("code_challenge"),
      nonce: oauth.searchParams.get("nonce"),
    };
    callback.searchParams.set("code", Buffer.from(JSON.stringify(code)).toString("base64url"));
    callback.searchParams.set("state", oauth.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  try {
    await page.goto(entry);
    await page.getByRole("button", { name: "Continue with Google" }).click({ timeout: 8_000 });
    await page.waitForURL((url) => url.hostname === "localhost" &&
      (url.pathname.startsWith("/nordic/app") || url.pathname.startsWith("/copenhagen/app") || url.searchParams.has("google")), { timeout: 10_000 });
  } finally {
    await page.unroute(authorize);
  }
}

const workspaces = [
  { route: "nordic", foreignRoute: "copenhagen", slug: "nordic-studio", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", foreignRoute: "nordic", slug: "copenhagen-physio", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspaceCase of workspaces) test(`Google invitation claims exact tenant access once in ${workspaceCase.route} and rejects invalid claims`, async ({ page, browser, baseURL }) => {
  test.setTimeout(75_000);
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env[workspaceCase.database]!, { max: 1, ssl: false });
  const invitee = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  const signIn = await invitee.newPage();
  let createdStaffId: string | undefined;
  try {
    const [workspace] = await control<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${workspaceCase.slug}`;
    const suffix = randomUUID();
    const name = "Google invitation staff " + suffix;
    const email = `google-staff-${suffix}@example.test`;
    const [staff] = await tenant<{ id: string }[]>`
      INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${workspace.id}, ${name}, ${email}, 'read-only') RETURNING id
    `;
    createdStaffId = staff.id;

    await page.goto("/login");
    await page.getByLabel("Work email").fill(workspaceCase.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL((url) => url.pathname.startsWith(`/${workspaceCase.route}/app`));
    await page.goto(`/${workspaceCase.route}/app/team?employee=${staff.id}`);
    await page.getByLabel(`Actions for ${name}`).click();
    await page.getByRole("button", { name: "Google invitation", exact: true }).click();

    async function issue() {
      await page.getByRole("button", { name: "Create link" }).click();
      const input = page.getByRole("textbox", { name: "Invitation link" });
      await expect(input).toHaveValue(/\/join#[A-Za-z0-9_-]{43}$/);
      return input.inputValue();
    }
    async function reopen() {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByLabel(`Actions for ${name}`).click();
      await page.getByRole("button", { name: "Google invitation", exact: true }).click();
    }
    function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
      return { email, subject: suffix, verified: true, ...overrides };
    }

    const revoked = await issue();
    await page.getByRole("button", { name: "Revoke pending link" }).click();
    await expect(page.getByRole("textbox", { name: "Invitation link" })).toHaveCount(0);
    await acceptWithGoogle(signIn, revoked, profile());
    await expect(signIn).toHaveURL(/google=denied/);

    const expired = await issue();
    await control`UPDATE waybook_staff_invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      WHERE tenant_id = ${workspace.id} AND team_member_id = ${staff.id} AND revoked_at IS NULL`;
    await acceptWithGoogle(signIn, expired, profile());
    await expect(signIn).toHaveURL(/google=denied/);

    await reopen();
    const current = await issue();
    await acceptWithGoogle(signIn, current, profile({ subject: suffix + "-wrong", email: `wrong-${email}` }));
    await expect(signIn).toHaveURL(/google=denied/);
    await acceptWithGoogle(signIn, current, profile({ verified: false }));
    await expect(signIn).toHaveURL(/google=denied/);

    await acceptWithGoogle(signIn, current, profile());
    await expect(signIn).toHaveURL((url) => url.pathname.startsWith(`/${workspaceCase.route}/app`));
    await invitee.clearCookies();
    await acceptWithGoogle(signIn, current, profile());
    await expect(signIn).toHaveURL((url) => url.pathname.startsWith(`/${workspaceCase.route}/app`));
    await invitee.clearCookies();
    await acceptWithGoogle(signIn, "/login", profile());
    await expect(signIn).toHaveURL((url) => url.pathname.startsWith(`/${workspaceCase.route}/app`));
    const foreign = await signIn.request.get(`/${workspaceCase.foreignRoute}/app/calendars`, { maxRedirects: 0 });
    expect(foreign.status()).toBe(404);

    const [record] = await control`
      SELECT m.role, count(a.id)::int AS claims, bool_and(g.google_subject = ${suffix}) AS exact_subject
      FROM identities i JOIN tenant_memberships m ON m.identity_id = i.id
      JOIN waybook_google_identities g ON g.identity_id = i.id
      JOIN platform_audit_events a ON a.actor_identity_id = i.id AND a.action = 'staff.invitation.claimed'
      WHERE i.email = ${email} AND m.tenant_id = ${workspace.id}
      GROUP BY m.role
    `;
    expect(record).toMatchObject({ role: "read-only", claims: 1, exact_subject: true });
    const [link] = await tenant`SELECT identity_id IS NOT NULL AS linked FROM team_members WHERE id = ${staff.id}`;
    expect(link?.linked).toBe(true);
    const [session] = await control`SELECT count(*)::int AS count FROM waybook_oauth_sessions s JOIN waybook_oauth_users u
      ON u.id=s."userId" WHERE u.email = ${email}`;
    expect(session?.count).toBe(0);
    const [oauthAccount] = await control`SELECT "accessToken" IS NULL AND "refreshToken" IS NULL AND "idToken" IS NULL AS "tokensDiscarded"
      FROM waybook_oauth_accounts WHERE "providerId" = 'google' AND "accountId" = ${suffix}`;
    expect(oauthAccount?.tokensDiscarded).toBe(true);
  } finally {
    try {
      await invitee.close();
      if (createdStaffId) await tenant`DELETE FROM team_members WHERE id = ${createdStaffId}`;
    } finally {
      await Promise.all([tenant.end(), control.end()]);
    }
  }
});
