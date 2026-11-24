import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", slug: "nordic-studio", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", slug: "copenhagen-physio", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];
const profiles = [
  { label: "staff", role: "staff", grants: false },
  { label: "delegated staff", role: "staff", grants: true },
  { label: "read-only", role: "read-only", grants: true },
  { label: "manager", role: "manager", grants: false },
];
const managerPages = ["products", "gift-cards", "packages", "sales/retail", "emails", "notifications"];
const delegatedPages = ["bookings", "services", "locations", "online-booking"];

for (const workspace of workspaces) {
  test(`saved workspace links respect role and feature availability in ${workspace.route}`, async ({ browser, baseURL, viewport }) => {
    const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
    const tenant = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    try {
      const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug=${workspace.slug}`;
      const [{ password_hash: passwordHash }] = await control`SELECT password_hash FROM identities WHERE email=${workspace.owner}`;
      const features = await control`SELECT feature_key FROM tenant_feature_states WHERE tenant_id=${tenantId} AND is_enabled`;
      const enabled = new Set(features.map(({ feature_key }) => feature_key));
      const app = `/${workspace.route}/app`;
      for (const profile of profiles) {
        await test.step(profile.label, async () => {
          const context = await browser.newContext({ baseURL, viewport });
          const email = `restricted-pages-${randomUUID()}@example.test`;
          let identityId: string | undefined;
          let memberId: string | undefined;
          try {
            const [identity] = await control`INSERT INTO identities (email,password_hash,display_name)
              VALUES (${email},${passwordHash},'QA saved links') RETURNING id`;
            identityId = identity.id;
            await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identityId},${profile.role})`;
            const [member] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email)
              VALUES (${tenantId},${identityId},${profile.role},'QA saved links',${email}) RETURNING id`;
            memberId = member.id;
            if (profile.grants) {
              await tenant`INSERT INTO staff_permissions (tenant_id,team_member_id,can_manage_own_appointments,can_manage_service_settings,can_manage_resources)
                VALUES (${tenantId},${memberId},true,true,true)`;
            }
            const page = await context.newPage();
            await page.goto("/login");
            await page.getByLabel("Work email").fill(email);
            await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
            await page.getByRole("button", { name: "Sign in", exact: true }).click();
            const isManager = profile.role === "manager";
            await expect(page).toHaveURL((url) => url.pathname === (isManager ? app : `${app}/calendars`));
            await expect(page.getByLabel("Tenant dashboard navigation")).toBeVisible();
            const hasGrant = profile.role === "staff" && profile.grants;
            const allowed = new Set([
              ...(isManager ? managerPages.filter((route) => route !== "emails" || enabled.has("email-notifications")) : []),
              ...(isManager || hasGrant ? delegatedPages : []),
              ...(enabled.has("resources") && (isManager || hasGrant) ? ["resources"] : []),
            ]);
            for (const route of [...managerPages, ...delegatedPages, "resources", "settings?tab=roles"]) {
              const response = await page.goto(`${app}/${route}`);
              expect.soft(response?.status(), `${profile.label} opening ${route}`).toBe(allowed.has(route) ? 200 : 404);
              await expect.soft(page.getByLabel("Tenant dashboard navigation"), route).toHaveCount(allowed.has(route) ? 1 : 0);
            }
          } finally {
            await context.close();
            if (memberId) await tenant`DELETE FROM team_members WHERE id=${memberId}`;
            if (identityId) await control`DELETE FROM identities WHERE id=${identityId}`;
          }
        });
      }
    } finally {
      await Promise.all([tenant.end(), control.end()]);
    }
  });
}
