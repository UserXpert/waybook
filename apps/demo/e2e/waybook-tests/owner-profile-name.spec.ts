import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("an owner can rename their workspace profile from the account menu", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL!, { max: 1, ssl: false });
  const [original] = await db<{ id: string; name: string; email: string; role: string; isActive: boolean }[]>`
    SELECT id, name, email, role, is_active AS "isActive" FROM team_members
    WHERE role = 'owner' AND email = 'mikkel@copenhagen-physio.local'
  `;
  const newName = "Copenhagen Owner QA";
  try {
    if (!original) throw new Error("The seeded Copenhagen staff profile is missing.");
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@copenhagen-physio.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: `Account menu for ${original.name}` }).click();
    await page.getByRole("menuitem", { name: /^Edit profile/ }).click();
    await expect(page).toHaveURL(new RegExp(`/copenhagen/app/team\\?employee=${original.id}`));
    const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(nameInput).toHaveValue(original.name);
    await expect(page.getByRole("combobox", { name: "Role" })).toHaveCount(0);
    await nameInput.fill("   ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter a name" })).toBeVisible();
    await nameInput.fill(newName);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("status")).toHaveText("Name saved.");
    await expect(page.getByRole("heading", { name: newName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Account menu for ${newName}` })).toBeVisible();
    await page.reload();
    await expect(nameInput).toHaveValue(newName);
    const [saved] = await db`SELECT id, name, email, role, is_active AS "isActive" FROM team_members WHERE id = ${original.id}`;
    expect(saved).toEqual({ ...original, name: newName });
  } finally {
    try {
      if (original) await db`UPDATE team_members SET name = ${original.name} WHERE id = ${original.id}`;
    } finally {
      await db.end();
    }
  }
});
