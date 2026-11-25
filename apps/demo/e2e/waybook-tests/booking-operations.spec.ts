import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`booking operations at a second location in ${workspace.route}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    const database = process.env[workspace.database]!;
    const url = new URL(database);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
      throw new Error("Booking operations QA requires a disposable local database.");
    }
    const sql = postgres(database, { max: 2, ssl: false });
    const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
    const tag = randomUUID().slice(0, 8);
    const [settings] = await sql<{ tenantId: string; timezone: string; day: string }[]>`
      SELECT tenant_id AS "tenantId", timezone, ((now() AT TIME ZONE timezone)::date + 3)::text AS day
      FROM tenant_settings LIMIT 1
    `;
    const { tenantId, timezone, day } = settings;
    const [resourcesFeature] = await control<{ is_enabled: boolean }[]>`
      SELECT is_enabled FROM tenant_feature_states WHERE tenant_id=${tenantId} AND feature_key='resources'
    `;
    const [primary] = await sql<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${tenantId} AND slug='primary'`;
    const [location] = await sql<{ id: string }[]>`
      INSERT INTO locations (tenant_id, slug, name, timezone)
      VALUES (${tenantId}, ${`qa-${tag}`}, ${`Z QA branch ${tag}`}, ${timezone}) RETURNING id
    `;
    const [service] = await sql<{ id: string }[]>`
      INSERT INTO services (tenant_id, slug, title, duration_minutes)
      VALUES (${tenantId}, ${`qa-${tag}`}, ${`Z QA session ${tag}`}, 30) RETURNING id
    `;
    const [resource] = await sql<{ id: string; name: string }[]>`
      INSERT INTO resources (tenant_id, name, resource_type, is_mutually_exclusive)
      VALUES (${tenantId}, ${`Z Exclusive room ${tag}`}, 'room', TRUE) RETURNING id, name
    `;
    const staff = await sql<{ id: string; name: string }[]>`
      INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${tenantId}, ${`Z QA staff A ${tag}`}, ${`qa-a-${tag}@example.test`}, 'staff'),
             (${tenantId}, ${`Z QA staff B ${tag}`}, ${`qa-b-${tag}@example.test`}, 'staff')
      RETURNING id, name
    `;
    const staffIds = staff.map((member) => member.id);
    const customerNames = [`QA customer A ${tag}`, `QA customer B ${tag}`];
    const start = (time: string) => fromZonedTime(`${day}T${time}:00`, timezone).toISOString();
    const calendar = `/${workspace.route}/app/calendars?view=team&day=${day}&location=${location.id}&service=${service.id}`;
    const availabilityUrl = `/${workspace.route}/api/public/availability?` + new URLSearchParams({
      service: service.id, location: location.id, start: start("09:00"), end: start("17:00"),
    });
    const secondPage = await page.context().newPage();
    secondPage.setDefaultTimeout(10_000);

    try {
      if (!resourcesFeature.is_enabled) {
        await control`UPDATE tenant_feature_states SET is_enabled=true WHERE tenant_id=${tenantId} AND feature_key='resources'`;
      }
      await sql`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
        SELECT ${tenantId}, ${location.id}, day, '09:00', '17:00' FROM generate_series(0,6) AS day`;
      await sql`INSERT INTO service_locations (tenant_id, service_id, location_id) VALUES (${tenantId},${service.id},${location.id})`;
      await sql`INSERT INTO resource_locations (tenant_id, resource_id, location_id) VALUES (${tenantId},${resource.id},${location.id})`;
      await sql`INSERT INTO service_resources (tenant_id, service_id, resource_id) VALUES (${tenantId},${service.id},${resource.id})`;
      for (const member of staff) {
        await sql`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id) VALUES (${tenantId},${member.id},${location.id})`;
        await sql`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
        await sql`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone)
          VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','17:00',${timezone})`;
      }

      async function availableAt(memberId: string, time: string) {
        const response = await page.request.get(availabilityUrl);
        expect(response.status()).toBe(200);
        const result: { availability: { teamMemberId: string; slots: { startTime: string }[] }[] } = await response.json();
        return result.availability.some((member) => member.teamMemberId === memberId &&
          member.slots.some((slot) => slot.startTime === start(time)));
      }

      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${workspace.route}/app`));
      expect(await availableAt(staff[0].id, "10:00")).toBe(true);

      for (const [index, member] of staff.entries()) {
        await page.goto(calendar);
        const slot = page.getByRole("link", { name: `New appointment ${member.name} ${day} 10:00`, exact: true });
        await slot.focus();
        await slot.press("Enter");
        const form = page.getByRole("complementary", { name: "New appointment" });
        await expect(form.getByRole("link", { name: "Close new appointment" })).toBeFocused();
        for (let step = 0; step < 8; step += 1) {
          await page.keyboard.press("Tab");
          await expect(form.locator(":focus")).toHaveCount(1);
        }
        const locationPicker = form.getByRole("combobox", { name: "Location" });
        await locationPicker.fill("Unmatched location");
        await expect(locationPicker).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(locationPicker).toHaveAttribute("aria-expanded", "false");
        await expect(locationPicker).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(form).toHaveCount(0);
        await expect(page).toHaveURL((url) => !url.searchParams.has("create"));
        await expect(slot).toBeFocused();
        await slot.press("Enter");
        await form.getByLabel("Client name").fill(customerNames[index]);
        await form.getByLabel("Email", { exact: true }).fill(`qa-booking-${index}-${tag}@example.test`);
        await form.getByRole("button", { name: "10:00", exact: true }).click();
        await form.getByRole("button", { name: "Confirm appointment" }).click();
        await expect(form.getByText("Appointment confirmed and added to the calendar.")).toBeVisible();
        expect(await availableAt(member.id, "10:00")).toBe(false);
      }

      const bookings = await sql<{ id: string; name: string; memberId: string; startsAt: Date; locationId: string }[]>`
        SELECT b.id,c.name,b.team_member_id AS "memberId",b.starts_at AS "startsAt",b.location_id AS "locationId"
        FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
        WHERE b.tenant_id=${tenantId} AND b.service_id=${service.id} ORDER BY c.name
      `;
      expect(bookings.map((booking) => [booking.locationId, booking.startsAt.toISOString()])).toEqual([
        [location.id, start("10:00")], [location.id, start("10:00")],
      ]);
      await page.goto(`/${workspace.route}/app/calendars?view=team&day=${day}&location=${primary.id}`);
      await expect(page.locator("a.waybook-week-calendar__entry").filter({ hasText: customerNames[0] })).toHaveCount(0);

      function drawer(browserPage: Page, booking: (typeof bookings)[number]) {
        return browserPage.getByRole("complementary", { name: `Appointment with ${booking.name}` });
      }
      const [first, second] = bookings;
      const firstDrawer = drawer(page, first);
      const secondDrawer = drawer(page, second);
      const firstNameField = firstDrawer.getByLabel("Customer name");
      await page.goto(calendar);
      const firstCard = page.locator(`a.waybook-week-calendar__entry[href*="booking=${first.id}"]`);
      await firstCard.focus();
      await firstCard.press("Enter");
      await expect(firstDrawer.getByRole("button", { name: "Close appointment" })).toBeFocused();
      await expect(firstNameField).toHaveValue(first.name);
      await page.keyboard.press("Shift+Tab");
      await expect(firstDrawer.getByRole("button", { name: "Cancel appointment" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(firstDrawer).toHaveCount(0);
      await expect(page).toHaveURL((url) => !url.searchParams.has("booking"));
      await expect(firstCard).toBeFocused();
      await firstCard.press("Enter");
      await expect(firstNameField).toHaveValue(first.name);
      await firstNameField.fill("Unsaved calendar name");
      await expect(firstDrawer.getByRole("button", { name: "Save changes" })).toBeEnabled();
      await page.goBack();
      await expect(firstDrawer).toHaveCount(0);
      await expect(page).toHaveURL((url) => !url.searchParams.has("booking"));
      await page.goForward();
      await expect(firstNameField).toHaveValue(first.name);
      await firstNameField.fill("Unsaved before reload");
      await page.reload();
      await expect(page).toHaveURL((url) => url.searchParams.get("booking") === first.id);
      await expect(firstNameField).toHaveValue(first.name);
      const drawerDocument = await page.evaluate(() => performance.timeOrigin);
      await firstDrawer.getByRole("button", { name: "Close appointment", exact: true }).click();
      await expect(firstDrawer).toHaveCount(0);
      await expect(page).toHaveURL((url) => !url.searchParams.has("booking"));
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(drawerDocument);
      await page.goto(`${calendar}&booking=${second.id}`);
      await expect(secondDrawer.getByLabel("Customer name")).toHaveValue(second.name);
      await expect(secondDrawer.getByRole("button", { name: "Save changes" })).toBeDisabled();
      await expect(firstDrawer).toHaveCount(0);

      const pages = [page, secondPage];
      await Promise.all(pages.map(async (browserPage, index) => {
        const booking = bookings[index];
        await browserPage.goto(index === 0
          ? `${calendar}&booking=${booking.id}`
          : `/${workspace.route}/app/bookings?booking=${booking.id}`);
        const panel = drawer(browserPage, bookings[index]);
        await expect(panel.getByRole("button", { name: "Completed", exact: true })).toHaveCount(0);
        await panel.getByRole("combobox", { name: "Resource", exact: true }).selectOption(resource.id);
        await panel.getByLabel("Phone", { exact: true }).fill(`+451010100${index}`);
        await expect(panel.locator(":scope > header").getByRole("button", { name: "Save changes" })).toBeEnabled();
      }));
      await Promise.all(pages.map((browserPage, index) => drawer(browserPage, bookings[index]).getByRole("button", { name: "Save changes" }).click()));
      const assignments = () => sql<{ bookingId: string }[]>`
        SELECT booking_id AS "bookingId" FROM booking_resource_assignments
        WHERE tenant_id=${tenantId} AND resource_id=${resource.id} AND released_at IS NULL
      `;
      await expect.poll(async () => (await assignments()).length).toBe(1);
      const [assigned] = await assignments();
      const winnerIndex = bookings.findIndex((booking) => booking.id === assigned.bookingId);
      const loserIndex = 1 - winnerIndex;
      const winner = bookings[winnerIndex];
      const moving = bookings[loserIndex];
      await expect(drawer(pages[loserIndex], moving).getByRole("alert")).toHaveText("This resource is already assigned for this appointment time.");
      expect(await assignments()).toHaveLength(1);
      const [contact] = await sql`
        SELECT c.phone FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
        WHERE b.id=${moving.id} AND b.tenant_id=${tenantId}
      `;
      expect(contact?.phone).toBeNull();

      await drawer(pages[winnerIndex], winner).getByRole("button", { name: "Cancel appointment" }).click();
      await expect(drawer(pages[winnerIndex], winner).getByText("This appointment has been cancelled.", { exact: false })).toBeVisible();
      await expect.poll(async () => (await assignments()).length).toBe(0);
      expect(await availableAt(winner.memberId, "10:00")).toBe(true);

      const readBooking = async () => {
        const [booking] = await sql<{ state: string; status: string; startsAt: Date; memberId: string; locationId: string }[]>`
          SELECT b.status, b.starts_at AS "startsAt", b.team_member_id AS "memberId", b.location_id AS "locationId", bb.state
          FROM bookings b JOIN booking_blocks bb ON bb.id=b.booking_block_id AND bb.tenant_id=b.tenant_id
          WHERE b.tenant_id=${tenantId} AND b.id=${moving.id}
        `;
        return { ...booking, startsAt: booking.startsAt.toISOString() };
      };
      await page.goto(`${calendar}&booking=${moving.id}`);
      const pendingMove = drawer(page, moving);
      await pendingMove.getByRole("combobox", { name: "Resource", exact: true }).selectOption(resource.id);
      await pendingMove.getByRole("button", { name: "Save changes" }).click();
      await expect.poll(assignments).toEqual([{ bookingId: moving.id }]);
      const source = page.locator(`a.waybook-week-calendar__entry[href*="booking=${moving.id}"]`);
      await page.goto(`${calendar}&employee=${moving.memberId}`);
      await expect(source.getByRole("img", { name: `Resource: ${resource.name}`, exact: true })).toBeVisible();
      await page.goto(calendar);
      await expect(source.getByRole("img", { name: `Resource: ${resource.name}`, exact: true })).toBeVisible();

      if (testInfo.project.name.startsWith("desktop")) {
        const destination = page.locator(`[data-calendar-team-member-id="${moving.memberId}"][data-calendar-starts-at="${day}T11:30"]`);
        async function prepareDrop() {
          await source.scrollIntoViewIfNeeded();
          const sourceBounds = (await source.boundingBox())!;
          const x = sourceBounds.x + sourceBounds.width / 2;
          const y = sourceBounds.y + sourceBounds.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + 8, y + 8);
          await expect(destination).toHaveClass(/is-drop-eligible/);
          const drop = (await destination.boundingBox())!;
          await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 3 });
          await page.mouse.move(drop.x + drop.width / 2 + 1, drop.y + drop.height / 2);
          await expect(destination).toHaveClass(/is-drop-target/);
        }
        const beforeInterruptedMove = await readBooking();
        const beforeAssignments = await assignments();
        await prepareDrop();
        const calendarRequests = `**/${workspace.route}/app/calendars**`;
        let interrupted = false;
        await page.route(calendarRequests, async (route) => {
          if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
            interrupted = true;
            await route.abort("failed");
          } else await route.continue();
        });
        await page.mouse.up();
        await expect(page.locator(".calendar-drag-feedback")).toContainText("Could not confirm the move.");
        await page.unroute(calendarRequests);
        expect(interrupted).toBe(true);
        expect(await readBooking()).toEqual(beforeInterruptedMove);
        expect(await assignments()).toEqual(beforeAssignments);

        await page.reload();
        await prepareDrop();
        await page.mouse.up();
        await expect(page.locator(".calendar-drag-feedback")).toContainText("Appointment moved.");
        expect(await assignments()).toEqual(beforeAssignments);
      } else {
        await page.goto(`${calendar}&booking=${moving.id}`);
        const panel = drawer(page, moving);
        const date = panel.locator(".appointment-reschedule-picker__day").filter({ hasText: day.slice(-2) });
        const slot = panel.getByRole("button", { name: "11:30", exact: true });
        const reschedule = panel.getByRole("button", { name: "Reschedule appointment" });
        const nextWeek = panel.getByRole("button", { name: "Next week" });
        await date.click();
        await slot.click();

        const beforeUnavailableWeek = await readBooking();
        const calendarRequests = `**/${workspace.route}/app/calendars**`;
        let interrupted = false;
        await page.route(calendarRequests, async (route) => {
          if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
            interrupted = true;
            await route.abort("failed");
          } else await route.continue();
        });
        await nextWeek.click();
        const alert = panel.getByRole("alert").filter({ hasText: "Could not load availability." });
        await expect(alert).toBeVisible();
        await page.unroute(calendarRequests);
        expect(interrupted).toBe(true);
        await expect(slot).toHaveAttribute("aria-pressed", "true");
        await expect(reschedule).toBeEnabled();
        expect(await readBooking()).toEqual(beforeUnavailableWeek);

        await nextWeek.click();
        const previousWeek = panel.getByRole("button", { name: "Previous week" });
        await expect(previousWeek).toBeEnabled();
        await expect(alert).toHaveCount(0);
        await previousWeek.click();
        await date.click();
        await slot.click();
        await reschedule.click();
      }

      await expect.poll(readBooking).toMatchObject({ state: "confirmed", status: "confirmed", startsAt: start("11:30"), memberId: moving.memberId, locationId: location.id });
      expect(await assignments()).toEqual([{ bookingId: moving.id }]);
      expect(await availableAt(moving.memberId, "10:00")).toBe(true);
      expect(await availableAt(moving.memberId, "11:30")).toBe(false);

      await page.goto(`${calendar}&booking=${moving.id}`);
      const panel = drawer(page, moving);
      await panel.getByRole("button", { name: "Cancel appointment" }).click();
      await expect(panel.getByText("This appointment has been cancelled.", { exact: false })).toBeVisible();
      await expect.poll(readBooking).toMatchObject({ state: "cancelled", status: "cancelled" });
      expect(await assignments()).toEqual([]);
      await expect(panel.getByRole("button", { name: "Reschedule appointment" })).toHaveCount(0);
      expect(await availableAt(moving.memberId, "11:30")).toBe(true);
    } finally {
      await secondPage.close();
      // Keep audit history in the disposable database while hiding these fixtures from later tests.
      await sql`UPDATE team_members SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=ANY(${staffIds}::uuid[])`;
      await sql`UPDATE resources SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${resource.id}`;
      await sql`UPDATE services SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${service.id}`;
      await sql`UPDATE locations SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${location.id}`;
      try {
        if (!resourcesFeature.is_enabled) {
          await control`UPDATE tenant_feature_states SET is_enabled=false WHERE tenant_id=${tenantId} AND feature_key='resources'`;
        }
      } finally {
        await Promise.all([sql.end(), control.end()]);
      }
    }
  });
}
