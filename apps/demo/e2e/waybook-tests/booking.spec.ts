import { expect, test } from "@playwright/test";

function localDayAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  const day = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

test("customer books, reschedules and cancels without a stale confirmation", async ({ page }) => {
  test.setTimeout(120_000);
  const check = expect.configure({ timeout: 30_000 });
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: /Studio session/ }).click();
  await page.getByRole("button", { name: "Next dates" }).click();
  await page.getByRole("button", { name: "09:00", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Waybook E2E customer");
  await page.getByLabel("Email", { exact: true }).fill("waybook-e2e@example.test");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await check(page.getByText("BOOKING CONFIRMED")).toBeVisible();
  const summary = await page.locator(".tenant-complete-stage").innerText();
  const number = summary.match(/Booking number:\s*([A-Z0-9]+)/)?.[1];
  check(number).toBeTruthy();

  async function findBooking() {
    await page.getByRole("button", { name: "Manage booking" }).click();
    await page.getByLabel("Booking number").fill(number!);
    await page.getByLabel("Email address").fill("waybook-e2e@example.test");
    await page.getByRole("button", { name: "Find booking" }).click();
    await check(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
  }
  await findBooking();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  await page.getByLabel("Day").fill(localDayAfter(8));
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await page.getByRole("button", { name: "Confirm new time" }).click();
  await check(page.getByText("Your booking has been rescheduled.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await check(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  await check(page.getByText("BOOKING CONFIRMED")).toHaveCount(0);

  const calendar = await page.context().newPage();
  await calendar.goto("/login");
  await calendar.getByLabel("Work email").fill("owner@nordic.local");
  await calendar.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await calendar.getByRole("button", { name: "Sign in" }).click();
  await check(calendar).toHaveURL(/\/nordic\/app/);
  await calendar.goto(`/nordic/app/calendars?day=${localDayAfter(8)}`);
  await check(calendar.getByText("Waybook E2E customer", { exact: true })).toBeVisible();
  const bookingDay = localDayAfter(8);
  await calendar.goto(`/nordic/app/calendars?view=month&day=${bookingDay}`);
  const monthDay = calendar.locator(`a.waybook-month-calendar__day[href*="monthDay=${bookingDay}"]`);
  await check(monthDay).toContainText(/booking/);
  await monthDay.click();
  await check(calendar.getByText("DAY DETAILS", { exact: true })).toBeVisible();
  await check(calendar.getByText("Waybook E2E customer", { exact: true })).toBeVisible();

  await findBooking();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await check(page.getByText("Your booking has been cancelled.")).toBeVisible();
  await calendar.reload();
  await check(calendar.getByText("Waybook E2E customer", { exact: true })).toHaveCount(0);
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

test("monthly calendar keeps all-staff scope and shows every booking for a day", async ({ page }) => {
  const check = expect.configure({ timeout: 30_000 });
  const monthDay = localDayAfter(10);
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await check(page).toHaveURL(/\/nordic\/app/);
  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);

  const day = page.locator(`a.waybook-month-calendar__day[href*="monthDay=${monthDay}"]`);
  await check(day).toContainText("2 bookings");
  await check(day).toHaveAttribute("aria-describedby", `month-preview-${monthDay}`);
  await day.click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await check(page.getByText("DAY DETAILS", { exact: true })).toBeVisible();
  await check(page.getByText("Monthly calendar 13", { exact: true })).toBeVisible();
  await check(page.getByText("Monthly calendar 14", { exact: true })).toBeVisible();

  await page.getByLabel("Next month").click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
});

test("changing the reschedule day ignores an older availability response", async ({ page }) => {
  let firstAvailabilityStarted!: () => void;
  const firstAvailability = new Promise<void>(resolve => { firstAvailabilityStarted = resolve; });
  let requests = 0;
  await page.route("**/nordic/api/public/manage", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "lookup") {
      await route.fulfill({ json: { booking: { service: "Studio session", location: "Preview location", startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), status: "confirmed", canChange: true, canCancel: true } } });
      return;
    }
    if (body.action === "availability") {
      const current = ++requests;
      if (current === 1) { firstAvailabilityStarted(); await new Promise(resolve => setTimeout(resolve, 1500)); }
      const day = current === 1 ? localDayAfter(0) : localDayAfter(2);
      const hour = current === 1 ? "09:00" : "14:00";
      const { fromZonedTime } = await import("date-fns-tz");
      const startTime = fromZonedTime(`${day}T${hour}:00`, "Europe/Copenhagen").toISOString();
      await route.fulfill({ json: { availability: [{ slots: [{ startTime, endTime: new Date(new Date(startTime).getTime() + 3600000).toISOString() }] }] } });
      return;
    }
    await route.abort();
  });
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: "Manage booking" }).click();
  await page.getByLabel("Booking number").fill("TEST123");
  await page.getByLabel("Email address").fill("preview@example.invalid");
  await page.getByRole("button", { name: "Find booking" }).click();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  await firstAvailability;
  await page.getByLabel("Day").fill(localDayAfter(2));
  await expect(page.getByRole("button", { name: "14:00", exact: true })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByRole("button", { name: "14:00", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "09:00", exact: true })).toHaveCount(0);
});
