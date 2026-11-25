import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

async function addLegacyField(form: Locator, name: string, value: string) {
  await form.evaluate((element, field) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = field.name;
    input.value = field.value;
    element.append(input);
  }, { name, value });
}

test("client records accept contact details and keep historical free text out of the workspace", async ({ page }) => {
  // The Waybook E2E configuration limits this connection to a disposable local database.
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const suffix = randomUUID();
  const name = `Existing contact ${suffix}`;
  const email = `existing-${suffix}@example.test`;
  const newEmail = `new-${suffix}@example.test`;
  const legacyNote = `legacy-note-${suffix}`;
  const legacyTag = `legacy-tag-${suffix}`;
  const blockedText = `blocked-text-${suffix}`;
  let tenantId: string | undefined;

  try {
    const [workspace] = await db<{ id: string }[]>`SELECT tenant_id AS id FROM tenant_settings LIMIT 1`;
    tenantId = workspace.id;
    const [customer] = await db<{ id: string }[]>`
      INSERT INTO customers (tenant_id, name, email, internal_notes, tags)
      VALUES (${tenantId}, ${name}, ${email}, ${legacyNote}, ARRAY[${legacyTag}]::text[])
      RETURNING id
    `;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);

    const directory = "/nordic/app/customers";
    const existing = `${directory}?customer=${customer.id}`;
    const response = await page.goto(existing);
    await expect(page.getByRole("complementary", { name: `Client record for ${name}` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Notes", exact: true })).toHaveCount(0);
    const html = await response?.text();
    expect(html).not.toContain(legacyNote);
    expect(html).not.toContain(legacyTag);

    const lookup = await page.request.get(`/nordic/api/app/clients?q=${encodeURIComponent(email)}`);
    expect(lookup.ok()).toBe(true);
    const { items } = await lookup.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: customer.id, name, email });
    expect(items[0]).not.toHaveProperty("tags");
    expect(items[0]).not.toHaveProperty("internalNotes");

    const edit = page.getByRole("link", { name: "Edit", exact: true });
    await edit.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^(Edit (client|patient) |Add (client|patient)$)/i });
    const form = dialog.locator("form");
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await expect(form.locator('[name="internalNotes"], [name="tags"]')).toHaveCount(0);
    await addLegacyField(form, "internalNotes", blockedText);
    await dialog.getByLabel("Name").fill("Rejected edit");
    await dialog.getByRole("button", { name: "Save client" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("alert")).not.toContainText(blockedText);
    const [unchanged] = await db`SELECT name FROM customers WHERE tenant_id = ${tenantId} AND id = ${customer.id}`;
    expect(unchanged.name).toBe(name);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`customer=${customer.id}$`));
    await expect(edit).toBeFocused();

    await page.goto(`${existing}&edit=1`);
    await dialog.getByLabel("Phone").fill("+45 11 22 33 44");
    await dialog.getByRole("button", { name: "Save client" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Contact details saved.");
    const [updated] = await db`
      SELECT phone, internal_notes, tags FROM customers WHERE tenant_id = ${tenantId} AND id = ${customer.id}
    `;
    expect(updated).toMatchObject({ phone: "+45 11 22 33 44", internal_notes: legacyNote, tags: [legacyTag] });

    await page.goto(`${directory}?create=1`);
    await dialog.getByLabel("Name").fill("New contact");
    await dialog.getByLabel("Email").fill(newEmail);
    await expect(form.locator('[name="internalNotes"], [name="tags"]')).toHaveCount(0);
    await addLegacyField(form, "tags", "");
    await addLegacyField(form, "tags", blockedText);
    await dialog.getByRole("button", { name: "Save client" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("alert")).not.toContainText(blockedText);
    expect(await db`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND email = ${newEmail}`).toHaveLength(0);

    await page.goto(`${directory}?create=1`);
    await dialog.getByLabel("Name").fill("New contact");
    await dialog.getByLabel("Email").fill(newEmail);
    await dialog.getByRole("button", { name: "Save client" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Contact details saved.");
    const [created] = await db`SELECT internal_notes, tags FROM customers WHERE tenant_id = ${tenantId} AND email = ${newEmail}`;
    expect(created).toMatchObject({ internal_notes: null, tags: [] });
  } finally {
    try {
      if (tenantId) await db`DELETE FROM customers WHERE tenant_id = ${tenantId} AND email IN (${email}, ${newEmail})`;
    } finally {
      await db.end();
    }
  }
});
