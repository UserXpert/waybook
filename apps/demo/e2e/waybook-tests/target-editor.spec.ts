import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", service: "Studio session" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL", service: "Initial physiotherapy assessment" },
];

for (const workspace of workspaces) {
  test(`the target editor shows service names and supports keyboard use in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const month = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 7);
    const [{ tenantId }] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings`;
    const [service] = await db<{ id: string }[]>`
      SELECT id FROM services WHERE tenant_id=${tenantId} AND title=${workspace.service} AND is_active
    `;

    try {
      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const app = `/${workspace.route}/app`;
      await expect(page).toHaveURL((url) => url.pathname === app);
      await page.goto(`${app}/reports`);
      await page.getByRole("link", { name: "Monthly targets", exact: true }).click();
      const opener = page.getByRole("link", { name: "Set target", exact: true });
      await opener.focus();
      await opener.press("Enter");

      const target = page.getByRole("dialog", { name: "Set monthly target" });
      const scope = target.getByRole("combobox", { name: "Target applies to" });
      const search = target.getByRole("textbox", { name: "Search target service" });
      const scopeId = target.locator('select[name="scopeId"]');
      await expect(scope).toBeFocused();
      for (let index = 0; index < 9; index += 1) {
        await page.keyboard.press("Tab");
        await expect(target.locator(":focus")).toHaveCount(1);
      }
      await scope.selectOption("service");
      await search.fill(workspace.service);
      await expect(scopeId.getByRole("option", { name: workspace.service, exact: true })).toHaveAttribute("value", service.id);
      await opener.evaluate((link) => {
        link.addEventListener("focus", () => {
          link.dataset.restoredFocusSearch = window.location.search;
        }, { once: true });
      });
      await page.keyboard.press("Escape");
      await expect(target).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute("data-restored-focus-search", "");

      await opener.press("Enter");
      await expect(scope).toHaveValue("staff");
      await scope.selectOption("service");
      await search.fill(workspace.service);
      await scopeId.selectOption({ label: workspace.service });
      await target.getByRole("combobox", { name: "Measure" }).selectOption("booked_value_cents");
      await target.locator('input[name="periodStart"]').fill(month);
      await target.getByRole("spinbutton", { name: "Monthly value target (DKK)" }).fill("900");
      await target.getByRole("button", { name: "Save target", exact: true }).click();
      await expect(target.getByRole("status")).toHaveText("Monthly target saved.");
      await target.getByRole("link", { name: "Close target editor" }).click();
      await expect(target).toHaveCount(0);
      await expect(opener).toBeFocused();

      const rows = await db`
        SELECT target_value AS value FROM performance_targets
        WHERE tenant_id=${tenantId} AND scope_type='service' AND scope_id=${service.id}
          AND metric='booked_value_cents' AND period_start=${`${month}-01`}::date
      `;
      expect(rows).toEqual([{ value: 90_000 }]);
      await expect(page.getByRole("row").filter({ hasText: workspace.service }).filter({ hasText: month })).toContainText("0%");
    } finally {
      try {
        await db`
          DELETE FROM performance_targets WHERE tenant_id=${tenantId} AND scope_type='service' AND scope_id=${service.id}
            AND metric='booked_value_cents' AND period_start=${`${month}-01`}::date
        `;
      } finally {
        await db.end();
      }
    }
  });
}
