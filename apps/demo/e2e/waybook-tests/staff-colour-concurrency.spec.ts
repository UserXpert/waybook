import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`separate Add staff sessions allocate different colours in ${tenant.route}`, async ({ page, browser, baseURL }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const otherContext = await browser.newContext({ baseURL, viewport: page.viewportSize(), ignoreHTTPSErrors: true });
  const otherPage = await otherContext.newPage();
  const id = randomUUID();
  const emails = [`colour-a-${id}@example.test`, `colour-b-${id}@example.test`];
  const names = [`Parallel colour A ${id.slice(0, 8)}`, `Parallel colour B ${id.slice(0, 8)}`];
  const swatch = (session: Page) => session.getByRole("group", { name: "Calendar colour" }).getByRole("radio", { checked: true });
  const create = (session: Page) => session.getByRole("button", { name: "Create staff member", exact: true });

  async function prepare(session: Page, index: number) {
    await session.goto("/login");
    await session.getByLabel("Work email").fill(tenant.owner);
    await session.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await session.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(session).toHaveURL((url) => url.pathname === `/${tenant.route}/app`);
    await session.goto(`/${tenant.route}/app/team?new=1`);
    const form = session.locator("form.staff-profile-form");
    await form.getByLabel("Name", { exact: true }).fill(names[index]);
    await form.getByLabel("Email", { exact: true }).fill(emails[index]);
    await expect(swatch(session)).toBeEnabled();
    return swatch(session).inputValue();
  }

  try {
    const [firstPreview, secondPreview] = await Promise.all([prepare(page, 0), prepare(otherPage, 1)]);
    expect(firstPreview).toBe(secondPreview);
    await Promise.all([create(page).click(), create(otherPage).click()]);
    await expect(page.getByRole("heading", { name: names[0], exact: true })).toBeVisible();
    await expect(otherPage.getByRole("heading", { name: names[1], exact: true })).toBeVisible();
    const members = await db<{ email: string; colour: string }[]>`
      SELECT email,calendar_color AS colour FROM team_members WHERE email=ANY(${emails}) ORDER BY email
    `;
    expect(members.map(({ email }) => email)).toEqual(emails);
    expect(new Set(members.map(({ colour }) => colour)).size).toBe(2);
    expect(members.map(({ colour }) => colour)).toContain(firstPreview);
    await expect(swatch(page)).toHaveValue(members[0].colour);
    await expect(swatch(otherPage)).toHaveValue(members[1].colour);

    await Promise.all([page.reload(), otherPage.reload()]);
    const availableOption = (session: Page) => session.getByRole("group", { name: "Calendar colour" })
      .locator('input[type="radio"]:enabled:not(:checked)').first();
    const [editColour, otherEditColour] = await Promise.all([
      availableOption(page).inputValue(), availableOption(otherPage).inputValue(),
    ]);
    expect(editColour).toBe(otherEditColour);
    await Promise.all([availableOption(page).check(), availableOption(otherPage).check()]);
    const save = (session: Page) => session.getByRole("button", { name: "Save staff details", exact: true });
    const conflict = (session: Page) => session.getByRole("alert").filter({ hasText: "That calendar colour is already in use." });
    await Promise.all([save(page).click(), save(otherPage).click()]);
    await expect.poll(async () => await conflict(page).count() + await conflict(otherPage).count()).toBe(1);
    const afterEdit = await db<{ email: string; colour: string }[]>`
      SELECT email,calendar_color AS colour FROM team_members WHERE email=ANY(${emails}) ORDER BY email
    `;
    expect(afterEdit.map(({ colour }) => colour).filter((colour) => colour === editColour)).toHaveLength(1);
    const rejectedIndex = await conflict(page).count() ? 0 : 1;
    expect(afterEdit[rejectedIndex].colour).toBe(members[rejectedIndex].colour);
  } finally {
    try {
      await db`DELETE FROM team_members WHERE email=ANY(${emails})`;
    } finally {
      await Promise.all([db.end(), otherContext.close()]);
    }
  }
});
