import { expect, test } from "@playwright/test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { randomUUID } from "node:crypto";

test("alternate calendar time zone preserves the exact booking instant across midnight", async ({ page }, testInfo) => {
  const workspaceTimezone = "Europe/Copenhagen";
  const calendarTimezone = "Pacific/Honolulu";
  const calendar = "/nordic/app/calendars?view=team";
  const settings = "/nordic/app/settings?tab=calendar";
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);

  const upcoming = new Date(Date.now() + (testInfo.project.name === "mobile" ? 14 : 7) * 86_400_000);
  upcoming.setUTCHours(12, 0, 0, 0);
  upcoming.setUTCDate(upcoming.getUTCDate() + ((8 - upcoming.getUTCDay()) % 7));
  const workspaceDate = formatInTimeZone(upcoming, workspaceTimezone, "yyyy-MM-dd");
  await page.goto(`${calendar}&day=${workspaceDate}`);
  const workspaceSlot = page.locator(".team-day-calendar__grid a[data-calendar-starts-at$='T09:00']").first();
  await expect(workspaceSlot).toBeVisible();
  const workspaceTime = await workspaceSlot.getAttribute("data-calendar-starts-at");
  const provider = await workspaceSlot.getAttribute("data-calendar-team-member-id");
  const date = fromZonedTime(workspaceTime!, workspaceTimezone);
  const displayDate = formatInTimeZone(date, calendarTimezone, "yyyy-MM-dd");
  const displayTime = formatInTimeZone(date, calendarTimezone, "HH:mm");
  expect(displayDate).not.toBe(workspaceDate);

  await page.goto(settings);
  const timezone = page.getByRole("combobox", { name: "Calendar time zone", exact: true });
  await expect(timezone).toHaveValue("");
  await timezone.selectOption(calendarTimezone);
  await page.getByRole("button", { name: "Save calendar preferences" }).click();
  await expect(page.getByText("Calendar preferences saved.", { exact: true })).toBeVisible();
  await page.goto(`${calendar}&day=${displayDate}`);
  const displaySlot = page.locator(`.team-day-calendar__grid a[data-calendar-starts-at="${workspaceTime}"][data-calendar-team-member-id="${provider}"]`);
  await expect(displaySlot).toHaveAccessibleName(new RegExp(`${displayDate} ${displayTime}$`));
  await displaySlot.press("Enter");
  const drawer = page.getByRole("complementary", { name: "New appointment" });
  const summary = drawer.getByRole("region", { name: "Selected calendar slot" });
  await expect(summary).toContainText(displayTime);
  await expect(summary).toContainText(calendarTimezone);
  const tag = randomUUID().slice(0, 8);
  const clientName = `Time zone QA ${tag}`;
  await drawer.getByRole("combobox", { name: /^Find a / }).fill(clientName);
  await drawer.getByRole("option", { name: /^Add .* “Time zone QA/ }).click();
  await drawer.getByLabel("Email", { exact: true }).fill(`timezone-${tag}@example.test`);
  await drawer.getByLabel("Phone", { exact: true }).fill("+4512345678");
  await drawer.getByRole("button", { name: "Confirm appointment" }).click();
  const calendarRequests = "**/nordic/app/calendars**";
  let availabilityRequests = 0;
  await page.route(calendarRequests, async (route) => {
    const request = route.request();
    if (request.headers()["next-action"] && request.postData()?.includes('"startDate"')) {
      availabilityRequests += 1;
      if (availabilityRequests === 1) return route.abort("failed");
    }
    await route.continue();
  });
  await drawer.getByRole("link", { name: "View appointment" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("day") === displayDate && Boolean(url.searchParams.get("booking")));
  await expect(page.getByRole("region", { name: "Schedule", exact: true })).toContainText(displayTime);
  await page.getByRole("button", { name: "Edit appointment" }).click();
  await expect(page.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule appointment" })).toHaveCount(0);
  expect(availabilityRequests).toBe(0);
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(page.getByText(`Choose a time in ${workspaceTimezone}.`, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Could not load availability." })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".appointment-reschedule-picker__day").first()).toBeVisible();
  expect(availabilityRequests).toBe(2);
  await page.unroute(calendarRequests);
  await page.goto(`/nordic/app/calendars?view=staff&day=${displayDate}&employee=${provider}`);
  await expect(page.locator(".staff-week-calendar__grid .is-booking").filter({ hasText: clientName })).toContainText(displayTime);
  await page.goto(`/nordic/app/calendars?view=month&day=${displayDate}`);
  const monthDay = page.locator(`.waybook-month-calendar__day-link[href*="day=${displayDate}"]`).locator("..");
  await expect(monthDay.locator(".waybook-month-calendar__appointment").filter({ hasText: clientName })).toContainText(displayTime);

  await page.goto(settings);
  await expect(timezone).toHaveValue(calendarTimezone);
  await timezone.selectOption("");
  await page.getByRole("button", { name: "Save calendar preferences" }).click();
  await expect(page.getByText("Calendar preferences saved.", { exact: true })).toBeVisible();
  await page.goto(`${calendar}&day=${workspaceDate}`);
  const booking = page.locator(".team-day-calendar__grid .is-booking").filter({ hasText: clientName });
  await expect(booking).toContainText("09:00");
  await booking.click();
  await page.getByRole("button", { name: "More appointment actions" }).click();
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Cancel this appointment?" })
    .getByRole("button", { name: "Cancel appointment" }).click();
  await expect(page.getByText("This appointment has been cancelled.", { exact: false })).toBeVisible();
  await page.goto(`${calendar}&day=${workspaceDate}`);
  await expect(booking).toHaveCount(0);
});

test("holiday preferences add labels to Day, Week and Month", async ({ page }) => {
  const christmas = `${formatInTimeZone(new Date(), "Europe/Copenhagen", "yyyy")}-12-25`;
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);

  const calendar = `/nordic/app/calendars?view=team&day=${christmas}`;
  const settings = "/nordic/app/settings?tab=calendar";
  const holiday = page.getByText("Christmas Day", { exact: true });
  await page.goto(calendar);
  await expect(holiday).toHaveCount(0);
  await page.goto(settings);
  const region = page.getByRole("combobox", { name: "Public holidays", exact: true });
  await expect(region).toHaveValue("");
  await region.selectOption("DK");
  const save = page.getByRole("button", { name: "Save calendar preferences" });
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Calendar preferences saved." })).toBeVisible();

  await page.goto(calendar);
  await expect(holiday).toBeVisible();
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page.locator(".waybook-week-calendar__day").getByText("Christmas Day", { exact: true })).toBeVisible();
  await page.goto(`/nordic/app/calendars?view=month&day=${christmas}`);
  await expect(page.getByRole("link", { name: /Christmas Day.*Open day view/ })).toBeVisible();

  await page.goto(settings);
  await expect(region).toHaveValue("DK");
  await region.selectOption("");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Calendar preferences saved." })).toBeVisible();
  await page.goto(calendar);
  await expect(holiday).toHaveCount(0);
});

test("calendar settings persist and change visible hours, grid density and the current-time marker", async ({ page }) => {
  const timezone = "Europe/Copenhagen";
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  await page.clock.setFixedTime(fromZonedTime(`${today}T15:17`, timezone));
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);

  const settings = "/nordic/app/settings?tab=calendar";
  await page.goto(settings);
  const interval = page.getByLabel("Calendar interval");
  await expect(interval).toHaveValue("15");
  await page.getByLabel("Show from").selectOption("7");
  await page.getByLabel("Show until").selectOption("22");
  await page.getByRole("button", { name: "Save calendar preferences" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Calendar preferences saved." })).toBeVisible();

  const calendar = `/nordic/app/calendars?day=${today}`;
  const grid = page.locator(".team-day-calendar__grid");
  const timeHeaders = grid.locator(".team-day-calendar__time-header");
  await page.goto(calendar);
  await expect(grid.getByRole("img", { name: "Current time 15:17" })).toBeVisible();
  await expect(timeHeaders.first()).toHaveText("07:00");
  await expect(timeHeaders).toHaveCount(60);

  await page.goto(settings);
  await expect(page.getByLabel("Show from")).toHaveValue("7");
  await interval.selectOption("30");
  await page.getByRole("checkbox", { name: "Show current time" }).uncheck();
  await page.getByRole("checkbox", { name: /^Show weekends/ }).uncheck();
  await page.getByRole("button", { name: "Save calendar preferences" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Calendar preferences saved." })).toBeVisible();
  await page.goto(calendar);
  await expect(timeHeaders).toHaveCount(30);
  await expect(grid.getByRole("img", { name: /^Current time/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page.locator(".waybook-month-calendar__weekday")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri"]);
});

test("Today and view switches preserve calendar scope", async ({ page }) => {
  const timezone = "Europe/Copenhagen";
  const instant = new Date();
  const today = formatInTimeZone(instant, timezone, "yyyy-MM-dd");
  const earlier = formatInTimeZone(new Date(+instant - 40 * 86_400_000), timezone, "yyyy-MM-dd");
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);

  await page.goto(`/nordic/app/calendars?day=${earlier}`);
  const staffWeek = page.getByRole("link", { name: /^View week for / }).first();
  const windowUrl = new URL((await staffWeek.getAttribute("href"))!, page.url());
  const location = windowUrl.searchParams.get("location")!;
  const catalogue = await page.request.get("/nordic/api/app/services", { params: { locationId: location, limit: 1 } });
  expect(catalogue.ok()).toBeTruthy();
  const { items: [service] } = await catalogue.json();
  const scope = new URLSearchParams({ location, service: service.id, day: earlier });
  await page.goto(`/nordic/app/calendars?${scope}`);

  const range = page.locator(".calendar-view-toggle");
  const todayLink = page.getByRole("link", { name: "Today", exact: true });
  await expect(range.getByRole("link")).toHaveText(["Day", "Week", "Month"]);
  await expect(range.getByRole("link", { name: "Day" })).toHaveAttribute("aria-current", "page");
  await expect(todayLink).not.toHaveAttribute("aria-current", "date");
  const groupBounds = await range.boundingBox();
  const todayBounds = await todayLink.boundingBox();
  expect(groupBounds && todayBounds && (
    groupBounds.x + groupBounds.width <= todayBounds.x || groupBounds.y + groupBounds.height <= todayBounds.y
  )).toBeTruthy();
  await todayLink.click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("view") === "team" && !url.searchParams.has("employee") &&
    url.searchParams.get("location") === location && url.searchParams.get("service") === service.id &&
    url.searchParams.get("day") === today);
  await page.goto(`/nordic/app/calendars?${scope}`);
  await range.getByRole("link", { name: "Week" }).click();
  await expect(range.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
  await range.getByRole("link", { name: "Day" }).click();
  await expect(range.getByRole("link", { name: "Day" })).toHaveAttribute("aria-current", "page");

  const staff = new URL((await staffWeek.getAttribute("href"))!, page.url()).searchParams.get("employee");
  expect(staff).toBeTruthy();
  await staffWeek.click();
  await expect(range.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
  await todayLink.click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("view") === "staff" && url.searchParams.get("employee") === staff &&
    url.searchParams.get("location") === location && url.searchParams.get("service") === service.id &&
    url.searchParams.get("day") === today);
  await expect(todayLink).toHaveAttribute("aria-current", "date");

  await range.getByRole("link", { name: "Month" }).click();
  await page.getByRole("link", { name: "Previous month" }).click();
  await todayLink.click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("view") === "month" && url.searchParams.get("employee") === staff &&
    url.searchParams.get("location") === location && url.searchParams.get("service") === service.id &&
    url.searchParams.get("day") === today);
  await expect(range.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
});
