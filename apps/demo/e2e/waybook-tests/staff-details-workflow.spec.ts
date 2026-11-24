import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("staff editing preserves profile fields and gives inline duplicate feedback", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const email = `staff-details-${randomUUID()}@example.test`;
  const staffName = `Alexandria ${"Christophersen".repeat(10)}`;
  const details = { "Staff code": "QA-42", "Job title": "Studio scheduler", Specialty: "Group sessions", "Work location": "Reception" };
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/team");
    await page.getByRole("link", { name: "Add staff", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(staffName);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    for (const [label, value] of Object.entries(details)) {
      await page.getByRole("textbox", { name: label, exact: true }).fill(value);
    }
    await page.getByRole("button", { name: "Create staff member", exact: true }).click();
    const heading = page.getByRole("heading", { name: staffName, exact: true });
    await expect(heading).toBeVisible();
    await expect.poll(() => heading.evaluate((element) => {
      const header = element.closest("header")!;
      return header.scrollWidth - header.clientWidth;
    })).toBeLessThanOrEqual(1);
    const profileUrl = page.url();
    const dismissNotice = page.getByRole("button", { name: "Dismiss notification" });
    await dismissNotice.click();

    await page.getByRole("textbox", { name: "Phone", exact: true }).fill("+45 12 34 56 78");
    await page.getByRole("button", { name: "Save staff details", exact: true }).click();
    await expect(page.getByText("Staff member saved.", { exact: true })).toBeVisible();
    await dismissNotice.click();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Phone", exact: true })).toHaveValue("+45 12 34 56 78");
    for (const [label, value] of Object.entries(details)) {
      await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(value);
    }
    await page.getByRole("link", { name: "Services & locations", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove Studio session", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove Studio session", exact: true }).click();
    await page.getByRole("button", { name: "Save services & locations", exact: true }).click();
    await expect(page.getByText("Staff member saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/tab=services/);
    await expect(page.getByRole("button", { name: "Remove Studio session", exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: "Add staff", exact: true }).click();
    await expect(page).toHaveURL(/new=1/);
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Duplicate Draft");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("button", { name: "Create staff member", exact: true }).click();
    await expect(page.getByText("A staff member already uses this email.", { exact: true })).toBeVisible();
    await expect(name).toHaveValue("Duplicate Draft");
    expect(await db`SELECT id FROM team_members WHERE email = ${email}`).toHaveLength(1);

    await page.goto(profileUrl);
    await page.getByRole("link", { name: "Work hours", exact: true }).click();
    const monday = page.getByRole("button", { name: "Edit Monday shifts", exact: true });
    await monday.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit shifts for Mondays", exact: true });
    const close = dialog.getByRole("button", { name: "Close shift editor", exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "+ Add a shift", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(monday).toBeFocused();
    await expect(monday).toContainText("No shifts");
  } finally {
    try {
      await db`DELETE FROM team_members WHERE email = ${email}`;
    } finally {
      await db.end();
    }
  }
});
