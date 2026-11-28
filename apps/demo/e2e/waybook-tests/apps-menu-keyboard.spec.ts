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
    if (workspace.route === "nordic") {
      const searchField = dialog.locator(".tenant-app-menu__search");
      const icon = dialog.getByRole("link", { name: "Sales", exact: true }).locator("i");
      const selectTint = (tint: string) => page.evaluate((value) => {
        document.documentElement.dataset.waybookTint = value;
      }, tint);

      await expect(page.locator("html")).toHaveAttribute("data-waybook-tint", "blue");
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-waybook-theme", theme);
        const blueSurface = await dialog.evaluate((node) => getComputedStyle(node).backgroundColor);
        const blueSearch = await searchField.evaluate((node) => getComputedStyle(node).backgroundColor);

        if (theme === "light") {
          const iconFill = await icon.evaluate((node) => getComputedStyle(node).backgroundColor);
          await expect(searchField).toHaveCSS("border-top-style", "solid");
          await expect(searchField).toHaveCSS("border-top-color", iconFill);
        }

        await selectTint("neutral");
        await expect(dialog).toHaveCSS("background-color", blueSurface);
        await expect(searchField).toHaveCSS("background-color", blueSearch);
        await selectTint("blue");
      }
      await page.emulateMedia({ colorScheme: "light" });
    }
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

test("Apps and account menus use glass surfaces and a compact, aligned Sign out row", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/nordic/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app$/);

  await page.getByRole("button", { name: "Apps", exact: true }).click();
  const apps = page.getByRole("dialog", { name: "Apps & settings" });
  await expect(apps).toHaveCSS("backdrop-filter", "blur(16px)");
  const sales = apps.getByRole("link", { name: "Sales", exact: true });
  await sales.hover();
  await expect(sales).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Account menu for / }).click();
  const account = page.getByRole("menu", { name: "Account menu" });
  await expect(account).toHaveCSS("backdrop-filter", "blur(16px)");
  const profile = account.getByRole("menuitem", { name: /^Edit profile/ });
  const signOut = account.getByRole("menuitem", { name: "Sign out", exact: true });
  await profile.hover();
  await expect(profile).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await signOut.hover();
  await expect(signOut).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const [profileRow, signOutRow, profileIcon, signOutIcon] = await Promise.all([
    profile.boundingBox(), signOut.boundingBox(), profile.locator("svg").boundingBox(), signOut.locator("svg").boundingBox(),
  ]);
  expect(signOutRow!.height).toBeLessThan(profileRow!.height);
  expect(Math.abs(signOutIcon!.x - profileIcon!.x)).toBeLessThan(1);
  expect(Math.abs(signOutIcon!.y + signOutIcon!.height / 2 - signOutRow!.y - signOutRow!.height / 2)).toBeLessThan(1);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-waybook-theme", "dark");
  await expect(account).toHaveCSS("backdrop-filter", "blur(16px)");
  await expect(signOut).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.mouse.move(0, 0);
  await expect(signOut).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(signOut.locator("span")).toHaveCSS("color", "rgb(240, 242, 245)");
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
});
