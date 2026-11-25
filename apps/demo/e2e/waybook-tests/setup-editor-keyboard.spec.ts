import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", slug: "nordic-studio", owner: "owner@nordic.local" },
  { route: "copenhagen", slug: "copenhagen-physio", owner: "owner@copenhagen-physio.local" },
]) test(`setup editors handle keyboard navigation in ${tenant.route}`, async ({ page }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  try {
    const [feature] = await control<{ tenant_id: string; is_enabled: boolean }[]>`
      SELECT tfs.tenant_id, tfs.is_enabled
      FROM tenant_feature_states tfs JOIN tenants t ON t.id=tfs.tenant_id
      WHERE t.slug=${tenant.slug} AND tfs.feature_key='resources'`;
    if (!feature.is_enabled) {
      await control`UPDATE tenant_feature_states SET is_enabled=true WHERE tenant_id=${feature.tenant_id} AND feature_key='resources'`;
    }
    try {
      await page.goto("/login");
      await page.getByLabel("Work email").fill(tenant.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const app = `/${tenant.route}/app`;
      await expect(page).toHaveURL((url) => url.pathname === app);

      for (const [noun, field] of [["service", "Service name"], ["location", "Location name"], ["resource", "Resource name"]]) {
        await test.step(noun, async () => {
          const path = `${app}/${noun}s`;
          await page.goto(path);
          const trigger = page.getByRole("link", { name: `Add ${noun}`, exact: true });
          await trigger.press("Enter");
          const editor = page.getByRole("dialog", { name: `Add ${noun}`, exact: true });
          const name = editor.getByRole("textbox", { name: field, exact: true });
          await expect(name).toBeFocused();
          await name.fill("Unsaved keyboard draft");
          for (const key of ["Shift+Tab", "Tab", "Tab", "Tab"]) {
            await page.keyboard.press(key);
            await expect.poll(() => editor.evaluate((element) => element.contains(document.activeElement))).toBe(true);
          }
          await page.keyboard.press("Escape");
          await expect(editor).toHaveCount(0);
          await expect(page).toHaveURL((url) => url.pathname === path && url.search === "");
          await expect(trigger).toBeFocused();

          await trigger.press("Enter");
          await expect(name).toHaveValue("");
          await editor.getByRole("link", { name: `Close ${noun} editor`, exact: true }).press("Enter");
          await expect(editor).toHaveCount(0);
          await expect(trigger).toBeFocused();
        });
      }
    } finally {
      if (!feature.is_enabled) {
        await control`UPDATE tenant_feature_states SET is_enabled=false WHERE tenant_id=${feature.tenant_id} AND feature_key='resources'`;
      }
    }
  } finally {
    await control.end();
  }
});
