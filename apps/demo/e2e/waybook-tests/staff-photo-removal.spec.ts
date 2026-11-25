import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

const tenants = [
  { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", login: "owner@nordic.local", profileEmail: "sofie@nordic.local", colour: "#8b5fe6" },
  { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL", login: "owner@copenhagen-physio.local", profileEmail: "mikkel@copenhagen-physio.local", colour: "#70b7a1" },
] as const;

async function signIn(page: Page, tenant: (typeof tenants)[number]) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(tenant.login);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${tenant.route}/app`));
}

async function pickPhoto(page: Page, opener: Locator, buffer: Buffer) {
  const choosing = page.waitForEvent("filechooser");
  await opener.click();
  await (await choosing).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer });
}

for (const [index, tenant] of tenants.entries()) {
  test(`profile photo removal persists and stays in ${tenant.route}`, async ({ page, browser, baseURL, ignoreHTTPSErrors }) => {
    const db = postgres(process.env[tenant.database]!, { ssl: false, max: 1 });
    const otherDb = postgres(process.env[tenants[1 - index].database]!, { ssl: false, max: 1 });
    const owner = async (sql: typeof db, email: string) => (await sql<{
      id: string; name: string; identity_id: string; photo_data_url: string | null;
    }[]>`SELECT id,name,identity_id,photo_data_url FROM team_members WHERE email=${email} AND role='owner'`)[0];
    const original = await owner(db, tenant.profileEmail);
    const otherBefore = await owner(otherDb, tenants[1 - index].profileEmail);
    const removals = async () => (await db<{ count: number }[]>`
      SELECT count(*)::int AS count FROM tenant_audit_events
      WHERE action='staff.photo_updated' AND target_id=${original.id}
        AND actor_identity_id=${original.identity_id} AND metadata->>'removed'='true'
    `)[0].count;
    try {
      await signIn(page, tenant);
      const path = `/${tenant.route}/app/team?employee=${original.id}`;
      await page.goto(path);
      const profile = page.locator(".staff-workspace__profile-header");
      const avatar = profile.getByRole("button", { name: `Change photo for ${original.name}` });
      const row = page.getByRole("complementary", { name: "Staff directory" }).locator(`a[href*="employee=${original.id}"]`);
      const opener = page.getByRole("button", { name: `Account menu for ${original.name}` });
      const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: tenant.colour } }).png().toBuffer();
      const replacement = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#64b8db" } }).png().toBuffer();
      const uri = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

      await pickPhoto(page, avatar, photo);
      await expect(avatar.locator("img")).toHaveAttribute("src", uri(photo));
      await pickPhoto(page, avatar, Buffer.from("invalid PNG bytes"));
      await expect(profile.getByRole("alert")).toContainText("Could not upload photo");
      expect((await owner(db, tenant.profileEmail)).photo_data_url).toBe(uri(photo));
      await pickPhoto(page, avatar, replacement);
      await expect(avatar.locator("img")).toHaveAttribute("src", uri(replacement));
      await expect(row.locator("img")).toHaveAttribute("src", uri(replacement));
      await expect(opener.locator("img")).toHaveAttribute("src", uri(replacement));

      const before = await removals();
      const remove = profile.getByRole("button", { name: `Remove photo for ${original.name}` });
      await expect(remove).toBeVisible();
      const avatarBounds = (await avatar.boundingBox())!;
      const removeBounds = (await remove.boundingBox())!;
      expect(removeBounds.x + removeBounds.width / 2).toBeGreaterThan(avatarBounds.x + avatarBounds.width / 2);
      expect(Math.abs(removeBounds.y - avatarBounds.y)).toBeLessThanOrEqual(3);
      let promptText = "";
      page.once("dialog", async (prompt) => { promptText = prompt.message(); await prompt.dismiss(); });
      await remove.click();
      expect(promptText).toContain(original.name);
      expect(await removals()).toBe(before);
      await expect(avatar.locator("img")).toHaveAttribute("src", uri(replacement));

      page.once("dialog", (prompt) => prompt.accept());
      await remove.focus();
      await page.keyboard.press("Enter");
      await expect(avatar).toBeFocused();
      await expect(avatar).toHaveText(original.name[0]);
      await expect(row.locator("img")).toHaveCount(0);
      await expect(opener.locator("img")).toHaveCount(0);
      await expect(remove).toHaveCount(0);
      expect((await owner(db, tenant.profileEmail)).photo_data_url).toBeNull();
      expect(await removals()).toBe(before + 1);

      await opener.click();
      const menu = page.getByRole("menu", { name: "Account menu" });
      const menuAvatar = menu.getByRole("button", { name: "Upload profile photo" });
      await pickPhoto(page, menuAvatar, photo);
      await expect(opener.locator("img")).toHaveAttribute("src", uri(photo));
      await expect(menuAvatar.locator("img")).toHaveAttribute("src", uri(photo));
      await expect(menu.getByRole("menuitem", { name: /Remove.*photo/i })).toHaveCount(0);
      await opener.click();
      page.once("dialog", (prompt) => prompt.accept());
      await remove.click();
      await expect(avatar).toBeFocused();
      await expect(opener.locator("img")).toHaveCount(0);
      expect(await removals()).toBe(before + 2);
      expect(await owner(otherDb, tenants[1 - index].profileEmail)).toEqual(otherBefore);

      const fresh = await browser.newContext({ baseURL, ignoreHTTPSErrors, viewport: page.viewportSize() ?? undefined });
      try {
        const reloaded = await fresh.newPage();
        await signIn(reloaded, tenant);
        await reloaded.goto(path);
        await expect(reloaded.getByRole("button", { name: `Change photo for ${original.name}` }).locator("img")).toHaveCount(0);
        await expect(reloaded.getByRole("button", { name: `Account menu for ${original.name}` }).locator("img")).toHaveCount(0);
      } finally {
        await fresh.close();
      }
    } finally {
      try {
        if (original) await db`UPDATE team_members SET photo_data_url=${original.photo_data_url} WHERE id=${original.id}`;
      } finally {
        await Promise.all([db.end(), otherDb.end()]);
      }
    }
  });
}
