import { expect, test } from "@playwright/test";

test("Settings appearance follows the system and retains explicit choices after reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/settings");

  const html = page.locator("html");
  const modes = page.getByRole("group", { name: "Colour mode" });
  const system = modes.getByRole("button", { name: "System", exact: true });
  const dark = modes.getByRole("button", { name: "Dark", exact: true });
  const light = modes.getByRole("button", { name: "Light", exact: true });
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-waybook-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-waybook-theme", "dark");
  await light.focus();
  await page.keyboard.press("Enter");
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-waybook-theme", "light");
  await dark.click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-waybook-theme", "dark");

  const tints = page.getByRole("group", { name: "Accent tint" });
  for (const tint of ["Neutral", "Blue", "Violet", "Rose", "Teal", "Coral", "Amber"]) {
    const swatch = tints.getByRole("button", { name: tint, exact: true });
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    await expect(html).toHaveAttribute("data-waybook-tint", tint.toLowerCase());
    const offset = await swatch.evaluate((button) => {
      const outer = button.getBoundingClientRect();
      const inner = button.querySelector("i")!.getBoundingClientRect();
      return Math.max(
        Math.abs((outer.left + outer.right - inner.left - inner.right) / 2),
        Math.abs((outer.top + outer.bottom - inner.top - inner.bottom) / 2),
      );
    });
    expect(offset).toBeLessThanOrEqual(1);
  }
  await page.reload();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(tints.getByRole("button", { name: "Amber", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-waybook-theme", "dark");
  await expect(html).toHaveAttribute("data-waybook-tint", "amber");
  await system.click();
  await expect(html).toHaveAttribute("data-waybook-theme", "light");
});
