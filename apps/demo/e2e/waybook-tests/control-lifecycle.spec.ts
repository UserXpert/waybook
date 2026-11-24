import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("Control feature and lifecycle changes affect only the selected workspace", async ({ page, browser, baseURL }) => {
  await signIn(page, "admin@waybook.local");
  await expect(page).toHaveURL(/\/control$/);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("link", { name: /Nordic Studio/ }).click();
  const details = page.getByRole("complementary", { name: "Nordic Studio details" });
  await expect(details.getByRole("heading", { name: "Nordic Studio" })).toBeVisible();
  await expect(details.getByText("Migration", { exact: true })).toBeVisible();
  await expect(details.getByText("Backup", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: /Open read-only tenant dashboard/ })).toHaveAttribute("href", new URL("/nordic/app", baseURL).href);
  await expect(details.getByText("Always on", { exact: true })).toBeVisible();

  const nordicContext = await browser.newContext({ baseURL });
  const copenhagenContext = await browser.newContext({ baseURL });
  const nordic = await nordicContext.newPage();
  const copenhagen = await copenhagenContext.newPage();
  const disableClients = details.getByRole("switch", { name: "Disable Clients" });
  const enableClients = details.getByRole("switch", { name: "Enable Clients" });
  const suspend = details.getByRole("button", { name: "Suspend", exact: true });
  const reactivate = details.getByRole("button", { name: "Reactivate", exact: true });
  try {
    await signIn(nordic, "owner@nordic.local");
    await signIn(copenhagen, "owner@copenhagen-physio.local");
    await expect(nordic).toHaveURL(/\/nordic\/app$/);
    await expect(copenhagen).toHaveURL(/\/copenhagen\/app$/);

    await disableClients.click();
    await expect(enableClients).toHaveAttribute("aria-checked", "false");
    await nordic.goto("/nordic/app/customers");
    await expect(nordic).toHaveURL(/\/nordic\/app$/);
    await copenhagen.goto("/copenhagen/app/customers");
    await expect(copenhagen).toHaveURL(/\/copenhagen\/app\/customers$/);
    await enableClients.click();
    await expect(disableClients).toHaveAttribute("aria-checked", "true");

    await suspend.click();
    await expect(reactivate).toBeVisible();
    expect((await nordic.goto("/nordic/app"))?.status()).toBe(404);
    expect((await nordic.goto("/nordic/book"))?.status()).toBe(404);
    expect((await copenhagen.goto("/copenhagen/book"))?.status()).toBe(200);
    expect((await copenhagen.goto("/copenhagen/app"))?.status()).toBe(200);

    await reactivate.click();
    await expect(suspend).toBeVisible();
    expect((await nordic.goto("/nordic/book"))?.status()).toBe(200);
    await nordic.goto("/nordic/app/customers");
    await expect(nordic).toHaveURL(/\/nordic\/app\/customers$/);
  } finally {
    if (await reactivate.isVisible()) {
      await reactivate.click();
      await expect(suspend).toBeVisible();
    }
    if (await enableClients.isVisible()) {
      await enableClients.click();
      await expect(disableClients).toBeVisible();
    }
    await nordicContext.close();
    await copenhagenContext.close();
  }
});
