import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("an owner can select a profile photo and oversized files are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/team");
  const button = page.getByRole("button", { name: "Change photo for Sofie Andersen" });
  await expect(button).toBeVisible();
  let chooserPromise = page.waitForEvent("filechooser");
  await button.click();
  let chooser = await chooserPromise;
  await chooser.setFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(250_001) });
  await expect(page.locator(".staff-photo-upload__error")).toContainText("smaller than 250 KB");
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#6c56ad" } }).png().toBuffer();
  chooserPromise = page.waitForEvent("filechooser");
  await button.click();
  chooser = await chooserPromise;
  await chooser.setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: image });
  await expect(button.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Change photo for Sofie Andersen" }).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
});

test("Apps menu groups, search, keyboard and navigation work", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  await apps.click();
  const dialog = page.getByRole("dialog", { name: "Apps & settings" });
  await expect(dialog).toBeVisible();
  for (const group of ["Operations", "Commerce", "Setup", "Insights"]) await expect(dialog.getByRole("heading", { name: group, exact: true })).toBeVisible();
  const columns = await dialog.locator(".tenant-app-menu__groups").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(testInfo.project.name === "mobile" ? 1 : 4);
  const search = dialog.getByRole("textbox", { name: "Search apps and settings" });
  await search.fill("staff");
  await expect(dialog.getByRole("link", { name: "Staff", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Sales", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(apps).toBeFocused();
  await apps.click();
  await dialog.getByRole("link", { name: "Staff", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app\/team/);
});

test("staff can change their own photo and read-only members cannot", async ({ page, browser }) => {
  const { default: postgres } = await import("postgres");
  const { randomUUID } = await import("node:crypto");
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  const tenantUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  for (const raw of [controlUrl, tenantUrl]) {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) throw new Error("Staff photo tests require disposable local databases.");
  }
  const control = postgres(controlUrl, { max: 1, ssl: false });
  const tenant = postgres(tenantUrl, { max: 1, ssl: false });
  const suffix = randomUUID();
  const staffEmail = `staff-${suffix}@example.test`;
  const readOnlyEmail = `readonly-${suffix}@example.test`;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [staff] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${staffEmail},${owner.password_hash},'Test staff') RETURNING id`;
    const [readOnly] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${readOnlyEmail},${owner.password_hash},'Test read only') RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${staff.id},'staff'),(${workspace.id},${readOnly.id},'read-only')`;
    await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${staff.id},'staff','Test staff',${staffEmail}),(${workspace.id},${readOnly.id},'read-only','Test read only',${readOnlyEmail}) RETURNING id,identity_id`;
    await page.goto('/login');
    await page.getByLabel('Work email').fill(staffEmail);
    await page.getByPlaceholder('Enter your password').fill('waybook-local-only');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/nordic\/app\/calendars/);
    await page.goto('/nordic/app/team');
    const button = page.getByRole('button', { name: 'Change photo for Test staff' });
    await expect(button).toBeVisible();
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#6c56ad' } }).png().toBuffer();
    const chooserPromise = page.waitForEvent('filechooser');
    await button.click();
    await (await chooserPromise).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
    await expect(button.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByRole('link', { name: /Sofie Andersen/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const readContext = await browser.newContext({ baseURL: "http://localhost:3336" });
    const readPage = await readContext.newPage();
    await readPage.goto('/login');
    await readPage.getByLabel('Work email').fill(readOnlyEmail);
    await readPage.getByPlaceholder('Enter your password').fill('waybook-local-only');
    await readPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(readPage).toHaveURL(/\/nordic\/app\/calendars/);
    await readPage.goto('/nordic/app/team');
    await expect(readPage.getByRole('heading', { name: 'Test read only' })).toBeVisible();
    await expect(readPage.getByRole('button', { name: /Change photo/ })).toHaveCount(0);
    await readPage.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(readPage.getByRole('dialog').getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await readContext.close();
  } finally { await control.end(); await tenant.end(); }
});
