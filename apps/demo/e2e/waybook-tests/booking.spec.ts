import { expect, test } from "@playwright/test";

function localDayAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  const day = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

test("customer books, reschedules and cancels without a stale confirmation", async ({ page }) => {
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: /Studio session/ }).click();
  await page.getByRole("button", { name: "Next dates" }).click();
  await page.getByRole("button", { name: "09:00", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Waybook E2E customer");
  await page.getByLabel("Email", { exact: true }).fill("waybook-e2e@example.test");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("BOOKING CONFIRMED")).toBeVisible();
  const summary = await page.locator(".tenant-complete-stage").innerText();
  const number = summary.match(/Booking number:\s*([A-Z0-9]+)/)?.[1];
  expect(number).toBeTruthy();

  async function findBooking() {
    await page.getByRole("button", { name: "Manage booking" }).click();
    await page.getByLabel("Booking number").fill(number!);
    await page.getByLabel("Email address").fill("waybook-e2e@example.test");
    await page.getByRole("button", { name: "Find booking" }).click();
    await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
  }
  await findBooking();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  await page.getByLabel("Day").fill(localDayAfter(8));
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await page.getByRole("button", { name: "Confirm new time" }).click();
  await expect(page.getByText("Your booking has been rescheduled.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  await expect(page.getByText("BOOKING CONFIRMED")).toHaveCount(0);

  const calendar = await page.context().newPage();
  await calendar.goto("/login");
  await calendar.getByLabel("Work email").fill("owner@nordic.local");
  await calendar.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await calendar.getByRole("button", { name: "Sign in" }).click();
  await expect(calendar).toHaveURL(/\/nordic\/app/);
  await calendar.goto(`/nordic/app/calendars?day=${localDayAfter(8)}`);
  await expect(calendar.getByText("Waybook E2E customer", { exact: true })).toBeVisible();

  await findBooking();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByText("Your booking has been cancelled.")).toBeVisible();
  await calendar.reload();
  await expect(calendar.getByText("Waybook E2E customer", { exact: true })).toHaveCount(0);
  await calendar.close();
});

test("tenant owner can sign in but cannot access another workspace", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  const own = await page.request.get("/nordic/api/app/clients");
  const other = await page.request.get("/copenhagen/api/app/clients");
  expect(own.status()).toBe(200);
  expect(other.status()).toBe(404);
});
