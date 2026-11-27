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
    const [{ tenantId, timezone }] = await db<{ tenantId: string; timezone: string }[]>`
      SELECT tenant_id AS "tenantId", timezone FROM tenant_settings LIMIT 1
    `;
    const [location] = await db`INSERT INTO locations (tenant_id, slug, name)
      VALUES (${tenantId}, ${`zz-check-in-${tag}`}, ${`Check-in studio ${tag}`}) RETURNING id`;
    const [service] = await db`INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
      VALUES (${tenantId}, ${`check-in-${tag}`}, ${`Check-in treatment ${tag}`}, 45, 6500) RETURNING id, title`;
    await db`INSERT INTO service_locations (tenant_id, service_id, location_id) VALUES (${tenantId}, ${service.id}, ${location.id})`;
    const schedule = await Promise.all(["Waiting", "Direct", "Upcoming", "Early"].map(async (kind) => {
      const key = `${kind.toLowerCase()}-${tag}`;
      const [member] = await db`INSERT INTO team_members (tenant_id, name, email, role)
        VALUES (${tenantId}, ${`Provider ${key}`}, ${`provider-${key}@example.test`}, 'staff') RETURNING id`;
      await db`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenantId}, ${member.id}, ${location.id})`;
      await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenantId}, ${service.id}, ${member.id})`;
      const [client] = await db`INSERT INTO customers (tenant_id, name, email, phone)
        VALUES (${tenantId}, ${`Client ${key}`}, ${`client-${key}@example.test`}, ${kind === "Early" ? "+4511223344" : null}) RETURNING id, name`;
      const [block] = await db`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
        SELECT ${tenantId}, ${member.id}, ${location.id}, starts_at, starts_at + interval '45 minutes', 'confirmed'
        FROM (SELECT CASE
          WHEN ${kind} = 'Upcoming' THEN now() + interval '1 day'
          WHEN ${kind} = 'Early' THEN LEAST(now() + interval '30 minutes',
            ((date_trunc('day', now() AT TIME ZONE ${timezone}) + interval '1 day') AT TIME ZONE ${timezone}) - interval '1 second')
          ELSE now() - interval '5 minutes' END AS starts_at) schedule
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

    const [waiting, direct, upcoming, early] = schedule;
    const [segmentService] = await db`INSERT INTO services (tenant_id, slug, title, duration_minutes)
      VALUES (${tenantId}, ${`follow-up-${tag}`}, ${`Follow-up ${tag}`}, 15) RETURNING id, title`;
    await db`INSERT INTO service_locations (tenant_id, service_id, location_id)
      VALUES (${tenantId}, ${segmentService.id}, ${location.id})`;
    await db`INSERT INTO service_team_members (tenant_id, service_id, team_member_id)
      VALUES (${tenantId}, ${segmentService.id}, ${upcoming.providerId})`;
    const [segmentBlock] = await db`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      SELECT tenant_id, ${upcoming.providerId}, location_id, ends_at, ends_at + interval '15 minutes', 'confirmed'
      FROM bookings WHERE tenant_id=${tenantId} AND id=${waiting.id} RETURNING id`;
    await db`INSERT INTO booking_service_segments (tenant_id, booking_id, booking_block_id, service_id, position, booked_price_cents)
      VALUES (${tenantId}, ${waiting.id}, ${segmentBlock.id}, ${segmentService.id}, 2, 0)`;
    const open = async (item: typeof waiting) => {
      await page.goto(`/nordic/app/calendars?booking=${item.id}`);
      return page.getByRole("complementary", { name: `Appointment with ${item.name}` });
    };
    const state = async (id: string) => (await db`SELECT status, attendance_stage FROM bookings WHERE tenant_id=${tenantId} AND id=${id}`)[0];
    const stageLabel = (drawer: Awaited<ReturnType<typeof open>>) => drawer.locator(".appointment-drawer__detail--status dd");
    const futureDrawer = await open(upcoming);
    await expect(futureDrawer.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
    await expect(futureDrawer.getByRole("link", { name: "Add phone" })).toHaveAttribute("href", /customer=.*&edit=1$/);
    const earlyDrawer = await open(early);
    const clientDetails = earlyDrawer.getByRole("region", { name: "Client", exact: true });
    const clientName = clientDetails.getByRole("heading", { name: early.name, exact: true });
    const emailLink = clientDetails.locator('a[href^="mailto:"]');
    await expect(clientDetails.getByRole("link", { name: "+4511223344", exact: true })).toHaveAttribute("href", "tel:+4511223344");
    await expect(emailLink).toBeVisible();
    await expect(clientDetails.locator("dt svg")).toHaveCount(2);
    const [nameBounds, emailBounds] = await Promise.all([clientName.boundingBox(), emailLink.boundingBox()]);
    expect(Math.abs(nameBounds!.x - emailBounds!.x)).toBeLessThan(2);
    const checkIn = earlyDrawer.getByRole("button", { name: "Check in", exact: true });
    const editServices = earlyDrawer.getByRole("button", { name: "Edit services", exact: true });
    await expect(editServices).toBeVisible();
    const [checkInBounds, editBounds] = await Promise.all([checkIn.boundingBox(), editServices.boundingBox()]);
    expect(Math.abs(checkInBounds!.y - editBounds!.y)).toBeLessThan(2);
    await checkIn.click();
    await expect(checkIn).toHaveAttribute("aria-expanded", "true");
    await earlyDrawer.getByRole("button", { name: "Waiting room", exact: true }).press("Escape");
    await expect(checkIn).toBeFocused();
    await expect(checkIn).toHaveAttribute("aria-expanded", "false");
    await checkIn.click();
    await earlyDrawer.getByRole("button", { name: "Waiting room", exact: true }).click();
    await expect(stageLabel(earlyDrawer)).toHaveText("Waiting room");
    await expect(earlyDrawer.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0);
    await earlyDrawer.getByRole("button", { name: "Start service", exact: true }).click();
    await expect(stageLabel(earlyDrawer)).toHaveText("In service");
    await earlyDrawer.getByRole("button", { name: "Checkout", exact: true }).click();
    const earlySale = page.getByRole("dialog", { name: "Appointment checkout" });
    await expect(earlySale).toContainText(service.title);
    await expect(earlySale.getByRole("button", { name: "Finish checkout" })).toHaveCount(0);
    await earlySale.getByRole("link", { name: "Go to payments" }).click();
    await expect(earlySale.getByLabel("Amount (DKK)")).toHaveValue("65.00");
    await earlySale.getByRole("radio", { name: "Cash", exact: true }).check();
    await earlySale.getByRole("button", { name: "Record payment and finish checkout", exact: true }).click();
    await expect.poll(() => state(early.id)).toEqual({ status: "completed", attendance_stage: null });
    expect((await db`SELECT starts_at > now() AS early FROM bookings WHERE id=${early.id}`)[0].early).toBe(true);
    expect(await db`SELECT amount_cents FROM payment_records WHERE tenant_id=${tenantId} AND booking_id=${early.id}`).toEqual([{ amount_cents: 6500 }]);
    const viewReceipt = earlySale.getByRole("link", { name: "View receipt", exact: true });
    await viewReceipt.click();
    const receiptUrl = page.url();
    await expect(page.getByRole("heading", { name: "Appointment receipt" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Items" }).getByRole("row", { name: /Checkout total/ })).toContainText("65,00");
    await expect(page.getByRole("table", { name: "Payments and refunds" }).getByRole("row", { name: /Payment · Cash/ })).toContainText("65,00");
    await expect(page.getByText(early.name, { exact: true })).toBeVisible();
    await page.evaluate(() => { window.print = () => { document.body.dataset.receiptPrinted = "yes"; }; });
    await page.getByRole("button", { name: "Print receipt" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-receipt-printed", "yes");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Receipt actions" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Appointment receipt" })).toBeVisible();
    const pdf = await page.pdf();
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("link", { name: "Back to sale" }).click();
    await expect(viewReceipt).toBeVisible();
    expect((await page.request.get(receiptUrl.replace("/nordic/", "/copenhagen/"))).status()).toBe(404);
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
    await staffPage.goto(receiptUrl);
    await expect(staffPage).not.toHaveURL(/\/sales\/receipt/);
    await expect(staffPage.getByRole("heading", { name: "Appointment receipt" })).toHaveCount(0);
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
    const waitingEmail = `waiting-staff-${tag}@example.test`;
    const segmentEmail = `segment-staff-${tag}@example.test`;
    for (const [email, providerId] of [[waitingEmail, waiting.providerId], [segmentEmail, upcoming.providerId]]) {
      const [provider] = await control`INSERT INTO identities (email, password_hash, display_name)
        SELECT ${email}, password_hash, 'Waiting room provider' FROM identities WHERE email='owner@nordic.local' RETURNING id`;
      await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${provider.id}, 'staff')`;
      await db`UPDATE team_members SET identity_id=${provider.id} WHERE tenant_id=${tenantId} AND id=${providerId}`;
    }
    const waitingContext = await page.context().browser()!.newContext({ viewport: page.viewportSize() });
    const waitingPage = await waitingContext.newPage();
    await waitingPage.goto(new URL("/login", page.url()).href);
    await waitingPage.getByLabel("Work email").fill(waitingEmail);
    await waitingPage.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await waitingPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(waitingPage.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

    const drawer = await open(waiting);
    await drawer.getByRole("button", { name: "Check in", exact: true }).press("Enter");
    const waitingChoice = drawer.getByRole("button", { name: "Waiting room", exact: true });
    await expect(waitingChoice).toBeFocused();
    await waitingChoice.press("Enter");
    await expect(stageLabel(drawer)).toHaveText("Waiting room");
    expect(await state(waiting.id)).toEqual({ status: "arrived", attendance_stage: "waiting_room" });
    await expect(drawer.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0);
    const alerts = () => db<{ team_member_id: string }[]>`SELECT team_member_id FROM provider_arrival_alerts
      WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`;
    expect(await alerts()).toEqual([]);
    const notify = drawer.getByRole("button", { name: "Notify providers", exact: true });
    const secondDesk = await page.context().newPage();
    await secondDesk.goto(page.url());
    const secondNotify = secondDesk.getByRole("button", { name: "Notify providers", exact: true });
    await expect(secondNotify).toBeVisible();
    await Promise.all([notify.click(), secondNotify.click()]);
    await expect.poll(alerts).toEqual(expect.arrayContaining([
      { team_member_id: waiting.providerId }, { team_member_id: upcoming.providerId },
    ]));
    expect(await alerts()).toHaveLength(2);
    await expect(secondNotify).toHaveCount(0);
    await secondDesk.close();
    await expect(notify).toHaveCount(0);
    await expect(waitingPage.getByRole("link", { name: "Notifications: clients in the waiting room" })).toBeVisible({ timeout: 20_000 });
    await waitingPage.getByRole("link", { name: "Notifications: clients in the waiting room" }).click();
    const inbox = waitingPage.getByRole("region", { name: "Waiting room alerts" });
    const alert = inbox.getByRole("listitem").filter({ hasText: waiting.name });
    await expect(alert.getByRole("link", { name: "Open appointment" })).toHaveAttribute("href", `/nordic/app/calendars?booking=${waiting.id}`);
    await expect(alert.getByRole("link", { name: "Open appointment" })).toBeInViewport({ ratio: 1 });
    await expect(alert.getByRole("button", { name: "Mark as read" })).toBeInViewport({ ratio: 1 });
    await expect(waitingPage.getByRole("heading", { name: "Appointments needing review" })).toHaveCount(0);
    await staffPage.goto(new URL("/nordic/app/notifications", page.url()).href);
    await expect(staffPage.getByText("No waiting room alerts.")).toBeVisible();
    await staffContext.close();
    await alert.getByRole("button", { name: "Mark as read" }).click();
    await expect(alert.getByText("Read", { exact: true })).toBeVisible();
    await expect(waitingPage.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
    const segmentContext = await page.context().browser()!.newContext({ viewport: page.viewportSize() });
    const segmentPage = await segmentContext.newPage();
    await segmentPage.goto(new URL("/login", page.url()).href);
    await segmentPage.getByLabel("Work email").fill(segmentEmail);
    await segmentPage.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await segmentPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await segmentPage.getByRole("link", { name: "Notifications: clients in the waiting room" }).click();
    const segmentAlert = segmentPage.getByRole("listitem").filter({ hasText: waiting.name });
    await expect(segmentAlert.getByRole("button", { name: "Mark as read" })).toBeVisible();
    await segmentAlert.getByRole("link", { name: "Open appointment" }).click();
    const segmentDrawer = segmentPage.getByRole("complementary", { name: `Appointment with ${waiting.name}` });
    await expect(segmentDrawer.getByText(segmentService.title, { exact: true })).toBeVisible();
    await expect(segmentDrawer.getByRole("link", { name: "Open client" })).toHaveCount(0);
    await expect(segmentDrawer.getByRole("link", { name: /@/ })).toHaveCount(0);
    await expect(segmentDrawer.getByText("Booked by", { exact: true })).toHaveCount(0);
    await segmentContext.close();
    await open(waiting);
    await expect(drawer.getByRole("button", { name: "Start service" })).toBeVisible();
    await expect(notify).toHaveCount(0);
    await drawer.getByRole("button", { name: "Start service", exact: true }).click();
    await expect(stageLabel(drawer)).toHaveText("In service");
    await waitingPage.reload();
    await expect(inbox.getByText("No waiting room alerts.")).toBeVisible();
    await waitingContext.close();
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
    await sale.getByRole("radio", { name: "Cash", exact: true }).check();
    await sale.getByRole("button", { name: "Record payment and finish checkout", exact: true }).click();
    await expect.poll(() => state(waiting.id)).toEqual({ status: "completed", attendance_stage: null });
    await expect(sale.getByRole("button", { name: "Finish checkout", exact: true })).toHaveCount(0);
    expect(await db`SELECT id FROM commerce_sales WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`).toEqual([openSale]);
    expect(await db`SELECT amount_cents FROM payment_records WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}`).toEqual([{ amount_cents: 6500 }]);
    expect((await db`SELECT event_type FROM booking_events WHERE tenant_id=${tenantId} AND booking_id=${waiting.id}
      AND event_type IN ('booking.waiting_room','booking.in_service','booking.checking_out','booking.completed') ORDER BY created_at`).map((row) => row.event_type))
      .toEqual(["booking.waiting_room", "booking.in_service", "booking.checking_out", "booking.completed"]);
    await sale.getByRole("link", { name: "Open appointment", exact: true }).click();
    await expect(drawer.getByRole("link", { name: "View sale", exact: true })).toBeVisible();

    const alertsEnabled = async () => (await db<{ enabled: boolean }[]>`
      SELECT provider_arrival_alerts_enabled AS enabled FROM tenant_settings WHERE tenant_id=${tenantId}`)[0].enabled;
    const originalSetting = await alertsEnabled();
    try {
      await page.goto("/nordic/app/notifications");
      const enableAlerts = page.getByRole("switch", { name: "Enable provider alerts" });
      await expect(enableAlerts).toBeChecked();
      await enableAlerts.press("Space");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect.poll(alertsEnabled).toBe(false);
      await page.reload();
      await expect(enableAlerts).not.toBeChecked();
    } finally {
      await db`UPDATE tenant_settings SET provider_arrival_alerts_enabled=${originalSetting} WHERE tenant_id=${tenantId}`;
    }
  } finally {
    await Promise.all([db.end(), control.end()]);
  }
});
