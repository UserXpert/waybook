import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

test("staff get unique calendar colours beyond the first eight", async ({ page }, testInfo) => {
  // The Waybook E2E config requires this URL to target a disposable database.
  const db = postgres(process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL!, { max: 1, ssl: false });
  const fixture = `calendar-colour-${randomUUID()}`;
  const theme = testInfo.project.name === "mobile" ? "dark" : "light";
  await page.addInitScript((appearance) => localStorage.setItem("waybook.theme", appearance), theme);
  try {
    const [workspace] = await db<{ id: string }[]>`SELECT tenant_id AS id FROM tenant_settings LIMIT 1`;
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@copenhagen-physio.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/copenhagen\/app/);
    await page.goto("/copenhagen/app/team?new=1");

    const picker = page.getByRole("group", { name: "Calendar colour" });
    const baseChoices = picker.getByRole("radio", { name: /^(?!Additional colour)/ });
    await expect(baseChoices).toHaveCount(8);
    const available = await baseChoices.evaluateAll((inputs) => inputs.filter((input) => !input.hasAttribute("disabled")).length);
    if (available) await expect(picker.getByRole("radio", { checked: true })).toBeEnabled();

    // Fill the remaining base colours through the same database default used
    // by other creation paths, then verify the next two profiles in the UI.
    for (let index = 0; index < available; index += 1) {
      await db`INSERT INTO team_members (tenant_id, role, name, email) VALUES (${workspace.id}, 'staff', 'Colour fixture', ${`${fixture}-${index}@example.test`})`;
    }
    const saved: string[] = [];
    for (const index of [0, 1]) {
      await page.goto("/copenhagen/app/team?new=1");
      await expect(picker.getByRole("radio", { disabled: true })).toHaveCount(8);
      const swatch = picker.getByRole("radio", { name: /^Additional colour/ });
      await expect(swatch).toBeChecked();
      const colour = await swatch.inputValue();
      expect(saved).not.toContain(colour);
      const selectedLabel = swatch.locator("..");
      await expect(page.locator("html")).toHaveAttribute("data-waybook-theme", theme);
      await expect(selectedLabel).toHaveCSS("box-shadow", "none");
      await expect(selectedLabel).toHaveCSS("border-top-width", "2px");
      await page.keyboard.press("Tab");
      await swatch.focus();
      await expect(selectedLabel).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
      await expect(selectedLabel).toHaveCSS("outline-style", "solid");
      const form = page.locator("form.staff-profile-form");
      await form.getByLabel("Name", { exact: true }).fill(`Colour test ${index}`);
      await form.getByLabel("Email", { exact: true }).fill(`${fixture}-ui-${index}@example.test`);
      await form.getByRole("button", { name: "Create staff member" }).click();
      await expect(page.getByRole("heading", { name: `Colour test ${index}`, exact: true })).toBeVisible();
      await expect(picker.getByRole("radio", { checked: true })).toHaveValue(colour);
      saved.push(colour);
    }
  } finally {
    try {
      await db`DELETE FROM team_members WHERE email LIKE ${`${fixture}-%@example.test`}`;
    } finally {
      await db.end();
    }
  }
});
