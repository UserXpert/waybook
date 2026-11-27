import { expect, test } from "@playwright/test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

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
