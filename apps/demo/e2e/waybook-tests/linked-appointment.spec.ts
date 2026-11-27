import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

test("book, move, pay, and scope the provider view of linked services", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(8000);
  const database = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const controlDatabase = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  for (const raw of [database, controlDatabase]) {
    const url = new URL(raw);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
      throw new Error("Linked appointment QA requires disposable local databases.");
    }
  }
  const sql = postgres(database, { max: 1, ssl: false });
  const control = postgres(controlDatabase, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const clientName = `Linked client ${tag}`;
  const clientEmail = `linked-${tag}@example.test`;
  try {
    const [{ tenantId, timezone, day }] = await sql<{ tenantId: string; timezone: string; day: string }[]>`
      SELECT tenant_id AS "tenantId", timezone, ((now() AT TIME ZONE timezone)::date + 3)::text AS day FROM tenant_settings LIMIT 1
    `;
    const [location] = await sql`INSERT INTO locations (tenant_id, slug, name, timezone, is_online_bookable)
      VALUES (${tenantId}, ${`linked-${tag}`}, ${`Linked studio ${tag}`}, ${timezone}, FALSE) RETURNING id`;
    const [first, second, replacement] = await sql`INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
      VALUES (${tenantId}, ${`first-${tag}`}, ${`First treatment ${tag}`}, 45, 7000),
             (${tenantId}, ${`second-${tag}`}, ${`Second treatment ${tag}`}, 30, 3000),
             (${tenantId}, ${`replacement-${tag}`}, ${`Replacement service ${tag}`}, 45, 9000) RETURNING id, title`;
    const [primary, secondary] = await sql`INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${tenantId}, ${`Primary provider ${tag}`}, ${`primary-${tag}@example.test`}, 'staff'),
             (${tenantId}, ${`Second provider ${tag}`}, ${`second-${tag}@example.test`}, 'staff') RETURNING id, name`;
    const providers = [primary.id, secondary.id];
    await sql`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
      SELECT ${tenantId}, ${location.id}, day, '09:00', '17:00' FROM generate_series(0,6) AS day`;
    await sql`INSERT INTO service_locations (tenant_id, service_id, location_id)
      VALUES (${tenantId}, ${first.id}, ${location.id}), (${tenantId}, ${second.id}, ${location.id}), (${tenantId}, ${replacement.id}, ${location.id})`;
    await sql`INSERT INTO service_team_members (tenant_id, service_id, team_member_id)
      VALUES (${tenantId}, ${first.id}, ${primary.id}), (${tenantId}, ${second.id}, ${secondary.id}), (${tenantId}, ${replacement.id}, ${primary.id})`;
    await sql`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id)
      SELECT ${tenantId}, member, ${location.id} FROM unnest(${providers}::uuid[]) AS member`;
    await sql`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone)
      SELECT ${tenantId}, member, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', '09:00', '17:00', ${timezone}
      FROM unnest(${providers}::uuid[]) AS member`;
    const time = (clock: string) => fromZonedTime(`${day}T${clock}`, timezone);
    const publicAvailability = await page.request.get("/nordic/api/public/availability", { params: {
      service: first.id, location: location.id, start: time("09:00").toISOString(), end: time("17:00").toISOString(),
    } });
    expect(publicAvailability.status()).toBe(422);
    const [competingBlock] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${secondary.id}, ${location.id}, ${time("10:45")}, ${time("11:15")}, 'confirmed') RETURNING id`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto(`/nordic/app/calendars?${new URLSearchParams({
      view: "team", location: location.id, day, service: first.id, employee: primary.id,
      createStaff: primary.id, create: `${day}T10:00`,
    })}`);
    const drawer = page.getByRole("complementary", { name: "New appointment" });
    await drawer.getByRole("button", { name: "Add client", exact: true }).click();
    await drawer.getByLabel("Client name").fill(clientName);
    await drawer.getByLabel("Email", { exact: true }).fill(clientEmail);
    await drawer.getByRole("button", { name: "Add service", exact: true }).click();
    await drawer.getByRole("combobox", { name: "Service 2", exact: true }).fill(second.title);
    await drawer.getByRole("option", { name: new RegExp(second.title) }).click();
    await drawer.getByRole("combobox", { name: "Provider for service 2" }).fill(secondary.name);
    await drawer.getByRole("option", { name: secondary.name, exact: true }).click();
    await expect(drawer.getByText("Defaults to 10:45")).toBeVisible();
    await expect(drawer.getByText(/75 min/)).toBeVisible();
    await drawer.getByRole("button", { name: "Confirm appointment" }).click();
    await expect(drawer.getByRole("alert")).toContainText(`${second.title} is unavailable`);
    const [existing] = await sql`SELECT count(*)::int AS count FROM bookings b JOIN customers c ON c.id=b.customer_id
      WHERE b.tenant_id=${tenantId} AND c.email=${clientEmail}`;
    expect(existing.count).toBe(0);
    await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${competingBlock.id}`;
    await drawer.getByRole("button", { name: "Confirm appointment" }).click();
    await expect(drawer.getByRole("status").filter({ hasText: "Appointment confirmed" })).toBeVisible();
    const [booking] = await sql`SELECT b.id, b.starts_at, block.starts_at AS added_start, block.team_member_id AS added_provider
      FROM bookings b JOIN customers c ON c.id=b.customer_id
      JOIN booking_service_segments segment ON segment.tenant_id=b.tenant_id AND segment.booking_id=b.id
      JOIN booking_blocks block ON block.tenant_id=segment.tenant_id AND block.id=segment.booking_block_id
      WHERE b.tenant_id=${tenantId} AND c.email=${clientEmail}`;
    expect(booking).toMatchObject({ starts_at: time("10:00"), added_start: time("10:45"), added_provider: secondary.id });
    await drawer.getByRole("link", { name: "View appointment" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("booking") === booking.id && !url.searchParams.has("create"));
    const saved = page.getByRole("complementary", { name: `Appointment with ${clientName}` });
    await expect(saved.getByText(second.title, { exact: true })).toBeVisible();
    await saved.getByRole("button", { name: "More appointment actions" }).click();
    await saved.getByRole("button", { name: "Reschedule", exact: true }).click();
    const schedule = saved.locator("section").filter({ has: page.getByRole("heading", { name: "Reschedule", exact: true }) });
    await expect(schedule.getByText("All services move together with their assigned providers.")).toBeVisible();
    await schedule.locator(".appointment-reschedule-picker__day").filter({ hasText: new RegExp(`${day.slice(-2)}$`) }).click();
    await schedule.getByRole("button", { name: "11:00", exact: true }).click();

    const [laterBlock] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${secondary.id}, ${location.id}, ${time("11:45")}, ${time("12:15")}, 'confirmed') RETURNING id`;
    const move = schedule.getByRole("button", { name: "Reschedule appointment" });
    await move.click();
    await expect(schedule.getByRole("alert")).toHaveText("That time is no longer available for every service. Choose another time.");
    const positions = () => sql`
      SELECT b.starts_at, block.starts_at AS added_start, block.team_member_id AS added_provider
      FROM bookings b JOIN booking_service_segments segment ON segment.tenant_id=b.tenant_id AND segment.booking_id=b.id
      JOIN booking_blocks block ON block.tenant_id=segment.tenant_id AND block.id=segment.booking_block_id
      WHERE b.tenant_id=${tenantId} AND b.id=${booking.id}
    `;
    expect((await positions())[0]).toEqual({ starts_at: time("10:00"), added_start: time("10:45"), added_provider: secondary.id });
    await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${laterBlock.id}`;
    await move.click();
    await expect(saved.getByText(new RegExp(`11:45–12:15 · ${secondary.name}`))).toBeVisible();
    expect((await positions())[0]).toEqual({ starts_at: time("11:00"), added_start: time("11:45"), added_provider: secondary.id });

    const edit = saved.getByRole("button", { name: "Edit services", exact: true });
    const editor = saved.getByRole("region", { name: "Appointment services" });
    const save = editor.getByRole("button", { name: "Save services", exact: true });
    const currentService = async () => (await sql`SELECT service_id FROM bookings WHERE tenant_id=${tenantId} AND id=${booking.id}`)[0]?.service_id;
    await sql`UPDATE services SET price_cents=3500 WHERE tenant_id=${tenantId} AND id=${second.id}`;
    await edit.click();
    await editor.getByRole("button", { name: /^Edit service 1/ }).click();
    await editor.getByRole("combobox", { name: "Choose service 1" }).fill(replacement.title);
    await editor.getByRole("option", { name: new RegExp(replacement.title) }).click();
    await editor.getByRole("combobox", { name: "Provider for service 1" }).fill(primary.name);
    await editor.getByRole("option", { name: primary.name, exact: true }).click();
    await editor.getByRole("button", { name: /^Edit service 2/ }).click();
    await editor.getByLabel(/Start time for service 2/).fill("12:15");
    const [editBlock] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${secondary.id}, ${location.id}, ${time("12:15")}, ${time("12:45")}, 'confirmed') RETURNING id`;
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(`${second.title} is unavailable`);
    expect(await currentService()).toBe(first.id);
    expect((await positions())[0].added_start).toEqual(time("11:45"));
    await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${editBlock.id}`;
    await save.click();
    await expect(saved.getByText(replacement.title, { exact: true })).toBeVisible();
    await expect(saved.getByText(new RegExp(`12:15–12:45 · ${secondary.name}`))).toBeVisible();
    expect(await currentService()).toBe(replacement.id);
    expect((await sql`SELECT booked_price_cents FROM booking_service_segments WHERE tenant_id=${tenantId} AND booking_id=${booking.id}`)[0]?.booked_price_cents).toBe(3000);

    await edit.click();
    await editor.getByRole("button", { name: /^Edit service 2/ }).click();
    await editor.getByRole("button", { name: "Remove service 2" }).click();
    await save.click();
    await expect(saved.getByText(second.title, { exact: true })).toHaveCount(0);
    expect(await positions()).toHaveLength(0);
    await edit.click();
    await editor.getByRole("button", { name: "Add service", exact: true }).click();
    await expect(editor.getByRole("combobox", { name: "Choose service 2" })).toBeFocused();
    await editor.getByRole("combobox", { name: "Choose service 2" }).fill(second.title);
    await editor.getByRole("option", { name: new RegExp(second.title) }).click();
    await editor.getByRole("combobox", { name: "Provider for service 2" }).fill(secondary.name);
    await editor.getByRole("option", { name: secondary.name, exact: true }).click();
    await save.click();
    await expect(saved.getByText(new RegExp(`11:45–12:15 · ${secondary.name}`))).toBeVisible();

    await saved.getByRole("button", { name: "Close appointment", exact: true }).click();
    const segments = page.getByRole("link").filter({ hasText: clientName });
    await expect(segments).toHaveCount(2);

    const staleEditorPage = await page.context().newPage();
    await staleEditorPage.goto(`/nordic/app/calendars?day=${day}&booking=${booking.id}`);
    await staleEditorPage.getByRole("button", { name: "Edit services", exact: true }).click();
    const staleEditor = staleEditorPage.getByRole("region", { name: "Appointment services" });
    await staleEditor.getByRole("button", { name: /^Edit service 2/ }).click();
    await staleEditor.getByLabel(/Start time for service 2/).fill("12:30");

    await page.goto(`/nordic/app/sales?booking=${booking.id}`);
    const checkout = page.getByRole("complementary", { name: `Sale details for ${clientName}` });
    await expect(checkout.getByText(second.title, { exact: false })).toBeVisible();
    await checkout.getByRole("link", { name: "Go to payments" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "payment");
    await expect(checkout.getByLabel("Amount (DKK)")).toHaveValue("125.00");
    const method = checkout.getByRole("combobox", { name: "Method", exact: true });
    await method.selectOption("cash");
    await expect(method).toHaveValue("cash");
    await checkout.getByRole("button", { name: "Record payment" }).click();
    await expect(checkout.getByText("Paid SALE", { exact: true })).toBeVisible();
    const [settled] = await sql`SELECT
      (SELECT count(*)::int FROM commerce_sales WHERE tenant_id=${tenantId} AND booking_id=${booking.id}) AS sales,
      (SELECT sum(amount_cents)::int FROM payment_records WHERE tenant_id=${tenantId} AND booking_id=${booking.id} AND kind='payment') AS paid`;
    expect(settled).toEqual({ sales: 1, paid: 12500 });
    await staleEditor.getByRole("button", { name: "Save services", exact: true }).click();
    await expect(staleEditor.getByRole("alert")).toContainText("Services can only be edited before recording a payment");
    expect((await positions())[0].added_start).toEqual(time("11:45"));
    await staleEditorPage.close();
    await page.goto(`/nordic/app/calendars?day=${day}&booking=${booking.id}`);
    await expect(saved.getByText(replacement.title, { exact: true })).toBeVisible();
    await expect(edit).toHaveCount(0);
    await page.goto(`/nordic/app/calendars?day=${day}&location=${location.id}&view=month&service=${second.id}`);
    await expect(page.locator(".waybook-month-calendar__appointment").filter({ hasText: clientName })).toHaveCount(1);

    const [other] = await sql`INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${tenantId}, ${`Unassigned provider ${tag}`}, ${`unassigned-${tag}@example.test`}, 'staff') RETURNING id`;
    await sql`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenantId}, ${other.id}, ${location.id})`;
    const roleCases = [
      { provider: primary.id, email: `primary-login-${tag}@example.test`, own: replacement.title, peer: second.title },
      { provider: secondary.id, email: `secondary-login-${tag}@example.test`, own: second.title, peer: replacement.title },
      { provider: other.id, email: `unassigned-login-${tag}@example.test`, own: null, peer: null },
    ];
    for (const staff of roleCases) {
      const [identity] = await control`INSERT INTO identities (email, password_hash, display_name)
        SELECT ${staff.email}, password_hash, 'Test provider' FROM identities WHERE email='owner@nordic.local' RETURNING id`;
      await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${identity.id}, 'staff')`;
      await sql`UPDATE team_members SET identity_id=${identity.id} WHERE tenant_id=${tenantId} AND id=${staff.provider}`;
      await sql`INSERT INTO staff_permissions (tenant_id, team_member_id, can_manage_own_appointments, can_update_appointment_status)
        VALUES (${tenantId}, ${staff.provider}, true, true)`;
      await page.context().clearCookies();
      await page.goto("/login");
      await page.getByLabel("Work email").fill(staff.email);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/nordic\/app\/calendars/);

      const week = `/nordic/app/calendars?day=${day}&location=${location.id}`;
      await page.goto(week);
      const ownCard = page.getByRole("link", { name: new RegExp(clientName) });
      if (staff.own) {
        await expect(ownCard).toHaveCount(1);
        await expect(ownCard).toContainText(staff.own);
        await ownCard.click();
        await expect(saved.getByText(staff.own, { exact: true })).toBeVisible();
        // Hard navigation must use the same permissions and service projection.
        await page.goto(`/nordic/app/calendars?day=${day}&booking=${booking.id}`);
        await expect(saved.getByText(staff.own, { exact: true })).toBeVisible();
        await expect(saved.getByText(staff.peer!, { exact: true })).toHaveCount(0);
        await expect(saved.getByText(clientEmail)).toHaveCount(0);
        await expect(saved.getByText("You have view-only access to this appointment.")).toBeVisible();
        await expect(saved.getByRole("heading", { name: "Appointment status" })).toHaveCount(0);
        await expect(saved.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
        await expect(saved.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
        await expect(saved.getByRole("link", { name: "Checkout" })).toHaveCount(0);
        await page.goto(`${week}&view=month`);
        await expect(page.getByRole("link").filter({ hasText: clientName }).first()).toBeVisible();
        await page.goto(`/nordic/app/sales?booking=${booking.id}`);
        await expect(checkout).toHaveCount(0);
        await expect(page).not.toHaveURL(/\/app\/sales/);
      } else {
        await expect(ownCard).toHaveCount(0);
        await page.goto(`${week}&booking=${booking.id}`);
        await expect(saved).toHaveCount(0);
        await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);
      }
    }
  } finally {
    await Promise.all([sql.end(), control.end()]);
  }
});
