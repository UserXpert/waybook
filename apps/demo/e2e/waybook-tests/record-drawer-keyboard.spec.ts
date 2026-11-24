import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`client records and package definitions keep focus in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const suffix = randomUUID().slice(0, 8);
  const name = `QA keyboard contact ${suffix}`;
  const email = `keyboard-${suffix}@example.test`;
  let customerId: string | undefined;
  try {
    const [customer] = await db<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email)
      SELECT tenant_id,${name},${email} FROM tenant_settings RETURNING id`;
    customerId = customer.id;
    await page.goto("/login");
    await page.getByLabel("Work email").fill(tenant.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const app = `/${tenant.route}/app`;
    await expect(page).toHaveURL((url) => url.pathname === app);

    await page.goto(`${app}/customers?q=${encodeURIComponent(name)}`);
    const recordLink = page.getByRole("link", { name: new RegExp(`^${name}\\b`) });
    const row = page.getByRole("row").filter({ has: recordLink });
    await expect(row.locator('a:not([tabindex="-1"])')).toHaveCount(1);
    await recordLink.press("Enter");
    const record = page.getByRole("dialog", { name: new RegExp(`record for ${name}`, "i") });
    const closeRecord = record.getByRole("link", { name: /^Close (client|patient) record$/i });
    await expect(closeRecord).toBeFocused();
    for (const [key, label] of [["Tab", "Overview"], ["Tab", "Timeline"], ["Shift+Tab", "Overview"]]) {
      await page.keyboard.press(key);
      await expect(record.getByRole("link", { name: label, exact: true })).toBeFocused();
    }

    const edit = record.getByRole("link", { name: "Edit", exact: true });
    await edit.press("Enter");
    const editor = page.getByRole("dialog", { name: /^Edit (client|patient) /i });
    const nameInput = editor.getByRole("textbox", { name: "Name", exact: true });
    await expect(nameInput).toBeFocused();
    await nameInput.fill("Unsubmitted QA edit");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.searchParams.get("customer") === customerId && !url.searchParams.has("edit"));
    await expect(edit).toBeFocused();
    await expect(record.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(record).toHaveCount(0);
    await expect(page).toHaveURL((url) => !url.searchParams.has("customer") && url.searchParams.get("q") === name);
    await expect(recordLink).toBeFocused();
    await expect(page.getByRole("searchbox")).toHaveValue(name);
    await row.getByRole("link", { name: email, exact: true }).click();
    await expect(record).toBeVisible();
    await closeRecord.click();
    await expect(page).toHaveURL((url) => !url.searchParams.has("customer") && url.searchParams.get("q") === name);

    await page.goto(`${app}/packages`);
    const create = page.getByRole("link", { name: "Create definition", exact: true });
    await create.press("Enter");
    const definition = page.getByRole("dialog", { name: "Create definition", exact: true });
    const title = definition.getByRole("textbox", { name: "Package name", exact: true });
    await expect(title).toBeFocused();
    await title.fill("Unsubmitted QA definition");
    await page.keyboard.press("Escape");
    await expect(definition).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === `${app}/packages` && url.search === "");
    await expect(create).toBeFocused();
    await create.press("Enter");
    await expect(title).toHaveValue("");
    await definition.getByRole("link", { name: "Close package setup", exact: true }).press("Enter");
    await expect(definition).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === `${app}/packages` && url.search === "");
    await expect(create).toBeFocused();
  } finally {
    try {
      if (customerId) await db`DELETE FROM customers WHERE id=${customerId}`;
    } finally {
      await db.end();
    }
  }
});
