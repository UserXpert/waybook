import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

for (const workspace of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) {
  test(`split location hours and closures control booking availability in ${workspace.route}`, async ({ page, request }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const tag = randomUUID().slice(0, 8);
    let locationId: string | undefined;
    let serviceId: string | undefined;
    let memberId: string | undefined;
    try {
      const [settings] = await db<{ tenant_id: string; timezone: string; day: string; weekday: number }[]>`
        SELECT tenant_id, timezone, day::text, extract(dow FROM day)::int AS weekday
        FROM (SELECT tenant_id, timezone, ((now() AT TIME ZONE timezone)::date + 3) AS day FROM tenant_settings) s
      `;
      const { tenant_id: tenantId, timezone, day, weekday } = settings;
      const dayLabel = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
      [{ id: locationId }] = await db<{ id: string }[]>`
        INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${tenantId},${tag},${`QA location ${tag}`},${timezone}) RETURNING id`;
      [{ id: serviceId }] = await db<{ id: string }[]>`
        INSERT INTO services (tenant_id,slug,title,duration_minutes) VALUES (${tenantId},${tag},${`QA service ${tag}`},30) RETURNING id`;
      [{ id: memberId }] = await db<{ id: string }[]>`
        INSERT INTO team_members (tenant_id,name,email,role) VALUES (${tenantId},${`QA staff ${tag}`},${`hours-${tag}@example.test`},'staff') RETURNING id`;
      await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time) VALUES (${tenantId},${locationId},${weekday},'09:00','11:00')`;
      await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${serviceId},${locationId})`;
      await db`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${memberId},${locationId})`;
      await db`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${serviceId},${memberId})`;
      await db`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
        VALUES (${tenantId},${memberId},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','08:00','17:00',${timezone})`;

      const at = (time: string) => fromZonedTime(`${day}T${time}:00`, timezone).toISOString();
      const slots = async () => {
        const response = await request.get(`/${workspace.route}/api/public/availability`, {
          params: { service: serviceId!, location: locationId!, start: at("08:00"), end: at("17:00") },
        });
        expect(response.status()).toBe(200);
        const result: { availability: { slots: { startTime: string }[] }[] } = await response.json();
        return result.availability.flatMap(({ slots }) => slots.map(({ startTime }) => startTime));
      };

      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${workspace.route}/app$`));
      await page.goto(`/${workspace.route}/app/locations?location=${locationId}`);
      const editor = page.getByRole("complementary", { name: "Edit location" });
      const period = editor.locator(".location-hours-editor__day").filter({ hasText: dayLabel });
      const starts = period.getByRole("slider", { name: /opening hours starts/ });
      const ends = period.getByRole("slider", { name: /opening hours ends/ });
      const save = editor.getByRole("button", { name: "Save location" });
      const locationName = editor.getByLabel("Location name");
      const updatedName = `QA split hours ${tag}`;
      await locationName.fill(updatedName);
      await period.getByRole("button", { name: "+ Add range", exact: true }).click();
      await starts.nth(1).press("ArrowLeft");
      await save.click();
      await expect(editor.getByRole("alert")).toHaveText("Opening periods on the same day cannot overlap.");
      await expect(starts.nth(1)).toHaveAttribute("aria-valuetext", "10:30");
      await expect(locationName).toHaveValue(updatedName);
      expect(await db`SELECT name FROM locations WHERE id=${locationId}`).toEqual([{ name: `QA location ${tag}` }]);
      expect(await slots()).toContain(at("10:30"));
      expect(await slots()).not.toContain(at("11:30"));

      await ends.first().press("Home");
      await expect(ends.first()).toHaveAttribute("aria-valuetext", /^0?9:30$/);
      await ends.first().press("ArrowRight");
      await starts.nth(1).press("ArrowRight");
      await starts.nth(1).press("ArrowRight");
      await ends.nth(1).press("ArrowRight");
      await ends.nth(1).press("ArrowRight");
      await save.click();
      await expect(page.getByText("Location saved.", { exact: true })).toBeVisible();
      const split = await slots();
      expect(split).toEqual(expect.arrayContaining(["09:00", "09:30", "11:30", "12:30"].map(at)));
      for (const time of ["08:30", "09:45", "10:00", "11:15", "12:45", "13:00"]) expect(split).not.toContain(at(time));
      expect(await db`SELECT name FROM locations WHERE id=${locationId}`).toEqual([{ name: updatedName }]);

      const calendar = await page.context().newPage();
      const booking = await page.context().newPage();
      const checkBookingViews = async (open: boolean) => {
        const calendarQuery = new URLSearchParams({ view: "team", day, location: locationId!, service: serviceId! });
        const bookingQuery = new URLSearchParams({ location: locationId!, service: serviceId! });
        await Promise.all([
          calendar.goto(`/${workspace.route}/app/calendars?${calendarQuery}`),
          booking.goto(`/${workspace.route}/book?${bookingQuery}`),
        ]);
        const calendarSlot = (time: string) => calendar.getByRole("link", { name: `New appointment QA staff ${tag} ${day} ${time}`, exact: true });
        await expect(calendarSlot("11:30")).toHaveCount(open ? 1 : 0);
        await expect(calendarSlot("10:00")).toHaveCount(0);

        const dateButton = booking.locator(".tenant-day-list").getByRole("button", {
          name: new RegExp(`^${dayLabel.slice(0, 3)}\\s*${day.slice(-2)}$`),
        });
        await dateButton.click();
        await expect(dateButton).toHaveAttribute("aria-pressed", "true");
        const timeGrid = booking.locator(".tenant-time-grid");
        if (open) await expect(timeGrid.getByRole("button", { name: "11:30", exact: true })).toBeVisible();
        else await expect(booking.getByRole("status").filter({ hasText: "No times are available on this date." })).toBeVisible();
        await expect(timeGrid.getByRole("button", { name: "10:00", exact: true })).toHaveCount(0);
      };
      await checkBookingViews(true);

      const closed = editor.locator(".location-closed-dates");
      await closed.getByLabel("Date", { exact: true }).fill(day);
      await closed.getByLabel("Reason", { exact: true }).fill("Synthetic closed date");
      await closed.getByRole("button", { name: "Add closed date" }).click();
      await expect(page.getByText("Closed date saved.", { exact: true })).toBeVisible();
      expect(await slots()).toEqual([]);
      await checkBookingViews(false);
      await closed.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByText("Closed date removed.", { exact: true })).toBeVisible();
      expect(await slots()).toEqual(split);
      await checkBookingViews(true);

      await period.getByRole("button", { name: `Remove ${dayLabel} range 1` }).click();
      await period.getByRole("button", { name: `Remove ${dayLabel} range 1` }).click();
      await save.click();
      await expect(page.getByText("Location saved.", { exact: true })).toBeVisible();
      await page.reload();
      await expect(editor.getByRole("slider")).toHaveCount(0);
      expect(await slots()).toEqual([]);
    } finally {
      try {
        if (serviceId) await db`DELETE FROM services WHERE id=${serviceId}`;
        if (memberId) await db`DELETE FROM team_members WHERE id=${memberId}`;
        if (locationId) await db`DELETE FROM locations WHERE id=${locationId}`;
      } finally {
        await db.end();
      }
    }
  });
}
