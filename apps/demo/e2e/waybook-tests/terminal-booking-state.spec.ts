import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("a terminal status committed after preflight cannot be moved or dragged", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const raw = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const url = new URL(raw);
  if (![["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname), url.pathname.startsWith("/waybook_e2e_")].every(Boolean)) {
    throw new Error("Terminal-state test requires a disposable Waybook database.");
  }
  const db = postgres(raw, { max: 3, ssl: false });
  const unique = randomUUID().replaceAll("-", "").slice(0, 12);
  let bookingId: string | null = null;
  let blockId: string | null = null;
  let customerId: string | null = null;
  let completedBookingId: string | null = null;
  let completedBlockId: string | null = null;
  let completedCustomerId: string | null = null;
  let editBookingId: string | null = null;
  let editBlockId: string | null = null;
  let editCustomerId: string | null = null;
  try {
    const [settings] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings LIMIT 1`;
    const [member] = await db<{ id: string; locationId: string }[]>`SELECT tm.id,tml.location_id AS "locationId" FROM team_members tm JOIN team_member_locations tml ON tml.tenant_id=tm.tenant_id AND tml.team_member_id=tm.id WHERE tm.tenant_id=${settings.tenantId} LIMIT 1`;
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${settings.tenantId} AND slug='studio-session'`;
    const fixtureDate = new Date("2031-01-01T12:00:00Z");
    fixtureDate.setUTCDate(fixtureDate.getUTCDate() + (Number.parseInt(unique.slice(0, 6), 16) % 365));
    const day = fixtureDate.toISOString().slice(0, 10);
    const fixture = await db.begin(async (tx) => {
      const [customer] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},${`Terminal guard ${unique}`},${`terminal-${unique}@example.invalid`}) RETURNING id`;
      const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${member.locationId},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed') RETURNING id`;
      const [booking] = await tx<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents) VALUES (${settings.tenantId},${block.id},${service.id},${member.id},${member.locationId},${customer.id},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed','tenant',1000) RETURNING id`;
      const [completedCustomer] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},${`Completed guard ${unique}`},${`completed-${unique}@example.invalid`}) RETURNING id`;
      const [completedBlock] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${member.locationId},${`${day}T11:00:00Z`},${`${day}T12:00:00Z`},'confirmed') RETURNING id`;
      const [completedBooking] = await tx<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents) VALUES (${settings.tenantId},${completedBlock.id},${service.id},${member.id},${member.locationId},${completedCustomer.id},${`${day}T11:00:00Z`},${`${day}T12:00:00Z`},'completed','tenant',1000) RETURNING id`;
      const [editCustomer] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},${`Edit guard ${unique}`},${`edit-${unique}@example.invalid`}) RETURNING id`;
      const [editBlock] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${member.locationId},${`${day}T13:00:00Z`},${`${day}T14:00:00Z`},'confirmed') RETURNING id`;
      const [editBooking] = await tx<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents) VALUES (${settings.tenantId},${editBlock.id},${service.id},${member.id},${member.locationId},${editCustomer.id},${`${day}T13:00:00Z`},${`${day}T14:00:00Z`},'confirmed','tenant',1000) RETURNING id`;
      return { customer, block, booking, completedCustomer, completedBlock, completedBooking, editCustomer, editBlock, editBooking };
    });
    bookingId = fixture.booking.id;
    blockId = fixture.block.id;
    customerId = fixture.customer.id;
    completedBookingId = fixture.completedBooking.id;
    completedBlockId = fixture.completedBlock.id;
    completedCustomerId = fixture.completedCustomer.id;
    editBookingId = fixture.editBooking.id;
    editBlockId = fixture.editBlock.id;
    editCustomerId = fixture.editCustomer.id;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/nordic\/app/, { timeout: 30_000 });
    await page.goto(`/nordic/app/calendars?view=team&day=${day}&booking=${editBookingId}`);
    const attemptedName = `Blocked edit ${unique}`;
    let staleSaveSeen = false;
    await page.route("**/nordic/app/calendars**", async (route) => {
      if (route.request().method() !== "POST" || !route.request().headers()["next-action"] || staleSaveSeen) {
        await route.continue();
        return;
      }
      staleSaveSeen = true;
      // The visible drawer was opened while active; cancellation wins before
      // the real detail-save action can acquire its booking row lock.
      await db.unsafe("UPDATE bookings SET status='cancelled' WHERE id=$1 AND tenant_id=$2", [editBookingId, settings.tenantId]);
      await route.continue();
    });
    await page.getByLabel("Customer name").fill(attemptedName);
    const staleSaveResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && Boolean(response.request().headers()["next-action"])
      && response.url().includes("/nordic/app/calendars"),
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await staleSaveResponse).status()).toBeGreaterThanOrEqual(400);
    expect(staleSaveSeen).toBe(true);
    const [afterStaleSave] = await db<{ name: string; resourceAssignments: number; bookingEvents: number; auditEvents: number }[]>`SELECT c.name,(SELECT count(*)::int FROM booking_resource_assignments WHERE tenant_id=${settings.tenantId} AND booking_id=${editBookingId} AND released_at IS NULL) AS "resourceAssignments",(SELECT count(*)::int FROM booking_events WHERE tenant_id=${settings.tenantId} AND booking_id=${editBookingId}) AS "bookingEvents",(SELECT count(*)::int FROM tenant_audit_events WHERE tenant_id=${settings.tenantId} AND target_type='booking' AND target_id=${editBookingId}) AS "auditEvents" FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id WHERE b.id=${editBookingId}`;
    expect(afterStaleSave).toMatchObject({ name: `Edit guard ${unique}`, resourceAssignments: 0, bookingEvents: 0, auditEvents: 0 });
    await page.unroute("**/nordic/app/calendars**");
    await page.goto(`/nordic/app/calendars?view=team&day=${day}`);
    const card = page.locator(`a.waybook-week-calendar__entry[href*="booking=${bookingId}"]`);
    await expect(card).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await db.unsafe("UPDATE bookings SET status='no_show' WHERE id=$1 AND tenant_id=$2", [bookingId, settings.tenantId]);
      await page.goto(`/nordic/app/calendars?view=team&day=${day}&booking=${bookingId}`);
      await expect(card).toHaveAttribute("draggable", "false");
      await expect(page.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
      await page.goto(`/nordic/app/calendars?view=team&day=${day}&booking=${completedBookingId}`);
      const completedCard = page.locator(`a.waybook-week-calendar__entry[href*="booking=${completedBookingId}"]`);
      await expect(completedCard).toHaveAttribute("draggable", "false");
      await expect(page.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Edit" })).toBeVisible();
      return;
    }
    await card.scrollIntoViewIfNeeded();
    const sourceBox = await card.boundingBox();
    expect(sourceBox).toBeTruthy();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 8, sourceBox!.y + sourceBox!.height / 2 + 8);
    await expect(page.locator(".calendar-drag-feedback")).toContainText("verified destination");
    const candidates = page.locator("[data-calendar-drop-cell='true'].is-drop-eligible");
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    let destinationIndex = -1;
    for (let index = 0; index < await candidates.count(); index++) {
      const bounds = await candidates.nth(index).boundingBox();
      if (bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height) {
        destinationIndex = index;
        break;
      }
    }
    expect(destinationIndex).toBeGreaterThanOrEqual(0);
    const destination = candidates.nth(destinationIndex);
    const destinationBox = await destination.boundingBox();
    expect(destinationBox).toBeTruthy();

    let changedAfterPreflight = false;
    await page.route("**/nordic/app/calendars**", async (route) => {
      if (route.request().method() !== "POST" || !route.request().headers()["next-action"] || changedAfterPreflight) {
        await route.continue();
        return;
      }
      changedAfterPreflight = true;
      await db.begin(async (tx) => {
        // Hold the first lock in production order while the real action repeats
        // its server-side preflight. It then waits at its write transaction.
        await tx.unsafe("SELECT id FROM booking_blocks WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [blockId, settings.tenantId]);
        const continued = route.continue();
        let actionIsBlocked = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const [waiter] = await db.unsafe<{ count: number }[]>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%booking_blocks%'", []);
          if (waiter && waiter.count > 0) {
            actionIsBlocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(actionIsBlocked).toBe(true);
        // Commit the final state immediately before releasing the action's
        // blocked block lock. Its transaction must re-read this status.
        await tx.unsafe("UPDATE bookings SET status='no_show' WHERE id=$1 AND tenant_id=$2", [bookingId, settings.tenantId]);
        await continued;
      });
    });
    await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + destinationBox!.height / 2);
    await page.mouse.up();
    await expect(page.locator(".calendar-drag-feedback")).toContainText("Only confirmed or arrived appointments can be moved.");
    expect(changedAfterPreflight).toBe(true);
    const [locked] = await db<{ state: string; status: string; startsAt: Date }[]>`SELECT bb.state,b.status,b.starts_at AS "startsAt" FROM bookings b JOIN booking_blocks bb ON bb.id=b.booking_block_id WHERE b.id=${bookingId}`;
    expect(locked).toMatchObject({ state: "confirmed", status: "no_show" });
    expect(locked.startsAt.toISOString()).toBe(`${day}T09:00:00.000Z`);
    await page.goto(`/nordic/app/calendars?view=team&day=${day}&booking=${bookingId}`);
    await expect(card).toHaveAttribute("draggable", "false");
    await expect(page.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
    await page.goto(`/nordic/app/calendars?view=team&day=${day}&booking=${completedBookingId}`);
    const completedCard = page.locator(`a.waybook-week-calendar__entry[href*="booking=${completedBookingId}"]`);
    await expect(completedCard).toHaveAttribute("draggable", "false");
    await expect(page.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
    // Completed appointments retain their existing edit and payment workflow.
    await expect(page.getByRole("heading", { name: "Edit" })).toBeVisible();
  } finally {
    for (const id of [bookingId, completedBookingId, editBookingId].filter((id): id is string => Boolean(id))) {
      await db.begin(async (tx) => {
        // Booking creation materializes a draft sale and its service line.
        // This synthetic fixture never writes immutable sale/audit entries.
        await tx.unsafe("DELETE FROM commerce_sale_lines WHERE sale_id IN (SELECT id FROM commerce_sales WHERE booking_id=$1)", [id]);
        await tx.unsafe("DELETE FROM commerce_sales WHERE booking_id=$1", [id]);
        await tx.unsafe("DELETE FROM bookings WHERE id=$1", [id]);
      });
    }
    if (blockId) await db.unsafe("DELETE FROM booking_blocks WHERE id=$1", [blockId]);
    if (customerId) await db.unsafe("DELETE FROM customers WHERE id=$1", [customerId]);
    if (completedBlockId) await db.unsafe("DELETE FROM booking_blocks WHERE id=$1", [completedBlockId]);
    if (completedCustomerId) await db.unsafe("DELETE FROM customers WHERE id=$1", [completedCustomerId]);
    if (editBlockId) await db.unsafe("DELETE FROM booking_blocks WHERE id=$1", [editBlockId]);
    if (editCustomerId) await db.unsafe("DELETE FROM customers WHERE id=$1", [editCustomerId]);
    await db.end();
  }
});
