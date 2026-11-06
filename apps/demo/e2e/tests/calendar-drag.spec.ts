import { expect, test } from "@playwright/test";

test("calendar drag highlights only approved destinations and persists an eligible move", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@nordic.local");
  await page.getByLabel("Password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/nordic\/app$/);
  await page.goto("/nordic/app/calendars?view=team&day=2026-11-09");
  await expect(page.locator("[data-availability-state='appointment-overlap']").first()).toBeVisible();
  const formerlyUnavailable = page.locator("[data-availability-state='unavailable'][data-calendar-drop-cell='true']").first();
  await expect(formerlyUnavailable).toBeVisible();

  const booking = page.locator("a.waybook-week-calendar__entry.is-booking").first();
  const bookingHref = await booking.getAttribute("href");
  expect(bookingHref).toBeTruthy();
  const bookingId = new URL(bookingHref!, "http://localhost").searchParams.get("booking");
  expect(bookingId).toBeTruthy();
  const sourceBox = await booking.boundingBox();
  expect(sourceBox).toBeTruthy();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 8, sourceBox!.y + sourceBox!.height / 2 + 8);
  await expect(page.locator(".calendar-drag-feedback")).toContainText("verified destination");
  await expect(formerlyUnavailable).toHaveClass(/is-drop-eligible/);

  const eligible = page.locator("[data-calendar-drop-cell='true'].is-drop-eligible").first();
  await expect(eligible).toBeVisible();
  await expect(page.locator("[data-calendar-drop-cell='true'].is-drop-incompatible")).toHaveCount(0);
  const destinationBox = await eligible.boundingBox();
  expect(destinationBox).toBeTruthy();
  await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + destinationBox!.height / 2);
  await page.mouse.up();

  await expect(page.locator(".calendar-drag-feedback")).toContainText("Appointment moved.");
  await page.reload();
  await expect(page.locator(`a.waybook-week-calendar__entry.is-booking[href*="booking=${bookingId}"]`)).toBeVisible();
});

test("completed appointments do not expose schedule-changing controls", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@nordic.local");
  await page.getByLabel("Password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/nordic\/app$/);

  await page.goto(
    "/nordic/app/calendars?view=team&day=2026-11-06&booking=5ff3cac0-0ab4-4f4d-81d3-30e25f0a61c5",
  );
  await expect(page.getByText("COMPLETED APPOINTMENT")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reschedule appointment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
});

test("team day navigation skips location non-working days", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@nordic.local");
  await page.getByLabel("Password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/nordic\/app$/);

  await page.goto("/nordic/app/calendars?view=team&day=2026-11-06");
  await expect(page.getByRole("link", { name: "Next day" })).toHaveAttribute(
    "href",
    /day=2026-11-09/,
  );
  await page.getByRole("link", { name: "Next day" }).click();
  await expect(page.getByRole("heading", { name: "Mon 9 Nov" })).toBeVisible();
});
