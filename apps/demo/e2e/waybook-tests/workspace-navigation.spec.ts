import { expect, test } from "@playwright/test";

for (const workspace of [
  { slug: "nordic", name: "Nordic Studio", email: "owner@nordic.local" },
  { slug: "copenhagen", name: "Copenhagen Physio", email: "owner@copenhagen-physio.local" },
]) {
  test(`enabled navigation routes to ${workspace.name} without horizontal overflow`, {
    tag: "@mobile",
  }, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(workspace.email);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/app`));
    const shell = page.getByLabel("Tenant dashboard navigation");
    const primary = shell.getByRole("navigation", { name: "Primary navigation" });
    const primaryRoutes = await primary.getByRole("link").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
    await shell.getByRole("button", { name: "Apps", exact: true }).click();
    const apps = page.getByRole("dialog", { name: "Apps & settings" });
    await expect(apps).toBeVisible();
    const appRoutes = await apps.getByRole("link").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
    expect(appRoutes.length).toBeGreaterThan(5);
    await page.keyboard.press("Escape");
    await expect(apps).toHaveCount(0);
    await shell.getByRole("button", { name: /^Account menu for / }).click();
    const settings = await page.getByRole("menuitem", { name: /^Settings/ }).getAttribute("href");
    expect(settings).toBe(`/${workspace.slug}/app/settings`);
    const app = `/${workspace.slug}/app`;
    for (const route of [...primaryRoutes, ...appRoutes]) {
      expect(route === app || route.startsWith(`${app}/`), route).toBe(true);
    }
    expect(primaryRoutes).toContain(`${app}/calendars`);
    for (const route of [`${app}/calendars`, `${app}/settings`]) {
      await test.step(route, async () => {
        const response = await page.goto(route);
        expect.soft(response?.status(), route).toBe(200);
        expect.soft(new URL(page.url()).pathname, route).toBe(route);
        await expect.soft(shell.getByText(workspace.name, { exact: true }), route).toBeVisible();
        await expect.soft(page.getByRole("main").getByRole("heading").first(), route).toBeVisible();
        const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect.soft(pageOverflow, route).toBeLessThanOrEqual(1);
      });
    }
  });
}
