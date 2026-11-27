import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

test("opt-in service autofill honors the selected slot, current price, and manual choice", { tag: "@mobile" }, async ({ page }) => {
  const database = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const target = new URL(database);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Appointment autofill QA requires a disposable local database.");
  }
  const db = postgres(database, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  try {
    const [{ tenantId, timezone, day, previousDay }] = await db<{ tenantId: string; timezone: string; day: string; previousDay: string }[]>`
      SELECT tenant_id AS "tenantId", timezone, ((now() AT TIME ZONE timezone)::date + 3)::text AS day,
        ((now() AT TIME ZONE timezone)::date - 2)::text AS "previousDay" FROM tenant_settings
    `;
    const [location] = await db`INSERT INTO locations (tenant_id, slug, name, timezone)
      VALUES (${tenantId}, ${`autofill-${tag}`}, ${`Autofill studio ${tag}`}, ${timezone}) RETURNING id`;
    const [original, recent] = await db`INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
      VALUES (${tenantId}, ${`initial-${tag}`}, ${`Initial service ${tag}`}, 30, 6000),
        (${tenantId}, ${`return-${tag}`}, ${`Return service ${tag}`}, 45, 9000) RETURNING id, title`;
    const [provider] = await db`INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${tenantId}, ${`Autofill provider ${tag}`}, ${`provider-${tag}@example.test`}, 'staff') RETURNING id, name`;
    const [client] = await db`INSERT INTO customers (tenant_id, name, email, phone)
      VALUES (${tenantId}, ${`Autofill client ${tag}`}, ${`client-${tag}@example.test`}, '+4511223344') RETURNING id, name`;
    const services = [original.id, recent.id];
    await db`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
      SELECT ${tenantId}, ${location.id}, day, '09:00', '17:00' FROM generate_series(0, 6) day`;
    await db`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenantId}, ${provider.id}, ${location.id})`;
    await db`INSERT INTO service_locations (tenant_id, service_id, location_id)
      SELECT ${tenantId}, service, ${location.id} FROM unnest(${services}::uuid[]) service`;
    await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id)
      SELECT ${tenantId}, service, ${provider.id} FROM unnest(${services}::uuid[]) service`;
    await db`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone)
      VALUES (${tenantId}, ${provider.id}, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', '09:00', '17:00', ${timezone})`;
    const oldStart = fromZonedTime(`${previousDay}T09:00`, timezone);
    await db`
      WITH block AS (
        INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
        VALUES (${tenantId}, ${provider.id}, ${location.id}, ${oldStart}, ${new Date(+oldStart + 45 * 60_000)}, 'confirmed')
        RETURNING id, starts_at, ends_at
      )
      INSERT INTO bookings (tenant_id, booking_block_id, service_id, location_id, team_member_id, customer_id,
        starts_at, ends_at, booked_price_cents, status, source)
      SELECT ${tenantId}, id, ${recent.id}, ${location.id}, ${provider.id}, ${client.id},
        starts_at, ends_at, 5000, 'completed', 'tenant' FROM block
    `;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);

    const calendar = `/nordic/app/calendars?${new URLSearchParams({ view: "team", location: location.id, service: original.id, day })}`;
    const drawer = page.getByRole("complementary", { name: "New appointment" });
    const service = drawer.getByRole("combobox", { name: "Service", exact: true });
    const openSlot = async () => {
      await page.goto(calendar);
      await page.getByRole("link", { name: `New appointment ${provider.name} ${day} 10:15`, exact: true }).click();
    };
    const chooseClient = async () => {
      await drawer.getByRole("combobox", { name: "Find a client" }).fill(client.name);
      await drawer.getByRole("option", { name: new RegExp(`^${client.name} ·`) }).click();
    };
    const selectInitialService = async () => {
      await service.fill(original.title);
      await drawer.getByRole("option", { name: new RegExp(original.title) }).click();
    };
    const initialLabel = `${original.title} · 30 min`;
    const recentLabel = `${recent.title} · 45 min`;
    await openSlot();
    await chooseClient();
    await expect(service).toHaveValue(initialLabel);
    await expect(drawer.getByText(/Service filled from/)).toHaveCount(0);

    await page.goto("/nordic/app/settings?tab=calendar");
    const option = page.getByRole("checkbox", { name: /Autofill service/ });
    await expect(option).not.toBeChecked();
    await option.check();
    await page.getByRole("button", { name: "Save calendar preferences" }).click();
    await expect(page.getByText("Calendar preferences saved.")).toBeVisible();

    await openSlot();
    await selectInitialService();
    await chooseClient();
    await expect(service).toHaveValue(initialLabel);
    await expect(drawer.getByText(/Service filled from/)).toHaveCount(0);

    const [conflict] = await db`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${provider.id}, ${location.id}, ${fromZonedTime(`${day}T10:45`, timezone)},
        ${fromZonedTime(`${day}T11:00`, timezone)}, 'confirmed') RETURNING id`;
    await openSlot();
    await chooseClient();
    await expect(drawer.getByRole("button", { name: "Confirm appointment" })).toBeEnabled();
    await expect(service).toHaveValue(initialLabel);
    await expect(drawer.getByText(/Service filled from/)).toHaveCount(0);
    await db`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${conflict.id}`;

    await openSlot();
    await chooseClient();
    await expect(service).toHaveValue(recentLabel);
    await expect(drawer.getByText(/Service filled from/)).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Selected calendar slot" })).toContainText("10:15");
    await expect(drawer.getByRole("region", { name: "Selected calendar slot" })).toContainText(provider.name);

    await drawer.getByRole("button", { name: "Confirm appointment" }).click();
    await expect(drawer.getByText("Appointment confirmed and added to the calendar.")).toBeVisible();
    const [appointment] = await db`
      SELECT service_id, team_member_id, starts_at, booked_price_cents FROM bookings
      WHERE tenant_id = ${tenantId} AND customer_id = ${client.id} AND status = 'confirmed'
    `;
    expect(appointment).toEqual({
      service_id: recent.id, team_member_id: provider.id, starts_at: fromZonedTime(`${day}T10:15`, timezone), booked_price_cents: 9000,
    });
  } finally {
    await db.end();
  }
});
