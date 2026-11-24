import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

for (const workspace of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`staff time off blocks only its selected times and dates in ${workspace.route}`, async ({ page, request }) => {
  const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  let locationId: string | undefined;
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
    const slots = async (day: string) => {
      const response = await request.get(`/${workspace.route}/api/public/availability`, {
        params: { service: serviceId!, location: locationId!, start: at(day, "09:00"), end: at(day, "16:00") },
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
    const timeOffPath = `${app}/team?employee=${staffId}&tab=time-off`;
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

    await form.getByRole("button", { name: "Date range", exact: true }).click();
    await choose(first);
    await choose(last);
    if (await fullDay.getAttribute("aria-checked") === "false") await fullDay.click();
    await save.click();
    await expect.poll(async () => (await db`SELECT id FROM availability_overrides WHERE team_member_id=${staffId}`).length).toBe(3);
    expect(await slots(first)).toEqual([]);
    expect(await slots(last)).toEqual([]);
    expect(await slots(after)).toContain(at(after, "11:00"));

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
  } finally {
    try {
      if (serviceId) await db`DELETE FROM services WHERE id=${serviceId}`;
      if (staffId) await db`DELETE FROM team_members WHERE id=${staffId}`;
      if (locationId) await db`DELETE FROM locations WHERE id=${locationId}`;
    } finally {
      await db.end();
    }
  }
});
