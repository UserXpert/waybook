import { expect, test } from "@playwright/test";

function localDayAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  const day = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function localWeekdayAfter(days: number) {
  const day = new Date(`${localDayAfter(days)}T12:00:00Z`);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

test("confirmation rejects malformed embed context without blocking direct bookings", async ({ request }) => {
  // A nonexistent hold exercises the route without creating a booking. A
  // direct request reaches normal hold validation; malformed contexts do not.
  const base = {
    holdId: "00000000-0000-4000-8000-000000000000",
    idempotencyKey: "embed-context-route-check",
    customer: { name: "Route verifier", email: "route-verifier@example.test" },
  };
  const direct = await request.post("/nordic/api/public/confirmations", { data: base });
  expect(direct.status()).toBe(409);
  expect(await direct.json()).toEqual({ error: "This hold is no longer available." });

  for (const context of [
    { embedSource: null, embedToken: null },
    { embedSource: 42, embedToken: false },
    { embedSource: {}, embedToken: [] },
    { embedSource: "", embedToken: "" },
    { embedSource: "https://example.test" },
    { embedToken: "invalid" },
  ]) {
    const response = await request.post("/nordic/api/public/confirmations", { data: { ...base, ...context } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("embedded booking session") });
  }
});

test("customer books, reschedules and cancels without a stale confirmation", async ({ page }) => {
  test.setTimeout(120_000);
  const check = expect.configure({ timeout: 30_000 });
  const runId = `${Date.now()}-${test.info().retry}`;
  const customerName = `Waybook E2E customer ${runId}`;
  const customerEmail = `waybook-e2e-${runId}@example.test`;
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: /Studio session/ }).click();
  await page.getByRole("button", { name: "Next dates" }).click();
  const publicSlots = page.locator(".tenant-time-grid button");
  await check(publicSlots.first()).toBeVisible();
  await publicSlots.first().click();
  await page.getByLabel("Name", { exact: true }).fill(customerName);
  await page.getByLabel("Email", { exact: true }).fill(customerEmail);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await check(page.getByText("BOOKING CONFIRMED")).toBeVisible();
  const summary = await page.locator(".tenant-complete-stage").innerText();
  const number = summary.match(/Booking number:\s*([A-Z0-9]+)/)?.[1];
  check(number).toBeTruthy();

  // Management credentials are tenant scoped. A valid Nordic reference must
  // remain usable in Nordic, but cannot reveal the same booking through a
  // different public tenant route.
  const managementRequest = {
    headers: { Origin: new URL(page.url()).origin },
    data: { action: "lookup", bookingId: number!, email: customerEmail },
  };
  const ownLookup = await page.request.post("/nordic/api/public/manage", managementRequest);
  expect(ownLookup.status()).toBe(200);
  expect(await ownLookup.json()).toMatchObject({ booking: { service: "Studio session" } });
  // The Control domain registry assigns the same-origin route `copenhagen`
  // to the Copenhagen Physio tenant (`copenhagen.localhost`).  Its product
  // slug is deliberately not trusted as a path prefix.
  const otherPublicBookingPage = await page.request.get("/copenhagen/book");
  expect(otherPublicBookingPage.status()).toBe(200);
  const crossTenantLookup = await page.request.post("/copenhagen/api/public/manage", managementRequest);
  expect(crossTenantLookup.status()).toBe(404);
  expect(await crossTenantLookup.json()).toEqual({ error: "We couldn’t find a booking with those details." });

  async function findBooking() {
    await page.getByRole("button", { name: "Manage booking" }).click();
    await page.getByLabel("Booking number").fill(number!);
    await page.getByLabel("Email address").fill(customerEmail);
    await page.getByRole("button", { name: "Find booking" }).click();
    await check(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
  }
  await findBooking();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  const rescheduleDay = localWeekdayAfter(8);
  await page.getByLabel("Day").fill(rescheduleDay);
  const rescheduleSlots = page.locator(".booking-manage-times button");
  await check(rescheduleSlots.first()).toBeVisible();
  await rescheduleSlots.first().click();
  await page.getByRole("button", { name: "Confirm new time" }).click();
  await check(page.getByText("Your booking has been rescheduled.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await check(page.getByRole("button", { name: /Studio session/ })).toBeVisible();
  await check(page.getByText("BOOKING CONFIRMED")).toHaveCount(0);

  const calendar = await page.context().newPage();
  await calendar.goto("/login");
  await calendar.getByLabel("Work email").fill("owner@nordic.local");
  await calendar.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await calendar.getByRole("button", { name: "Sign in" }).click();
  await check(calendar).toHaveURL(/\/nordic\/app/);
  await calendar.goto(`/nordic/app/calendars?day=${rescheduleDay}`);
  await check(calendar.getByText(customerName, { exact: true })).toBeVisible();
  const bookingDay = rescheduleDay;
  await calendar.goto(`/nordic/app/calendars?view=month&day=${bookingDay}`);
  const monthDay = calendar.locator(`a.waybook-month-calendar__day-link[href*="day=${bookingDay}"]`);
  const monthCell = monthDay.locator("..");
  await check(monthCell).toContainText(/booking/);
  await check(monthCell.locator(".waybook-month-calendar__appointment").filter({ hasText: customerName })).toBeVisible();

  await findBooking();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await check(page.getByText("Your booking has been cancelled.")).toBeVisible();
  await calendar.reload();
  await check(calendar.getByText(customerName, { exact: true })).toHaveCount(0);
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

async function chooseCalendarDate(page: import("@playwright/test").Page, value: string) {
  const picker = page.getByRole("dialog", { name: "Choose calendar date" });
  const target = new Date(`${value}T12:00:00Z`);
  await picker.getByLabel("Year", { exact: true }).selectOption(String(target.getUTCFullYear()));
  await picker.getByLabel("Month", { exact: true }).selectOption(String(target.getUTCMonth()));
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(target);
  await picker.getByRole("button", { name: label, exact: true }).click();
}

test("calendar date picker keeps an implicitly selected location", async ({ page }) => {
  const check = expect.configure({ timeout: 30_000 });
  const chosenDate = localDayAfter(26);
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await check(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/calendars?view=month");
  expect(new URL(page.url()).searchParams.has("location")).toBe(false);
  const context = page.locator(".waybook-month-calendar .waybook-calendar-toolbar > div").first().locator("span");
  const initiallySelectedLocation = await context.innerText();

  await page.locator(".calendar-date-picker > button").click();
  await chooseCalendarDate(page, chosenDate);
  await check(page).toHaveURL(new RegExp(`day=${chosenDate}`));
  expect(new URL(page.url()).searchParams.has("location")).toBe(true);
  await check(context).toHaveText(initiallySelectedLocation);
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
  await page.locator(".calendar-date-picker > button").click();
  await chooseCalendarDate(page, monthDay);
  await check(page).toHaveURL(new RegExp(`day=${monthDay}`));

  const day = page.locator(`a.waybook-month-calendar__day-link[href*="day=${monthDay}"]`);
  const dayCell = day.locator("..");
  await check(dayCell).toContainText("3 bookings");
  await check(dayCell.locator(".waybook-month-calendar__appointment")).toHaveCount(3);
  const dayView = page.getByRole("link", { name: "Day", exact: true });
  expect(await dayView.getAttribute("href")).not.toContain("employee=");
  await dayView.click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await check(page.locator(".team-day-calendar")).toBeVisible();
  expect(await page.getByRole("link", { name: "Week", exact: true }).count()).toBe(0);
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await check(page.locator(".waybook-month-calendar")).toBeVisible();
  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);
  await day.focus();
  await page.keyboard.press("Enter");
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await check(page).toHaveURL(new RegExp(`view=team.*day=${monthDay}`));
  await check(page.locator(".team-day-calendar")).toBeVisible();

  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);
  await page.getByLabel("Next month").click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await page.getByLabel("Previous month").click();
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Staff").fill("Z E2E roster 21");
  await page.getByRole("option", { name: "Z E2E roster 21" }).click();
  await check(page).toHaveURL(/employee=/);
  expect(await page.getByRole("link", { name: "Day", exact: true }).count()).toBe(0);
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await check(page).toHaveURL(/view=staff/);
  await check(page.getByRole("heading", { name: "Z E2E roster 21", exact: true })).toBeVisible();
  await check(page.locator(".waybook-week-calendar")).toBeVisible();
  await page.getByRole("link", { name: "Month", exact: true }).click();
  const scopedDay = page.locator(`a.waybook-month-calendar__day-link[href*="day=${monthDay}"]`).locator("..");
  await check(scopedDay).toContainText("1 booking");
  await check(scopedDay.locator(".waybook-month-calendar__appointment")).toContainText("Monthly calendar 15");
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
