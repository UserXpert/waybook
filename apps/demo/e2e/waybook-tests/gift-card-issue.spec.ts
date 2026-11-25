import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.use({ actionTimeout: 6000 });

test("gift-card issue masks the number and rejects a duplicate without adding credit", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const code = `QA-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  const suffix = code.slice(-4);
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/gift-cards");
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
    await detail.getByRole("link", { name: "Close gift-card panel" }).click();
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
