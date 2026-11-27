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
    let primaryAvailabilityRequests = 0;
    page.on("request", (request) => {
      const body = request.postData() ?? "";
      if (request.headers()["next-action"] && body.includes('"serviceId"') && body.includes('"date"') && body.includes(first.id)) {
        primaryAvailabilityRequests++;
      }
    });
    await page.goto(`/nordic/app/calendars?${new URLSearchParams({
      view: "team", location: location.id, day, service: first.id, employee: primary.id,
      createStaff: primary.id, create: `${day}T10:00`, fromSlot: "1",
    })}`);
    const drawer = page.getByRole("complementary", { name: "New appointment" });
    const clientSearch = drawer.getByRole("combobox", { name: /^Find a / });
    const clientLetter = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/api/app/clients") && url.searchParams.get("q") === "a" && response.ok();
    });
    await clientSearch.fill("a");
    await clientLetter;
    await expect(clientSearch).toHaveAttribute("aria-expanded", "true");
    await clientSearch.press("Escape");
    await drawer.getByRole("button", { name: "Add client", exact: true }).click();
    await drawer.getByLabel("Client name").fill(clientName);
    await drawer.getByLabel("Email", { exact: true }).fill(clientEmail);
    await drawer.getByLabel("Phone", { exact: true }).fill("+4511223344");
    const confirm = drawer.getByRole("button", { name: "Confirm appointment" });
    await expect(confirm).toBeEnabled();
    expect(primaryAvailabilityRequests).toBe(0);
    const [occupiedPrimary] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${primary.id}, ${location.id}, ${time("10:00")}, ${time("10:45")}, 'confirmed') RETURNING id`;
    try {
      await confirm.click();
      await expect(drawer.getByRole("alert")).toHaveText("That staff member is not available at the selected time.");
    } finally {
      await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${occupiedPrimary.id}`;
    }
    await drawer.getByRole("button", { name: "Change slot" }).click();
    await expect(drawer.getByRole("button", { name: "10:00", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(primaryAvailabilityRequests).toBe(1);
    await drawer.getByRole("button", { name: "Hide slot options" }).click();
    const originalService = drawer.getByRole("combobox", { name: "Service", exact: true });
    await originalService.fill(second.title);
    await drawer.getByRole("option", { name: new RegExp(second.title) }).click();
    await expect(drawer.getByText(/selected time is unavailable/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Confirm appointment" })).toBeDisabled();
    await expect(drawer.getByRole("region", { name: "Selected calendar slot" })).toContainText("10:00");
    await originalService.fill(first.title);
    await drawer.getByRole("option", { name: new RegExp(first.title) }).click();
    await drawer.getByRole("button", { name: "Add service", exact: true }).click();
    const nextService = drawer.getByRole("combobox", { name: "Service 2", exact: true });
    const nextProvider = drawer.getByRole("combobox", { name: "Provider for service 2" });
    await expect(nextService).toBeFocused();
    await expect(drawer.getByRole("option", { name: new RegExp(replacement.title) })).toBeVisible();
    await nextService.fill("o");
    await expect(drawer.getByRole("option", { name: new RegExp(second.title) })).toBeVisible();
    await expect(drawer.getByRole("option", { name: new RegExp(replacement.title) })).toHaveCount(0);
    await nextService.fill(replacement.title);
    const replacementOption = drawer.getByRole("option", { name: new RegExp(replacement.title) });
    await expect(replacementOption).toBeVisible();
    await nextService.press("ArrowDown");
    await expect(replacementOption).toHaveAttribute("aria-selected", "true");
    await nextService.press("Enter");
    await expect(drawer.getByText(`${primary.name} · 10:45 · 45 min`, { exact: true })).toBeVisible();
    await expect(nextProvider).toHaveCount(0);
    await nextService.fill(replacement.title[0]);
    await expect(replacementOption).toBeVisible();
    await replacementOption.click();
    await expect(nextService).toHaveValue(`${replacement.title} · 45 min`);
    await expect(drawer.getByText(`${primary.name} · 10:45 · 45 min`, { exact: true })).toBeVisible();
    await expect(nextProvider).toHaveCount(0);
    await drawer.getByRole("button", { name: "Change provider or time for service 2" }).click();
    const startTime = drawer.getByRole("combobox", { name: "Start time", exact: true });
    await expect(startTime).toBeEnabled();
    await expect(startTime.locator("option:checked")).toHaveText("10:45");
    await expect(startTime.getByRole("option", { name: "10:50", exact: true })).toHaveCount(0);
    await startTime.selectOption("11:00");
    await expect(startTime).toHaveValue("11:00");
    await startTime.selectOption("");
    await expect(startTime.locator("option:checked")).toHaveText("10:45");
    await expect(drawer.getByRole("button", { name: "Remove service 2" })).toBeVisible();
    await drawer.getByRole("button", { name: "Change provider or time for service 2" }).click();

    await nextService.fill(second.title);
    await drawer.getByRole("option", { name: new RegExp(second.title) }).click();
    await expect(nextProvider).toHaveValue("");
    await nextProvider.fill(secondary.name);
    await drawer.getByRole("option", { name: secondary.name, exact: true }).click();
    await expect(drawer.getByText(`${secondary.name} · 10:45 · 30 min`, { exact: true })).toBeVisible();
    await expect(drawer.getByText(/75 min/)).toBeVisible();
    await drawer.locator("form").evaluate((form) => {
      form.addEventListener("formdata", (event) => event.formData.delete("customerPhone"), { once: true });
    });
    await confirm.click();
    await expect(drawer.getByRole("alert")).toHaveText("Enter a phone number for the new client.");
    await drawer.locator("form").evaluate((form) => {
      form.addEventListener("formdata", (event) => {
        const rows = JSON.parse(String(event.formData.get("additionalServices")));
        rows[0].time = "13:07";
        event.formData.set("additionalServices", JSON.stringify(rows));
      }, { once: true });
    });
    await confirm.click();
    await expect(drawer.getByRole("alert")).toContainText("at 13:07");
    await confirm.click();
    await expect(drawer.getByRole("alert")).toContainText("at 10:45");
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
    const scheduleSummary = saved.getByRole("region", { name: "Schedule", exact: true });
    await expect(scheduleSummary).toContainText("10:00–11:15");
    const clientSummary = saved.getByRole("region", { name: "Client", exact: true });
    await expect(clientSummary.getByRole("link", { name: clientEmail })).toBeVisible();
    await expect(clientSummary.getByRole("link", { name: "Open client" })).toHaveAttribute("href", /\/app\/customers\?customer=/);
    const bookingDetails = saved.getByRole("region", { name: "Booking details" });
    await expect(bookingDetails).toContainText("Booked on");
    await expect(bookingDetails).toContainText("Workspace");
    const bookedServices = saved.getByRole("region", { name: "Booked services" });
    await expect(bookedServices.getByRole("listitem")).toHaveCount(2);
    const secondService = bookedServices.getByRole("listitem").filter({ hasText: second.title });
    await expect(secondService).toContainText(`10:45–11:15 · ${secondary.name}`);
    await expect(secondService).toContainText("30 min");
    const teamGrid = page.locator(".team-day-calendar__grid");
    const linkedCard = teamGrid.locator("a.is-booking").filter({ hasText: second.title });
    const startsAtCell = teamGrid.locator(`[data-calendar-team-member-id="${secondary.id}"][data-calendar-starts-at="${day}T10:45"]`);
    const endCell = teamGrid.locator(`[data-calendar-team-member-id="${secondary.id}"][data-calendar-starts-at="${day}T11:15"]`);
    const cardBounds = await linkedCard.boundingBox();
    const startBounds = await startsAtCell.boundingBox();
    const endBounds = await endCell.boundingBox();
    expect(cardBounds && startBounds && endBounds).toBeTruthy();
    expect(Math.abs(cardBounds!.x - startBounds!.x)).toBeLessThan(5);
    expect(Math.abs(cardBounds!.x + cardBounds!.width - endBounds!.x)).toBeLessThan(5);

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
    await expect(scheduleSummary).toContainText("11:00–12:15");
    expect((await positions())[0]).toEqual({ starts_at: time("11:00"), added_start: time("11:45"), added_provider: secondary.id });

    await saved.getByRole("button", { name: "Close rescheduling", exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect(saved.getByRole("button", { name: "Close appointment", exact: true })).toBeVisible();

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
    const editStart = editor.getByLabel(/Start time for service 2/);
    await expect(editStart.getByRole("option", { name: "12:30", exact: true })).toHaveCount(1);
    await editStart.selectOption("12:30");
    const [editBlock] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${secondary.id}, ${location.id}, ${time("12:30")}, ${time("13:00")}, 'confirmed') RETURNING id`;
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(`${second.title} is unavailable`);
    expect(await currentService()).toBe(first.id);
    expect((await positions())[0].added_start).toEqual(time("11:45"));
    await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${editBlock.id}`;
    await save.click();
    await expect(saved.getByText(replacement.title, { exact: true })).toBeVisible();
    await expect(saved.getByText(new RegExp(`12:30–13:00 · ${secondary.name}`))).toBeVisible();
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
    await staleEditor.getByLabel(/Start time for service 2/).selectOption("12:30");

    await page.goto(`/nordic/app/sales?booking=${booking.id}`);
    const checkout = page.getByRole("complementary", { name: `Sale details for ${clientName}` });
    await expect(checkout.getByText(second.title, { exact: false })).toBeVisible();
    const reviewItems = checkout.getByRole("region", { name: "Checkout items" });
    await expect(reviewItems.getByRole("listitem").filter({ hasText: second.title })).toContainText(`11:45–12:15 · ${secondary.name}`);
    await checkout.getByRole("link", { name: "Go to payments" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "payment");
    await expect(checkout.getByLabel("Amount (DKK)")).toHaveValue("125.00");
    const method = checkout.getByRole("radio", { name: "Cash", exact: true });
    await method.focus();
    await method.press("Space");
    await expect(method).toBeChecked();
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
      { provider: primary.id, email: `primary-login-${tag}@example.test`, own: replacement.title, peer: second.title, time: "11:00–11:45" },
      { provider: secondary.id, email: `secondary-login-${tag}@example.test`, own: second.title, peer: replacement.title, time: "11:45–12:15" },
      { provider: other.id, email: `unassigned-login-${tag}@example.test`, own: null, peer: null, time: "" },
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
        await expect(scheduleSummary).toContainText(staff.time);
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
