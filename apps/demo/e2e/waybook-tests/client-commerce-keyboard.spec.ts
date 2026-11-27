import { expect, test } from "@playwright/test";

const tenant = { route: "nordic", owner: "owner@nordic.local" };

test("client and commerce forms keep keyboard focus", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(tenant.owner);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const app = `/${tenant.route}/app`;
  await expect(page).toHaveURL((url) => url.pathname === app);

  for (const module of [
    { path: "customers", title: /^Add (client|patient)$/i, close: /^Close (client|patient) form$/i },
    { path: "packages", title: /^Add package$/i, close: /^Close package issue$/i },
    { path: "gift-cards", title: /^Add gift card$/i, close: /^Close gift-card panel$/i },
  ]) await test.step(module.path, async () => {
    const list = `${app}/${module.path}`;
    await page.goto(list);
    const trigger = page.getByRole("link", { name: module.title });
    await trigger.press("Enter");
    const editor = page.getByRole("dialog", { name: module.title });
    const initial = module.path === "packages"
      ? editor.getByPlaceholder("Search name, email, or phone")
      : editor.getByRole("textbox", { name: module.path === "customers" ? "Name" : "Gift-card number", exact: true });
    await expect(initial).toBeFocused();
    await initial.fill("Unsubmitted QA draft");
    for (const key of ["Shift+Tab", "Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      await expect.poll(() => editor.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === list && url.search === "");
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    await expect(initial).toHaveValue("");
    await editor.getByRole("link", { name: module.close }).press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
