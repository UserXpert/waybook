import { expect, test } from "@playwright/test";

test("Settings appearance follows the system and retains explicit choices after reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  await expect(page.locator(".tenant-dashboard-page")).toHaveCSS("background-image", /login-blue-background/);
  await expect(page.getByRole("link", { name: "New appointment", exact: true })).toHaveCSS("background-color", "rgb(49, 92, 130)");
  await page.goto("/nordic/app/settings");

  const html = page.locator("html");
  const modes = page.getByRole("group", { name: "Colour mode" });
  const system = modes.getByRole("button", { name: "System", exact: true });
  const dark = modes.getByRole("button", { name: "Dark", exact: true });
  const light = modes.getByRole("button", { name: "Light", exact: true });
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-waybook-theme", "light");
  await expect(html).toHaveAttribute("data-waybook-tint", "blue");
  await expect(html).toHaveAttribute("data-waybook-background", "ripple");
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
  await expect(tints.getByRole("button", { name: "Ice Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const [id, label] of Object.entries({ neutral: "Neutral", blue: "Ice Blue", violet: "Violet", rose: "Rose", teal: "Teal", coral: "Coral", amber: "Amber" })) {
    const swatch = tints.getByRole("button", { name: label, exact: true });
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    await expect(html).toHaveAttribute("data-waybook-tint", id);
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

test("Workspace background stays selected when appearance colours change", async ({ page }) => {
  await page.goto("/nordic/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app$/);
  await page.goto("/nordic/app/settings");

  const html = page.locator("html");
  const dashboard = page.locator(".tenant-dashboard-page");
  const backgrounds = page.getByRole("group", { name: "Background pattern" });
  const tints = page.getByRole("group", { name: "Accent tint" });
  await expect(backgrounds.getByRole("button", { name: "Ripple" })).toHaveAttribute("aria-pressed", "true");
  await expect(backgrounds.getByRole("button")).toHaveCount(5);
  await backgrounds.getByRole("button", { name: "Folds" }).click();
  await expect(dashboard).toHaveCSS("background-image", /linear-gradient\(122deg/);
  await tints.getByRole("button", { name: "Violet" }).click();
  await expect(html).toHaveAttribute("data-waybook-background", "folds");
  await expect(dashboard).toHaveCSS("background-image", /linear-gradient\(122deg/);
  await page.getByRole("group", { name: "Colour mode" }).getByRole("button", { name: "Dark" }).click();
  await page.reload();
  await expect(html).toHaveAttribute("data-waybook-theme", "dark");
  await expect(html).toHaveAttribute("data-waybook-tint", "violet");
  await expect(backgrounds.getByRole("button", { name: "Folds" })).toHaveAttribute("aria-pressed", "true");

  await backgrounds.getByRole("button", { name: "Ripple" }).click();
  await tints.getByRole("button", { name: "Neutral" }).click();
  await expect(dashboard).toHaveCSS("background-image", /login-blue-background/);
  await expect(dashboard).toHaveCSS("background-color", "rgb(14, 14, 16)");
  await tints.getByRole("button", { name: "Ice Blue" }).click();
  await expect(dashboard).toHaveCSS("background-image", /login-blue-background/);
  await expect(dashboard).toHaveCSS("background-color", "rgb(13, 19, 28)");
  await backgrounds.getByRole("button", { name: "Plain" }).click();
  await expect(dashboard).toHaveCSS("background-image", "none");
});
