import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

for (const workspace of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`staff schedules and assignments control available slots in ${workspace.route}`, async ({ page, browser, baseURL, ignoreHTTPSErrors, request }) => {
  const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
  const guest = await browser.newContext({ baseURL, ignoreHTTPSErrors, viewport: page.viewportSize(), timezoneId: "Europe/Copenhagen" });
  const tag = randomUUID().slice(0, 8);
  let locationId: string | undefined;
  let secondLocationId: string | undefined;
  let serviceId: string | undefined;
  let staffId: string | undefined;
  try {
    const [settings] = await db<{ tenant_id: string; timezone: string; partial: string; first: string; last: string; after: string }[]>`
      SELECT tenant_id, timezone,(today+3)::text AS partial,(today+4)::text AS first,(today+5)::text AS last,(today+6)::text AS after
      FROM (SELECT tenant_id,timezone,(now() AT TIME ZONE timezone)::date AS today FROM tenant_settings) s`;
    const { tenant_id: tenantId, timezone, partial, first, last, after } = settings;
    [{ id: locationId }] = await db<{ id: string }[]>`
      INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${tenantId},${tag},${`QA time-off location ${tag}`},${timezone}) RETURNING id`;
    [{ id: serviceId }] = await db<{ id: string }[]>`
      INSERT INTO services (tenant_id,slug,title,duration_minutes) VALUES (${tenantId},${tag},${`QA time-off service ${tag}`},30) RETURNING id`;
    [{ id: staffId }] = await db<{ id: string }[]>`
      INSERT INTO team_members (tenant_id,name,email,role) VALUES (${tenantId},${`QA time-off staff ${tag}`},${`time-off-${tag}@example.test`},'staff') RETURNING id`;
    await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
      SELECT ${tenantId},${locationId},day,'09:00','16:00' FROM generate_series(0,6) AS day`;
    await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${serviceId},${locationId})`;
    await db`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${staffId},${locationId})`;
    await db`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${serviceId},${staffId})`;
    await db`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
      VALUES (${tenantId},${staffId},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','16:00',${timezone})`;

    const at = (day: string, time: string) => fromZonedTime(`${day}T${time}:00`, timezone).toISOString();
    const slots = async (day: string, location = locationId!) => {
      const response = await request.get(`/${workspace.route}/api/public/availability`, {
        params: { service: serviceId!, location, start: at(day, "09:00"), end: at(day, "16:00") },
      });
      expect(response.status()).toBe(200);
      const payload: { availability: { slots: { startTime: string }[] }[] } = await response.json();
      return payload.availability.flatMap(({ slots }) => slots.map(({ startTime }) => startTime));
    };
    const expected = await slots(partial);
    expect(expected).toEqual(expect.arrayContaining(["10:00", "10:30", "12:00", "12:30"].map((time) => at(partial, time))));

    await page.goto("/login");
    await page.getByLabel("Work email").fill(workspace.owner);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const app = `/${workspace.route}/app`;
    await expect(page).toHaveURL((url) => url.pathname === app);
    const calendar = await page.context().newPage();
    const booking = await guest.newPage();
    const checkViews = async (day: string, checks: Record<string, boolean>, location = locationId!) => {
      const calendarQuery = new URLSearchParams({ view: "team", day, location, service: serviceId! });
      const bookingQuery = new URLSearchParams({ location, service: serviceId! });
      await Promise.all([
        calendar.goto(`${app}/calendars?${calendarQuery}`),
        booking.goto(`/${workspace.route}/book?${bookingQuery}`),
      ]);
      const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
      const date = booking.locator(".tenant-day-list").getByRole("button", { name: new RegExp(`^${weekday}\\s*${day.slice(-2)}$`) });
      await date.click();
      await expect(date).toHaveAttribute("aria-pressed", "true");
      if (!Object.values(checks).some(Boolean)) {
        await expect(booking.getByRole("status").filter({ hasText: "No times are available on this date." })).toBeVisible();
      }
      const grid = booking.locator(".tenant-time-grid");
      for (const [time, available] of Object.entries(checks)) {
        const slot = calendar.getByRole("link", { name: `New appointment QA time-off staff ${tag} ${day} ${time}`, exact: true });
        await expect(slot).toHaveCount(available ? 1 : 0);
        await expect(grid.getByRole("button", { name: time, exact: true })).toHaveCount(available ? 1 : 0);
      }
    };
    const timeOffPath = `${app}/team?employee=${staffId}&tab=time-off`;
    await checkViews(partial, { "10:30": true, "12:30": true });
    await page.goto(timeOffPath);
    const form = page.locator(".staff-timeoff-form");
    const choose = (day: string, dateForm = form) => {
      const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${day}T12:00:00Z`));
      return dateForm.getByRole("button", { name: new RegExp(`^(Choose|Selected) ${label}$`) }).click();
    };
    const fullDay = form.getByRole("switch", { name: /Full day/ });
    const save = form.getByRole("button", { name: "Save time off", exact: true });
    await choose(partial);
    await fullDay.click();
    const start = form.getByRole("slider", { name: /starts/i });
    const end = form.getByRole("slider", { name: /ends/i });
    for (let index = 0; index < 3; index++) await start.press("ArrowRight");
    for (let index = 0; index < 9; index++) await end.press("ArrowLeft");
    await expect(start).toHaveAttribute("aria-valuetext", "10:30");
    await expect(end).toHaveAttribute("aria-valuetext", "12:30");
    await save.click();
    await expect(page.getByText("Time off saved.", { exact: true })).toBeVisible();
    expect(await slots(partial)).toEqual(expected.filter((slot) => slot < at(partial, "10:30") || slot >= at(partial, "12:30")));
    await checkViews(partial, { "10:00": true, "10:30": false, "12:00": false, "12:30": true });

    await form.getByRole("button", { name: "Date range", exact: true }).click();
    await choose(first);
    await choose(last);
    if (await fullDay.getAttribute("aria-checked") === "false") await fullDay.click();
    await save.click();
    await expect.poll(async () => (await db`SELECT id FROM availability_overrides WHERE team_member_id=${staffId}`).length).toBe(3);
    expect(await slots(first)).toEqual([]);
    expect(await slots(last)).toEqual([]);
    expect(await slots(after)).toContain(at(after, "11:00"));
    await checkViews(first, { "11:00": false });

    await choose(last);
    await choose(after);
    await save.click();
    await expect(form.getByRole("alert")).toHaveText(/already have a time-off exception/i);
    await expect(form.locator('[name="localDate"]')).toHaveValue(last);
    await expect(form.locator('[name="endLocalDate"]')).toHaveValue(after);
    expect(await db`SELECT id FROM availability_overrides WHERE team_member_id=${staffId}`).toHaveLength(3);
    expect(await slots(after)).toContain(at(after, "11:00"));

    const [override] = await db<{ id: string }[]>`SELECT id FROM availability_overrides WHERE team_member_id=${staffId} AND local_date=${partial}`;
    await page.locator(`a[href*="editTimeOff=${override.id}"]`).click();
    const edit = form.getByRole("button", { name: "Save changes", exact: true });
    await expect(start).toHaveAttribute("aria-valuetext", "10:30");
    await expect(end).toHaveAttribute("aria-valuetext", "12:30");
    await choose(first);
    await edit.click();
    await expect(form.getByRole("alert")).toHaveText(/another time-off entry already exists/i);
    await expect(form.locator('[name="localDate"]')).toHaveValue(first);
    expect(await slots(partial)).toContain(at(partial, "12:30"));

    await choose(partial);
    await end.press("ArrowRight");
    await edit.click();
    await expect(page.getByText("Time off updated.", { exact: true })).toBeVisible();
    expect(await slots(partial)).not.toContain(at(partial, "12:30"));
    expect(await slots(partial)).toContain(at(partial, "13:00"));

    const remove = form.getByRole("button", { name: "Remove time off", exact: true });
    page.once("dialog", (dialog) => dialog.dismiss());
    await remove.click();
    expect(await slots(partial)).not.toContain(at(partial, "12:30"));
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(page.getByText("Time off removed.", { exact: true })).toBeVisible();
    expect(await slots(partial)).toEqual(expected);
    expect(await slots(first)).toEqual([]);
    await checkViews(partial, { "10:30": true, "12:00": true });

    const otherTab = await page.context().newPage();
    try {
      await Promise.all([page.goto(timeOffPath), otherTab.goto(timeOffPath)]);
      const otherForm = otherTab.locator(".staff-timeoff-form");
      await Promise.all([choose(partial), choose(partial, otherForm)]);
      const changes = () => db`SELECT id FROM availability_overrides WHERE team_member_id=${staffId} AND local_date=${partial}`;
      await Promise.all([save.click(), otherForm.getByRole("button", { name: "Save time off", exact: true }).click()]);
      await expect.poll(async () => {
        const warnings = await Promise.all([form, otherForm].map((entry) => entry.getByRole("alert").filter({ hasText: /already have a time-off exception/i }).count()));
        return warnings[0] + warnings[1];
      }).toBe(1);
      expect(await changes()).toHaveLength(1);
      expect(await slots(partial)).toEqual([]);
    } finally {
      await otherTab.close();
    }

    await test.step("recurring split shifts preserve the gap and reject overlaps", async () => {
      const weekday = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(`${after}T12:00:00Z`));
      await page.goto(`${app}/team?employee=${staffId}&tab=hours`);
      const shifts = page.getByRole("button", { name: `Edit ${weekday} shifts`, exact: true });
      await shifts.click();
      const editor = page.getByRole("dialog", { name: `Edit shifts for ${weekday}s`, exact: true });
      const addShift = editor.getByRole("button", { name: "+ Add a shift", exact: true });
      const saveShifts = editor.getByRole("button", { name: "Save changes", exact: true });
      const starts = editor.getByRole("slider", { name: /starts/i });
      const ends = editor.getByRole("slider", { name: /ends/i });
      await addShift.click();
      await starts.nth(1).press("ArrowLeft");
      await expect(editor.getByRole("alert")).toContainText("Shifts cannot overlap.");
      await expect(saveShifts).toBeDisabled();
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(shifts).toBeFocused();
      expect(await slots(after)).toContain(at(after, "12:00"));

      await shifts.click();
      await expect(starts).toHaveCount(1);
      for (let index = 0; index < 8; index++) await ends.nth(0).press("ArrowLeft");
      await expect(ends.nth(0)).toHaveAttribute("aria-valuetext", "12:00");
      await addShift.click();
      for (let index = 0; index < 4; index++) await ends.nth(1).press("ArrowRight");
      for (let index = 0; index < 2; index++) await starts.nth(1).press("ArrowRight");
      await expect(starts.nth(1)).toHaveAttribute("aria-valuetext", "13:00");
      await expect(ends.nth(1)).toHaveAttribute("aria-valuetext", "15:00");
      await saveShifts.click();
      await expect(editor).toHaveCount(0);
      await page.reload();
      await shifts.click();
      await expect(ends.nth(0)).toHaveAttribute("aria-valuetext", "12:00");
      await expect(starts.nth(1)).toHaveAttribute("aria-valuetext", "13:00");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await checkViews(after, { "11:30": true, "12:00": false, "12:30": false, "13:00": true, "14:30": true, "15:00": false });
    });

    await test.step("staff must be assigned to both the service and location", async () => {
      const secondaryName = `Secondary QA time-off location ${tag}`;
      [{ id: secondLocationId }] = await db<{ id: string }[]>`
        INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${tenantId},${`secondary-${tag}`},${secondaryName},${timezone}) RETURNING id`;
      await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
        SELECT ${tenantId},${secondLocationId},day,'09:00','16:00' FROM generate_series(0,6) AS day`;
      await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${serviceId},${secondLocationId})`;
      expect(await slots(after, secondLocationId)).toEqual([]);

      await page.goto(`${app}/team?employee=${staffId}&tab=services`);
      const locations = page.getByRole("group", { name: "Locations this person can serve", exact: true });
      const services = page.getByRole("group", { name: "Services this person can deliver", exact: true });
      const serviceName = `QA time-off service ${tag}`;
      const saveAssignments = async () => {
        await page.getByRole("button", { name: "Save services & locations", exact: true }).click();
        await expect(page.getByText("Staff member saved.", { exact: true })).toBeVisible();
        await page.reload();
        await expect(page).toHaveURL((url) => url.searchParams.get("employee") === staffId && url.searchParams.get("tab") === "services");
      };

      await locations.getByRole("textbox").fill(secondaryName);
      await locations.getByRole("button", { name: secondaryName, exact: true }).click();
      await saveAssignments();
      await expect(locations.getByRole("button", { name: `Remove ${secondaryName}`, exact: true })).toBeVisible();
      expect(await slots(after, secondLocationId)).toContain(at(after, "13:00"));

      await services.getByRole("button", { name: `Remove ${serviceName}`, exact: true }).click();
      await saveAssignments();
      await expect(services.getByText("None selected", { exact: true })).toBeVisible();
      await expect(locations.getByRole("button", { name: `Remove ${secondaryName}`, exact: true })).toBeVisible();
      expect(await slots(after)).toEqual([]);
      expect(await slots(after, secondLocationId)).toEqual([]);

      await services.getByRole("textbox").fill(serviceName);
      await services.getByRole("button", { name: serviceName, exact: true }).click();
      await saveAssignments();
      await checkViews(after, { "13:00": true, "12:30": false }, secondLocationId);

      await locations.getByRole("button", { name: `Remove ${secondaryName}`, exact: true }).click();
      await saveAssignments();
      expect(await slots(after, secondLocationId)).toEqual([]);
      expect(await slots(after)).toContain(at(after, "13:00"));
    });
  } finally {
    try {
      if (serviceId) await db`DELETE FROM services WHERE id=${serviceId}`;
      if (staffId) await db`DELETE FROM team_members WHERE id=${staffId}`;
      if (locationId) await db`DELETE FROM locations WHERE id=${locationId}`;
      if (secondLocationId) await db`DELETE FROM locations WHERE id=${secondLocationId}`;
    } finally {
      await Promise.all([guest.close(), db.end()]);
    }
  }
});
