import { expect, test } from "@playwright/test";

const tenant = { route: "nordic", owner: "owner@nordic.local" };

test("the product editor keeps keyboard focus in its drawer", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(tenant.owner);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const app = `/${tenant.route}/app`;
  await expect(page).toHaveURL((url) => url.pathname === app);
  const catalogue = `${app}/products?q=missing-qa-product`;
  await page.goto(catalogue);
  const trigger = page.getByRole("link", { name: "Add product", exact: true });

  await trigger.press("Enter");
  const editor = page.getByRole("dialog", { name: "Add product", exact: true });
  const name = editor.getByRole("textbox", { name: "Product name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("Unsaved QA keyboard draft");
  for (const step of ["Shift+Tab", "Tab", "Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(step);
    await expect.poll(() => editor.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.pathname + url.search === catalogue);
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await expect(name).toHaveValue("");
});
