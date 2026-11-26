import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("check in, resume checkout, and complete the same appointment", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(8000);
  const database = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const controlDatabase = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  for (const raw of [database, controlDatabase]) {
    const url = new URL(raw);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
      throw new Error("Check-in QA requires disposable local databases.");
    }
  }
  const db = postgres(database, { max: 1, ssl: false });
  const control = postgres(controlDatabase, { max: 1, ssl: false });
  try {
    const tag = randomUUID().slice(0, 8);
    const [{ tenantId }] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings LIMIT 1`;
    const [location] = await db`INSERT INTO locations (tenant_id, slug, name)
      VALUES (${tenantId}, ${`zz-check-in-${tag}`}, ${`Check-in studio ${tag}`}) RETURNING id`;
    const [service] = await db`INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
      VALUES (${tenantId}, ${`check-in-${tag}`}, ${`Check-in treatment ${tag}`}, 45, 6500) RETURNING id, title`;
    await db`INSERT INTO service_locations (tenant_id, service_id, location_id) VALUES (${tenantId}, ${service.id}, ${location.id})`;
    const schedule = await Promise.all(["Waiting", "Direct", "Upcoming"].map(async (kind) => {
      const key = `${kind.toLowerCase()}-${tag}`;
      const [member] = await db`INSERT INTO team_members (tenant_id, name, email, role)
        VALUES (${tenantId}, ${`Provider ${key}`}, ${`provider-${key}@example.test`}, 'staff') RETURNING id`;
      await db`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenantId}, ${member.id}, ${location.id})`;
      await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenantId}, ${service.id}, ${member.id})`;
      const [client] = await db`INSERT INTO customers (tenant_id, name, email)
        VALUES (${tenantId}, ${`Client ${key}`}, ${`client-${key}@example.test`}) RETURNING id, name`;
      const [block] = await db`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
        VALUES (${tenantId}, ${member.id}, ${location.id}, now() + ${kind === "Upcoming" ? "1 day" : "-5 minutes"}::interval,
          now() + ${kind === "Upcoming" ? "1 day 40 minutes" : "40 minutes"}::interval, 'confirmed')
        RETURNING id, starts_at, ends_at`;
      const [booking] = await db`INSERT INTO bookings (tenant_id, booking_block_id, service_id, location_id, team_member_id, customer_id,
        starts_at, ends_at, booked_price_cents, status, source) VALUES (${tenantId}, ${block.id}, ${service.id}, ${location.id},
        ${member.id}, ${client.id}, ${block.starts_at}, ${block.ends_at}, 6500, 'confirmed', 'tenant') RETURNING id`;
      return { id: booking.id as string, name: client.name as string, providerId: member.id as string };
    }));

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);

    const [waiting, direct, upcoming] = schedule;
    const open = async (item: typeof waiting) => {
      await page.goto(`/nordic/app/calendars?booking=${item.id}`);
      return page.getByRole("complementary", { name: `Appointment with ${item.name}` });
    };
    const state = async (id: string) => (await db`SELECT status, attendance_stage FROM bookings WHERE tenant_id=${tenantId} AND id=${id}`)[0];
    const stageLabel = (drawer: Awaited<ReturnType<typeof open>>) => drawer.locator(".appointment-drawer__detail--status dd");
    const futureDrawer = await open(upcoming);
    await expect(futureDrawer.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
    const providerEmail = `arrival-staff-${tag}@example.test`;
    const [identity] = await control`INSERT INTO identities (email, password_hash, display_name)
      SELECT ${providerEmail}, password_hash, 'Check-in staff' FROM identities WHERE email='owner@nordic.local' RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${identity.id}, 'staff')`;
    await db`UPDATE team_members SET identity_id=${identity.id} WHERE tenant_id=${tenantId} AND id=${direct.providerId}`;
    const staffContext = await page.context().browser()!.newContext({ viewport: page.viewportSize() });
    const staffPage = await staffContext.newPage();
    await staffPage.goto(new URL("/login", page.url()).href);
    await staffPage.getByLabel("Work email").fill(providerEmail);
    await staffPage.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await staffPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(staffPage).toHaveURL(/\/nordic\/app\/calendars/);
    const directUrl = new URL(`/nordic/app/calendars?booking=${direct.id}`, page.url()).href;
    await staffPage.goto(directUrl);
    const directDrawer = staffPage.getByRole("complementary", { name: `Appointment with ${direct.name}` });
    await expect(directDrawer).toBeVisible();
    await expect(directDrawer.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
    await db`INSERT INTO staff_permissions (tenant_id, team_member_id, can_update_appointment_status)
      VALUES (${tenantId}, ${direct.providerId}, true)`;
    await staffPage.reload();
    await directDrawer.getByRole("button", { name: "Check in", exact: true }).click();
    await directDrawer.getByRole("button", { name: "In service", exact: true }).click();
    await expect(stageLabel(directDrawer)).toHaveText("In service");
    expect(await state(direct.id)).toEqual({ status: "arrived", attendance_stage: "in_service" });
    await expect(directDrawer.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0);
    await staffContext.close();

    const drawer = await open(waiting);
    await drawer.getByRole("button", { name: "Check in", exact: true }).press("Enter");
    const waitingChoice = drawer.getByRole("button", { name: "Waiting room", exact: true });
    await expect(waitingChoice).toBeFocused();
    await waitingChoice.press("Enter");
    await expect(stageLabel(drawer)).toHaveText("Waiting room");
    expect(await state(waiting.id)).toEqual({ status: "arrived", attendance_stage: "waiting_room" });
    await expect(drawer.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Start service", exact: true }).click();
    await expect(stageLabel(drawer)).toHaveText("In service");
    await drawer.getByRole("button", { name: "Checkout", exact: true }).click();
    const sale = page.getByRole("dialog", { name: "Appointment checkout" });
    await expect(sale).toContainText(service.title);
    expect(await state(waiting.id)).toEqual({ status: "arrived", attendance_stage: "checking_out" });
    await expect(db`UPDATE bookings SET attendance_stage='waiting_room' WHERE tenant_id=${tenantId} AND id=${waiting.id}`)
      .rejects.toThrow("invalid appointment attendance stage transition");
    await expect(sale.getByRole("button", { name: "Finish checkout" })).toHaveCount(0);
    await sale.getByRole("link", { name: "Open appointment", exact: true }).click();
    await expect(stageLabel(drawer)).toHaveText("Checking out");
    await drawer.getByRole("link", { name: "Continue checkout", exact: true }).click();
    await expect(sale).toContainText(waiting.name);
    const [openSale] = await db`SELECT id FROM commerce_sales WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`;

    await sale.getByRole("link", { name: "Go to payments" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "payment");
    await expect(sale.getByLabel("Amount (DKK)")).toHaveValue("65.00");
    await sale.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
    await sale.getByRole("button", { name: "Record payment" }).click();
    await sale.getByRole("button", { name: "Finish checkout", exact: true }).click();
    await expect.poll(() => state(waiting.id)).toEqual({ status: "completed", attendance_stage: null });
    await expect(sale.getByRole("button", { name: "Finish checkout", exact: true })).toHaveCount(0);
    expect(await db`SELECT id FROM commerce_sales WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`).toEqual([openSale]);
    expect(await db`SELECT amount_cents FROM payment_records WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`).toEqual([{ amount_cents: 6500 }]);
    expect((await db`SELECT event_type FROM booking_events WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}
      AND event_type IN ('booking.waiting_room','booking.in_service','booking.checking_out','booking.completed') ORDER BY created_at`).map((row) => row.event_type))
      .toEqual(["booking.waiting_room", "booking.in_service", "booking.checking_out", "booking.completed"]);
    await sale.getByRole("link", { name: "Open appointment", exact: true }).click();
    await expect(drawer.getByRole("link", { name: "View sale", exact: true })).toBeVisible();
  } finally {
    await Promise.all([db.end(), control.end()]);
  }
});
