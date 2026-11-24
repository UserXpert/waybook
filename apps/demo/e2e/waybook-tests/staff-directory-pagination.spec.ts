import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`staff directory pages across active, inactive and archived staff in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const batch = `QA roster ${randomUUID()}`;
    try {
      const [{ tenant_id: tenantId }] = await db`SELECT tenant_id FROM tenant_settings`;
      const seeded = await db<{ id: string }[]>`INSERT INTO team_members (tenant_id,role,name,email,is_active,archived_at)
        SELECT ${tenantId}, 'staff', ${batch} || ' ' || CASE WHEN n <= 52 THEN 'Z active ' WHEN n <= 104 THEN 'A inactive ' ELSE 'B archived ' END
          || lpad((CASE WHEN n = 50 THEN 49 ELSE n % 52 END)::text,2,'0'), ${batch.replaceAll(" ", "-")} || '-' || n || '@example.test',
          n <= 52, CASE WHEN n > 104 THEN '2025-01-01'::timestamptz + ((n % 2) * interval '1 day') END
        FROM generate_series(1,156) n RETURNING id`;
      const expected = await db<{ id: string }[]>`SELECT id FROM team_members WHERE id = ANY(${seeded.map(({ id }) => id)}::uuid[])
        ORDER BY archived_at NULLS FIRST, is_active DESC, name, id`;

      const app = `/${workspace.route}/app`;
      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname === app);
      await page.goto(`${app}/team?q=${encodeURIComponent(batch)}`);
      const roster = page.getByRole("complementary", { name: "Staff directory" });
      const links = roster.getByRole("navigation").getByRole("link");
      const more = roster.getByRole("link", { name: "Load more staff" });
      for (let first = 0; first < expected.length; first += 50) {
        const ids = expected.slice(first, first + 50).map(({ id }) => id);
        await expect.poll(() => links.evaluateAll((rows) => rows.map((row) => new URL((row as HTMLAnchorElement).href).searchParams.get("employee")))).toEqual(ids);
        await expect(page.getByRole("searchbox")).toHaveValue(batch);
        if (first + 50 < expected.length) await more.click();
      }
      await expect(more).toHaveCount(0);
      const last = expected.at(-1)!;
      await links.last().click();
      await expect(page).toHaveURL((url) => url.searchParams.get("employee") === last.id);
      await expect(page.getByRole("heading", { name: new RegExp(`^${batch} B archived`) })).toBeVisible();
    } finally {
      try {
        await db`DELETE FROM team_members WHERE name LIKE ${`${batch} %`}`;
      } finally {
        await db.end();
      }
    }
  });
}
