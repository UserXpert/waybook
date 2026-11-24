import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

const tenants = [
  { slug: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", login: "owner@nordic.local", email: "sofie@nordic.local", background: "#a78bfa" },
  { slug: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL", login: "owner@copenhagen-physio.local", email: "mikkel@copenhagen-physio.local", background: "#67c7cf" },
] as const;

async function login(page: Page, email: string, slug: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/app`));
}

test("both owners use the Staff Details form and share the saved photo with their account menu", async ({ page, browser }) => {
  const photos: string[] = [];
  for (const tenant of tenants) {
    const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
    const [original] = await db<{
      id: string; name: string; email: string; phone: string | null; role: string; isActive: boolean; color: string | null; photo: string | null;
    }[]>`
      SELECT id, name, email, phone, role, is_active AS "isActive", calendar_color AS color, photo_data_url AS photo
      FROM team_members WHERE role = 'owner' AND email = ${tenant.email}
    `;
    try {
      if (!original) throw new Error("The seeded owner profile is missing.");
      await login(page, tenant.login, tenant.slug);
      const menu = page.getByRole("button", { name: `Account menu for ${original.name}` });
      if (photos[0]) {
        await expect(menu).toBeVisible();
        expect(await menu.evaluate((el) => el.querySelector("img")?.getAttribute("src"))).not.toBe(photos[0]);
      }
      await menu.click();
      await page.getByRole("menuitem", { name: /^Edit profile/ }).click();
      await expect(page).toHaveURL(new RegExp(`/${tenant.slug}/app/team\\?employee=${original.id}`));
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      const email = page.getByRole("textbox", { name: "Email", exact: true });
      const phone = page.getByRole("textbox", { name: "Phone", exact: true });
      const role = page.getByRole("combobox", { name: "Role", exact: true });
      const save = page.getByRole("button", { name: "Save staff details" });
      await expect(name).toHaveValue(original.name);
      await expect(email).toBeEditable();
      await expect(phone).toBeEditable();
      await expect(role).toBeDisabled();
      await expect(role).toHaveValue("owner");
      await expect(page.locator('[name="internalNotes"]')).toHaveCount(0);
      await page.getByRole("link", { name: "Permissions", exact: true }).click();
      await expect(page.getByText("Workspace owners have full access.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save permissions", exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Details", exact: true }).click();
      await expect.poll(() => save.evaluate((button) => {
        const grid = button.closest("form")?.querySelector(".staff-profile-form__grid");
        return grid ? button.getBoundingClientRect().top - grid.getBoundingClientRect().bottom : 0;
      })).toBeGreaterThan(8);

      await name.fill("   ");
      await save.click();
      await expect(page.getByRole("alert").filter({ hasText: "Enter a name" })).toBeVisible();
      const nextName = `${tenant.slug} Owner QA`;
      const nextEmail = `contact-${tenant.slug}@example.invalid`;
      const nextPhone = "+45 12 34 56 78";
      await name.fill(nextName);
      await email.fill(nextEmail);
      await phone.fill(nextPhone);
      const colourGroup = page.getByRole("group", { name: "Calendar colour" });
      const newColour = colourGroup.locator('input[type="radio"]:enabled:not(:checked)').first();
      const nextColour = await newColour.inputValue({ timeout: 5000 });
      await newColour.check();
      await save.click();
      await expect(page.getByRole("status")).toHaveText("Details saved.");
      const updatedMenu = page.getByRole("button", { name: `Account menu for ${nextName}` });
      await expect(updatedMenu).toBeVisible();
      await page.reload();
      await expect(name).toHaveValue(nextName);
      await expect(email).toHaveValue(nextEmail);
      await expect(phone).toHaveValue(nextPhone);
      await expect(colourGroup.getByRole("radio", { checked: true })).toHaveValue(nextColour);

      const photoButton = page.getByRole("button", { name: `Change photo for ${nextName}` });
      const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: tenant.background } }).png().toBuffer();
      const selectedFile = page.waitForEvent("filechooser");
      await photoButton.click();
      await (await selectedFile).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: image });
      const savedPhoto = `data:image/png;base64,${image.toString("base64")}`;
      await expect(updatedMenu.locator("img")).toHaveAttribute("src", savedPhoto);
      photos.push(savedPhoto);
      await expect(photoButton.locator("img")).toHaveAttribute("src", savedPhoto);
      const [saved] = await db`SELECT id, name, email, phone, role, is_active AS "isActive", calendar_color AS color FROM team_members WHERE id = ${original.id}`;
      expect(saved).toEqual({ id: original.id, name: nextName, email: nextEmail, phone: nextPhone, role: original.role, isActive: original.isActive, color: nextColour });

      const fresh = await browser.newPage();
      try {
        await login(fresh, tenant.login, tenant.slug);
        await expect(fresh.getByRole("button", { name: `Account menu for ${nextName}` }).locator("img")).toHaveAttribute("src", savedPhoto);
      } finally {
        await fresh.close();
      }
      await updatedMenu.click();
      await expect(page.getByRole("menu", { name: "Account menu" }).locator("header img")).toHaveAttribute("src", savedPhoto);
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      try {
        if (original) await db`UPDATE team_members SET name = ${original.name}, email = ${original.email}, phone = ${original.phone}, calendar_color = ${original.color}, photo_data_url = ${original.photo} WHERE id = ${original.id}`;
      } finally {
        await db.end();
      }
    }
  }
  expect(photos[0]).not.toBe(photos[1]);
});
