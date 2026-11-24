import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("owner terminology follows the workspace into staff and public booking flows", async ({ page }) => {
  // Waybook E2E permits only disposable local database URLs.
  const db = postgres(process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL!, { max: 1, ssl: false });
  const [workspace] = await db<{ id: string }[]>`SELECT tenant_id AS id FROM tenant_settings LIMIT 1`;
  const [previous] = await db<{ clientTerm: string; staffTerm: string }[]>`
    SELECT client_term AS "clientTerm", staff_term AS "staffTerm" FROM tenant_terminology WHERE tenant_id = ${workspace.id}`;
  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@copenhagen-physio.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/copenhagen\/app/);

    await page.goto("/copenhagen/app/settings#terminology");
    const terminology = page.locator("#terminology");
    await terminology.getByLabel("People who book").selectOption("patient");
    await terminology.getByLabel("People providing services").selectOption("practitioner");
    await terminology.getByRole("button", { name: "Save terminology" }).click();
    await expect(terminology.getByRole("status")).toHaveText("Terminology saved.");
    await page.reload();
    await expect(terminology.getByLabel("People who book")).toHaveValue("patient");
    await expect(terminology.getByLabel("People providing services")).toHaveValue("practitioner");

    await page.goto("/copenhagen/app/team");
    await expect(page.getByRole("heading", { name: "Practitioners", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Patients", exact: true })).toBeVisible();
    await expect(page.locator('[name="internalNotes"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Time off", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save time off" })).toBeVisible();
    await expect(page.locator('[name="reason"]')).toHaveCount(0);

    await page.goto("/copenhagen/book?manage=1");
    await expect(page.getByRole("dialog")).toContainText("the email address used for the patient’s booking");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Initial physiotherapy assessment/ }).click();
    await expect(page.getByText("We’ll assign an available practitioner")).toBeVisible();

    await page.goto("/nordic/book?manage=1");
    await expect(page.getByRole("dialog")).toContainText("the email address you used when booking");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Studio session/ }).click();
    await expect(page.getByText("We’ll assign an available staff member")).toBeVisible();
  } finally {
    try {
      if (previous) await db`
        INSERT INTO tenant_terminology (tenant_id, client_term, staff_term) VALUES (${workspace.id}, ${previous.clientTerm}, ${previous.staffTerm})
        ON CONFLICT (tenant_id) DO UPDATE SET client_term = EXCLUDED.client_term, staff_term = EXCLUDED.staff_term`;
      else await db`DELETE FROM tenant_terminology WHERE tenant_id = ${workspace.id}`;
    } finally {
      await db.end();
    }
  }
});
