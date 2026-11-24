import { expect, test } from "@playwright/test";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local" },
];

for (const workspace of workspaces) {
  test(`Apps search and keyboard navigation work in ${workspace.route}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(workspace.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const app = `/${workspace.route}/app`;
    await expect(page).toHaveURL((url) => url.pathname === app);

    const opener = page.getByRole("button", { name: "Apps", exact: true });
    const dialog = page.getByRole("dialog", { name: "Apps & settings" });
    const search = dialog.getByRole("textbox", { name: "Search apps and settings" });
    const close = dialog.getByRole("button", { name: "Close apps menu" });
    const links = dialog.getByRole("link");

    await opener.focus();
    await opener.press("Enter");
    await expect(search).toBeFocused();
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(5);
    for (let index = 0; index < linkCount; index += 1) {
      await page.keyboard.press("Tab");
      await expect(links.nth(index)).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(links.last()).toBeFocused();

    await search.fill("QA no such app");
    await expect(dialog.getByText(/No enabled Waybook app matches/)).toBeVisible();
    await expect(links).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(search).toHaveValue("");
    await page.locator(".tenant-app-menu__scrim").click({ position: { x: 3, y: 3 } });
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.press("Enter");
    await search.fill("Services");
    const services = dialog.getByRole("link", { name: "Services", exact: true });
    await expect(services).toHaveAttribute("href", `${app}/services`);
    await services.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === `${app}/services`);
    await expect(dialog).toHaveCount(0);
  });
}
