import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local" },
]) test(`Calendar location search stays open after quick refocus in ${tenant.route}`, { tag: tenant.route === "nordic" ? "@mobile" : [] }, async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(tenant.owner);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const app = `/${tenant.route}/app`;
  await expect(page).toHaveURL((url) => url.pathname === app);
  await page.goto(`${app}/calendars`);
  const filters = page.locator(".calendar-filter-panel");
  const collapsedFilters = filters.locator("summary").filter({ visible: true });
  if (await collapsedFilters.count() && !await filters.evaluate((panel) => (panel as HTMLDetailsElement).open)) {
    await collapsedFilters.click();
  }
  const location = page.getByRole("combobox", { name: "Location", exact: true });
  const query = `No location ${randomUUID()}`;
  await location.fill("First search");
  await expect(location).toHaveAttribute("aria-expanded", "true");
  const results = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/app/locations") && url.searchParams.get("q") === query && response.ok();
  }, { timeout: 3500 });
  await location.evaluate((input) => {
    (input as HTMLInputElement).blur();
    (input as HTMLInputElement).focus();
  });
  await location.fill(query);
  await results;
  await expect(location).toBeFocused();
  await expect(location).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("listbox", { name: "Location results" })).toContainText("No matches found.");
  await location.press("Escape");
  await expect(location).toHaveAttribute("aria-expanded", "false");
  await expect(location).toBeFocused();
  await location.press("Escape");
  await expect(location).toBeHidden();
  await expect(collapsedFilters).toBeFocused();
});
