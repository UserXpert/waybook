import { expect, test } from "@playwright/test";

for (const workspace of [
  { route: "nordic", owner: "owner@nordic.local" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local" },
]) {
  test(`Staff add-role popup keeps permission switches reachable by keyboard in ${workspace.route}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(workspace.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const app = `/${workspace.route}/app`;
    await expect(page).toHaveURL((url) => url.pathname === app);
    await page.goto(`${app}/team?new=1`);
    const opener = page.getByRole("button", { name: "Add role", exact: true });
    await opener.focus();
    await opener.press("Enter");
    const popup = page.getByRole("dialog", { name: "Add role", exact: true });
    const name = popup.getByRole("textbox", { name: "Role name", exact: true });
    await expect(name).toBeFocused();
    const switches = popup.getByRole("switch");
    const count = await switches.count();
    expect(count).toBeGreaterThan(10);
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press("Tab");
      await expect(switches.nth(index)).toBeFocused();
      await expect(switches.nth(index)).toHaveAccessibleName(/\S/);
    }
    const last = switches.last();
    await page.keyboard.press("Space");
    await expect(last).toBeChecked();
    await page.keyboard.press("Space");
    await expect(last).not.toBeChecked();
    await page.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Create role", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
