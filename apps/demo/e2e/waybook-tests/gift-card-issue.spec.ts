import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`gift-card issue masks the number and rejects duplicate credit in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const code = `QA-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const suffix = code.slice(-4);
  const app = `/${tenant.route}/app`;
  const list = `${app}/gift-cards`;
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === app);
    await page.goto(list);
    const add = page.getByRole("link", { name: "Add gift card", exact: true });
    const issue = page.getByRole("complementary", { name: "Add gift card", exact: true });
    const create = issue.getByRole("button", { name: "Create gift card", exact: true });
    const number = issue.getByRole("textbox", { name: "Gift-card number", exact: true });
    const balance = issue.getByRole("spinbutton", { name: "Initial balance (DKK)", exact: true });
    await add.click();
    await number.fill(code);
    await balance.fill("150");
    await create.click();
    await expect(page.getByText("Gift card created.", { exact: true })).toBeVisible();
    const detail = page.getByRole("complementary", { name: "Gift-card details", exact: true });
    await expect(detail.getByRole("heading", { name: `Card ending ${suffix}` })).toBeVisible();
    await expect(detail.getByText(code, { exact: true })).toHaveCount(0);
    await expect(detail.getByText("Not linked", { exact: true })).toBeVisible();
    const giftId = new URL(page.url()).searchParams.get("card");
    const close = detail.getByRole("link", { name: "Close gift-card panel" });
    await close.click();
    await expect(page).toHaveURL((url) => url.pathname === list && url.search === "");
    const reopen = page.getByRole("link", { name: `Open gift card ending ${suffix}`, exact: true });
    await reopen.press("Enter");
    await expect(close).toBeFocused();
    const edit = detail.getByRole("link", { name: "Edit owner and presentation" });
    await page.keyboard.press("Tab");
    await expect(edit).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL((url) => url.pathname === list && url.search === "");
    await expect(reopen).toBeFocused();

    await reopen.press("Enter");
    await edit.press("Enter");
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(detail.getByPlaceholder("Search name, email, or phone")).toBeFocused();
    await close.click();
    await expect(page).toHaveURL((url) => url.pathname === list && url.search === "");
    await add.click();
    await number.fill(code);
    await balance.fill("200");
    await create.click();
    await expect(issue.getByRole("alert")).toContainText("That gift-card number already exists in this workspace.");
    await expect(number).toHaveValue(code);
    await expect(balance).toHaveValue("200");
    expect(await db`SELECT kind, amount_cents FROM commerce_gift_card_entries WHERE gift_card_id=${giftId}`).toEqual([{ kind: "issue", amount_cents: 15_000 }]);
  } finally {
    await db.end();
  }
});
