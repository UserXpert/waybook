import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

function localDayAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  const day = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function localWeekdayAfter(days: number) {
  const day = new Date(`${localDayAfter(days)}T12:00:00Z`);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

test("concurrent confirmation retries are idempotent without leaking another booking", { tag: "@smoke" }, async ({ request }) => {
  test.setTimeout(90_000);
  const raw = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const database = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(database.hostname) || !database.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Confirmation concurrency tests require a disposable local database.");
  }
  const db = postgres(raw, { max: 1, ssl: false });
  const suffix = randomUUID();
  const email = `confirmation-${suffix}@example.test`;
  const key = `confirmation-${suffix}`;
  const conflictKey = `cross-hold-${suffix}`;
  const triggerName = `confirmation_idempotency_delay_${suffix.replaceAll("-", "")}`;
  let delayFunctionCreated = false;
  let locationId: string | null = null;
  let tenantId: string | null = null;
  const rangeStart = new Date(Date.now() + 60_000);
  const rangeEnd = new Date(rangeStart.getTime() + 4 * 86_400_000 - 60_000);
  try {
    // The seed creates services before tenant settings, so the migration's
    // one-time primary-location backfill does not apply to a fresh fixture.
    // Set up a test-only online location while retaining the actual public API
    // request below as the booking path under test.
    const [settings] = await db<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_settings LIMIT 1`;
    tenantId = settings!.tenantId;
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${settings!.tenantId} AND slug='studio-session' LIMIT 1`;
    const [member] = await db<{ id: string }[]>`
      SELECT tm.id FROM team_members tm
      JOIN service_team_members stm ON stm.tenant_id=tm.tenant_id AND stm.team_member_id=tm.id AND stm.service_id=${service!.id}
      JOIN availability_rules ar ON ar.tenant_id=tm.tenant_id AND ar.team_member_id=tm.id
      WHERE tm.tenant_id=${settings!.tenantId} AND tm.is_active=TRUE
      ORDER BY tm.created_at,tm.id LIMIT 1
    `;
    expect(member).toBeTruthy();
    const [location] = await db<{ id: string }[]>`INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${settings!.tenantId},${`idempotency-${suffix}`},'Idempotency test location','Europe/Copenhagen') RETURNING id`;
    locationId = location!.id;
    await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time) SELECT ${settings!.tenantId},${location!.id},day,'00:00','23:59' FROM generate_series(0,6) AS day`;
    await db`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${settings!.tenantId},${member!.id},${location!.id})`;
    await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${settings!.tenantId},${service!.id},${location!.id})`;
    const availability = await request.get(`/nordic/api/public/availability?service=${service!.id}&location=${location!.id}&start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(rangeEnd.toISOString())}`);
    expect(availability.status()).toBe(200);
    const distinctSlots = (await availability.json() as { availability: Array<{ slots: Array<{ startTime: string; endTime: string }> }> }).availability
      .flatMap((provider) => provider.slots)
      .filter((slot, index, all) => all.findIndex((candidate) => candidate.startTime === slot.startTime && candidate.endTime === slot.endTime) === index);
    const slots = distinctSlots.reduce<Array<{ startTime: string; endTime: string }>>((selected, slot) => (
      selected.some((other) => new Date(slot.startTime) < new Date(other.endTime) && new Date(slot.endTime) > new Date(other.startTime)) ? selected : [...selected, slot]
    ), []);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    const reserve = async (slot: { startTime: string; endTime: string }) => {
      const response = await request.post("/nordic/api/public/holds", { data: { serviceId: service!.id, locationId: location!.id, startsAt: slot.startTime, endsAt: slot.endTime } });
      expect(response.status()).toBe(201);
      return (await response.json() as { holdId: string }).holdId;
    };
    const [primaryHold, firstConflictHold, secondConflictHold] = await Promise.all([reserve(slots[0]!), reserve(slots[1]!), reserve(slots[2]!)]);
    const body = { holdId: primaryHold, idempotencyKey: key, customer: { name: "Concurrent confirmation", email } };
    const responses = await Promise.all([request.post("/nordic/api/public/confirmations", { data: body }), request.post("/nordic/api/public/confirmations", { data: body })]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(async (response) => response.json() as Promise<{ booking: { id: string; bookingNumber: string; startsAt: string; endsAt: string }; managementToken: string | null; idempotent: boolean }>));
    expect(results[0]!.booking.id).toBe(results[1]!.booking.id);
    const retry = results.find((result) => result.idempotent)!;
    expect(retry).toEqual({ booking: { id: results[0]!.booking.id, bookingNumber: expect.any(String), startsAt: expect.any(String), endsAt: expect.any(String) }, managementToken: null, idempotent: true });

    const [counts] = await db<{ bookings: number; confirmations: number; outbox: number; tokens: number; recipient: string }[]>`
      SELECT
        (SELECT count(*)::int FROM bookings WHERE id=${results[0]!.booking.id}) AS bookings,
        (SELECT count(*)::int FROM booking_events WHERE booking_id=${results[0]!.booking.id} AND event_type='booking.confirmed') AS confirmations,
        (SELECT count(*)::int FROM email_outbox WHERE booking_id=${results[0]!.booking.id} AND message_type='confirmation') AS outbox,
        (SELECT count(*)::int FROM customer_management_tokens WHERE booking_id=${results[0]!.booking.id}) AS tokens,
        (SELECT recipient FROM email_outbox WHERE booking_id=${results[0]!.booking.id} AND message_type='confirmation') AS recipient
    `;
    expect(counts).toEqual({ bookings: 1, confirmations: 1, outbox: 1, tokens: 1, recipient: email });

    // Widen the insert window so the separate holds contend on the same key,
    // rather than only exercising the already-committed collision path.
    await db.unsafe(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key = '${conflictKey}' THEN PERFORM pg_sleep(0.35); END IF; RETURN NEW; END $$`);
    delayFunctionCreated = true;
    await db.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
    const firstConflictEmail = `first-${suffix}@example.test`;
    const secondConflictEmail = `second-${suffix}@example.test`;
    const conflicting = await Promise.all([
      request.post("/nordic/api/public/confirmations", { data: { holdId: firstConflictHold, idempotencyKey: conflictKey, customer: { name: "First conflict", email: firstConflictEmail } } }),
      request.post("/nordic/api/public/confirmations", { data: { holdId: secondConflictHold, idempotencyKey: conflictKey, customer: { name: "Second conflict", email: secondConflictEmail } } }),
    ]);
    expect(conflicting.map((response) => response.status()).sort()).toEqual([201, 409]);
    const conflictBodies = await Promise.all(conflicting.map(async (response) => response.json() as Promise<{ booking?: { id: string }; error?: string; managementToken?: unknown }>));
    const winner = conflictBodies.find((body) => body.booking)!;
    const collision = conflictBodies.find((body) => body.error)!;
    expect(collision).toEqual({ error: "This confirmation key is already in use. Please restart your booking." });
    expect(JSON.stringify(collision)).not.toContain(firstConflictEmail);
    expect(JSON.stringify(collision)).not.toContain(secondConflictEmail);
    const [conflictCounts] = await db<{ bookings: number; confirmations: number; outbox: number; tokens: number }[]>`
      SELECT
        (SELECT count(*)::int FROM bookings WHERE id=${winner.booking!.id}) AS bookings,
        (SELECT count(*)::int FROM booking_events WHERE booking_id=${winner.booking!.id} AND event_type='booking.confirmed') AS confirmations,
        (SELECT count(*)::int FROM email_outbox WHERE booking_id=${winner.booking!.id} AND message_type='confirmation') AS outbox,
        (SELECT count(*)::int FROM customer_management_tokens WHERE booking_id=${winner.booking!.id}) AS tokens
    `;
    expect(conflictCounts).toEqual({ bookings: 1, confirmations: 1, outbox: 1, tokens: 1 });
  } finally {
    try {
      if (delayFunctionCreated) {
        try {
          await db.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON bookings`);
        } finally {
          await db.unsafe(`DROP FUNCTION IF EXISTS ${triggerName}()`);
        }
      }
    } finally {
      try {
        // Keep referenced booking records intact, but remove this synthetic
        // location from future public availability and fixture joins.
        if (locationId && tenantId) {
          try {
            await db`DELETE FROM team_member_locations WHERE tenant_id=${tenantId} AND location_id=${locationId}`;
          } finally {
            try {
              await db`DELETE FROM service_locations WHERE tenant_id=${tenantId} AND location_id=${locationId}`;
            } finally {
              try {
                await db`DELETE FROM location_hours WHERE tenant_id=${tenantId} AND location_id=${locationId}`;
              } finally {
                await db`UPDATE locations SET is_active=FALSE,is_online_bookable=FALSE WHERE id=${locationId} AND tenant_id=${tenantId}`;
              }
            }
          }
        }
      } finally {
        await db.end({ timeout: 5 });
      }
    }
  }
});

test("confirmation rejects malformed embed context without blocking direct bookings", async ({ request }) => {
  // A nonexistent hold exercises the route without creating a booking. A
  // direct request reaches normal hold validation; malformed contexts do not.
  const base = {
    holdId: "00000000-0000-4000-8000-000000000000",
    idempotencyKey: "embed-context-route-check",
    customer: { name: "Route verifier", email: "route-verifier@example.test" },
  };
  const direct = await request.post("/nordic/api/public/confirmations", { data: base });
  expect(direct.status()).toBe(409);
  expect(await direct.json()).toEqual({ error: "This hold is no longer available." });

  for (const context of [
    { embedSource: null, embedToken: null },
    { embedSource: 42, embedToken: false },
    { embedSource: {}, embedToken: [] },
    { embedSource: "", embedToken: "" },
    { embedSource: "https://example.test" },
    { embedToken: "invalid" },
  ]) {
    const response = await request.post("/nordic/api/public/confirmations", { data: { ...base, ...context } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("embedded booking session") });
  }
});

test("a signed embed booking is confirmed with verified-source audit attribution", async ({ request }) => {
  const raw = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  // Confirmation records append-only audit/event history. It therefore keeps
  // its successful fixture only in this explicitly guarded disposable DB.
  const db = postgres(raw, { max: 1, ssl: false });
  const suffix = randomUUID();
  const source = `https://embed-e2e-${suffix}.example.test`;
  const idempotencyKey = `embed-e2e-${suffix}`;
  const customerEmail = `embed-${suffix}@example.test`;
  try {
    const [settings] = await db<{ tenantId: string; bookingPage: Record<string, unknown> | string | null }[]>`SELECT tenant_id AS "tenantId",booking_page AS "bookingPage" FROM tenant_settings LIMIT 1`;
    if (!settings) throw new Error('Nordic E2E tenant settings are missing.');
    const originalBookingPage = settings.bookingPage;
    const originalBookingPageJson = originalBookingPage == null ? null : typeof originalBookingPage === 'string' ? originalBookingPage : JSON.stringify(originalBookingPage);
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${settings.tenantId} AND slug='studio-session' AND is_active=TRUE`;
    if (!service) throw new Error('Nordic E2E studio-session service is missing.');
    const parsedBookingPage = typeof originalBookingPage === 'string' ? JSON.parse(originalBookingPage) as unknown : originalBookingPage;
    const bookingPage = parsedBookingPage && typeof parsedBookingPage === 'object' && !Array.isArray(parsedBookingPage) ? parsedBookingPage as Record<string, unknown> : {};
    const configuredOrigins = Array.isArray(bookingPage.embedOrigins) ? bookingPage.embedOrigins.filter((value): value is string => typeof value === 'string') : [];
    await db`UPDATE tenant_settings SET booking_page=${JSON.stringify({ ...bookingPage, embedOrigins: [...new Set([...configuredOrigins, source])] })}::jsonb WHERE tenant_id=${settings.tenantId}`;

    try {
      const embed = await request.get(`/nordic/embed?source=${encodeURIComponent(source)}`);
      expect(embed.status()).toBe(200);
      const html = await embed.text();
      const iframeUrl = html.match(/<iframe[^>]+src="([^"]+)"/)?.[1];
      expect(iframeUrl).toBeTruthy();
      const signedBookingUrl = new URL(iframeUrl!.replaceAll("&amp;", "&"), embed.url());
      expect(signedBookingUrl.origin).toBe(new URL(embed.url()).origin);
      expect(signedBookingUrl.pathname).toBe("/nordic/book");
      expect(signedBookingUrl.searchParams.get('embedSource')).toBe(source);
      const embedToken = signedBookingUrl.searchParams.get('embedToken');
      expect(embedToken).toBeTruthy();
      const token = embedToken!;

      const firstDay = localWeekdayAfter(3);
      const lastDay = new Date(`${firstDay}T12:00:00.000Z`);
      lastDay.setUTCDate(lastDay.getUTCDate() + 3);
      const availability = await request.get(`/nordic/api/public/availability?service=${service.id}&start=${encodeURIComponent(`${firstDay}T00:00:00.000Z`)}&end=${encodeURIComponent(`${lastDay.toISOString().slice(0, 10)}T23:59:59.999Z`)}`);
      expect(availability.status()).toBe(200);
      const payload = await availability.json() as { availability: Array<{ slots: Array<{ startTime: string; endTime: string }> }> };
      const slot = payload.availability.flatMap((provider) => provider.slots)[0];
      expect(slot).toBeTruthy();

      const hold = await request.post('/nordic/api/public/holds', { data: { serviceId: service.id, startsAt: slot.startTime, endsAt: slot.endTime } });
      expect(hold.status()).toBe(201);
      const holdPayload = await hold.json() as { holdId: string };
      const tamperedToken = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
      const tampered = await request.post('/nordic/api/public/confirmations', { data: {
        holdId: holdPayload.holdId,
        idempotencyKey,
        customer: { name: 'Embedded booking E2E', email: customerEmail },
        embedSource: source,
        embedToken: tamperedToken,
      } });
      expect(tampered.status()).toBe(400);
      expect(await tampered.json()).toMatchObject({ error: expect.stringContaining('embedded booking session') });
      const [afterTamper] = await db<{ bookings: number; audits: number; outbox: number }[]>`
        SELECT
          (SELECT count(*)::int FROM bookings WHERE tenant_id=${settings.tenantId} AND hold_id=${holdPayload.holdId}) AS bookings,
          (SELECT count(*)::int FROM tenant_audit_events WHERE tenant_id=${settings.tenantId} AND action='booking.embed_source_verified' AND metadata->>'source'=${source}) AS audits,
          (SELECT count(*)::int FROM email_outbox WHERE tenant_id=${settings.tenantId} AND recipient=${customerEmail}) AS outbox
      `;
      expect(afterTamper).toEqual({ bookings: 0, audits: 0, outbox: 0 });
      const confirmation = await request.post('/nordic/api/public/confirmations', { data: {
        holdId: holdPayload.holdId,
        idempotencyKey,
        customer: { name: 'Embedded booking E2E', email: customerEmail },
        embedSource: source,
        embedToken: token,
      } });
      expect(confirmation.status()).toBe(201);
      const result = await confirmation.json() as { booking: { id: string } };
      const [audit] = await db<{ metadata: { source?: string } | string }[]>`SELECT metadata FROM tenant_audit_events WHERE tenant_id=${settings.tenantId} AND action='booking.embed_source_verified' AND target_id=${result.booking.id}`;
      expect(audit).toBeTruthy();
      const metadata = typeof audit.metadata === 'string' ? JSON.parse(audit.metadata) as { source?: string } : audit.metadata;
      expect(metadata).toEqual({ source });
    } finally {
      if (originalBookingPageJson === null) await db`UPDATE tenant_settings SET booking_page=NULL WHERE tenant_id=${settings.tenantId}`;
      else await db`UPDATE tenant_settings SET booking_page=${originalBookingPageJson}::jsonb WHERE tenant_id=${settings.tenantId}`;
    }
  } finally {
    await db.end();
  }
});

async function managementState(bookingNumber: string) {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  try {
    const [state] = await db<{ id: string; booking: { status: string } }[]>`
      SELECT b.id, to_jsonb(b) AS booking, to_jsonb(block) AS block,
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM booking_events e WHERE e.booking_id=b.id) AS events,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM tenant_audit_events a WHERE a.tenant_id=b.tenant_id AND a.target_type='booking' AND a.target_id=b.id::text) AS audit,
        (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM email_outbox o WHERE o.booking_id=b.id) AS outbox
      FROM bookings b JOIN booking_blocks block ON block.id=b.booking_block_id AND block.tenant_id=b.tenant_id
      WHERE b.booking_number=${bookingNumber}
    `;
    expect(state, "expected the test booking and its reserved block").toBeDefined();
    return state!;
  } finally {
    await db.end();
  }
}

test("customer books, reschedules and cancels without a stale confirmation", { tag: ["@smoke", "@mobile"] }, async ({ page }) => {
  test.setTimeout(120_000);
  const check = expect.configure({ timeout: 30_000 });
  const runId = `${Date.now()}-${test.info().retry}`;
  const customerName = `Waybook E2E customer ${runId}`;
  const customerEmail = `waybook-e2e-${runId}@example.test`;
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: /Studio session/ }).click();
  await page.getByRole("button", { name: "Next dates" }).click();
  const publicSlots = page.locator(".tenant-time-grid button");
  await check(publicSlots.first()).toBeVisible();
  await publicSlots.first().click();
  await page.getByLabel("Name", { exact: true }).fill(customerName);
  await page.getByLabel("Email", { exact: true }).fill(customerEmail);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await check(page.getByText("BOOKING CONFIRMED")).toBeVisible();
  const summary = await page.locator(".tenant-complete-stage").innerText();
  const number = summary.match(/Booking number:\s*([A-Z0-9]+)/)?.[1];
  check(number).toBeTruthy();

  // Management credentials are tenant scoped. A valid Nordic reference must
  // remain usable in Nordic, but cannot reveal the same booking through a
  // different public tenant route.
  const managementRequest = {
    headers: { Origin: new URL(page.url()).origin },
    data: { action: "lookup", bookingId: number!, email: customerEmail },
  };
  const ownLookup = await page.request.post("/nordic/api/public/manage", managementRequest);
  expect(ownLookup.status()).toBe(200);
  expect(await ownLookup.json()).toMatchObject({ booking: { service: "Studio session" } });
  // The Control domain registry assigns the same-origin route `copenhagen`
  // to the Copenhagen Physio tenant (`copenhagen.localhost`).  Its product
  // slug is deliberately not trusted as a path prefix.
  const otherPublicBookingPage = await page.request.get("/copenhagen/book");
  expect(otherPublicBookingPage.status()).toBe(200);
  const crossTenantLookup = await page.request.post("/copenhagen/api/public/manage", managementRequest);
  expect(crossTenantLookup.status()).toBe(404);
  expect(await crossTenantLookup.json()).toEqual({ error: "We couldn’t find a booking with those details." });

  async function findBooking() {
    await page.getByRole("button", { name: "Manage booking" }).click();
    await page.getByLabel("Booking number").fill(number!);
    await page.getByLabel("Email address").fill(customerEmail);
    await page.getByRole("button", { name: "Find booking" }).click();
    await check(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
  }
  await findBooking();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  const rescheduleDay = localWeekdayAfter(8);
  await page.getByLabel("Day").fill(rescheduleDay);
  const rescheduleSlots = page.locator(".booking-manage-times button");
  await check(rescheduleSlots.first()).toBeVisible();
  const timesResponse = await page.request.post("/nordic/api/public/manage", {
    ...managementRequest,
    data: {
      ...managementRequest.data, action: "availability",
      start: fromZonedTime(`${rescheduleDay}T00:00:00`, "Europe/Copenhagen").toISOString(),
      end: fromZonedTime(`${rescheduleDay}T23:59:59.999`, "Europe/Copenhagen").toISOString(),
    },
  });
  expect(timesResponse.status()).toBe(200);
  const { availability } = await timesResponse.json() as {
    availability: { slots: { startTime: string }[] }[];
  };
  const startsAt = availability.flatMap(provider => provider.slots).map(slot => slot.startTime).sort()[0];
  expect(startsAt).toBeTruthy();

  const beforeDenials = await managementState(number!);
  for (const action of ["cancel", "reschedule"] as const) {
    const data = { ...managementRequest.data, action, ...(action === "reschedule" ? { startsAt } : {}) };
    const mismatched = await page.request.post("/nordic/api/public/manage", {
      ...managementRequest, data: { ...data, email: "different-customer@example.test" },
    });
    expect(mismatched.status()).toBe(409);
    const crossTenant = await page.request.post("/copenhagen/api/public/manage", { ...managementRequest, data });
    expect(crossTenant.status()).toBe(409);
    const crossOrigin = await page.request.post("/nordic/api/public/manage", {
      headers: { Origin: "https://other-site.example.test" }, data,
    });
    expect(crossOrigin.status()).toBe(403);
  }
  expect(await managementState(number!)).toEqual(beforeDenials);

  // The supported UUID reference is fresh even after the requests using the public booking number.
  for (let attempt = 0; attempt < 20; attempt++) {
    const allowed = await page.request.post("/nordic/api/public/manage", {
      ...managementRequest, data: { ...managementRequest.data, bookingId: beforeDenials.id },
    });
    expect(allowed.status()).toBe(200);
  }
  const throttled = await page.request.post("/nordic/api/public/manage", {
    ...managementRequest, data: { ...managementRequest.data, bookingId: beforeDenials.id, action: "cancel" },
  });
  expect(throttled.status()).toBe(429);
  expect(await managementState(number!)).toEqual(beforeDenials);

  await rescheduleSlots.first().click();
  await page.getByRole("button", { name: "Confirm new time" }).click();
  await check(page.getByText("Your booking has been rescheduled.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await check(page.getByRole("button", { name: /Studio session/ })).toBeVisible();
  await check(page.getByText("BOOKING CONFIRMED")).toHaveCount(0);

  const calendar = await page.context().newPage();
  await calendar.goto("/login");
  await calendar.getByLabel("Work email").fill("owner@nordic.local");
  await calendar.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await calendar.getByRole("button", { name: "Sign in" }).click();
  await check(calendar).toHaveURL(/\/nordic\/app/);
  await calendar.goto(`/nordic/app/calendars?day=${rescheduleDay}`);
  await check(calendar.getByText(customerName, { exact: true })).toBeVisible();
  const bookingDay = rescheduleDay;
  await calendar.goto(`/nordic/app/calendars?view=month&day=${bookingDay}`);
  const monthDay = calendar.locator(`a.waybook-month-calendar__day-link[href*="day=${bookingDay}"]`);
  const monthCell = monthDay.locator("..");
  await check(monthCell).toContainText(/booking/);
  await check(monthCell.locator(".waybook-month-calendar__appointment").filter({ hasText: customerName })).toBeVisible();

  await findBooking();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await check(page.getByText("Your booking has been cancelled.")).toBeVisible();
  const cancelled = await managementState(number!);
  expect(cancelled.booking.status).toBe("cancelled");
  const terminalChange = await page.request.post("/nordic/api/public/manage", {
    ...managementRequest, data: { ...managementRequest.data, action: "reschedule", startsAt },
  });
  expect(terminalChange.status()).toBe(409);
  const repeatedCancellation = await page.request.post("/nordic/api/public/manage", {
    ...managementRequest, data: { ...managementRequest.data, action: "cancel" },
  });
  expect(repeatedCancellation.status()).toBe(200);
  expect(await managementState(number!)).toEqual(cancelled);
  await calendar.reload();
  await check(calendar.getByText(customerName, { exact: true })).toHaveCount(0);
  await calendar.close();
});

test("tenant owner can sign in but cannot access another workspace", { tag: ["@smoke", "@mobile"] }, async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  const own = await page.request.get("/nordic/api/app/clients");
  const other = await page.request.get("/copenhagen/api/app/clients");
  expect(own.status()).toBe(200);
  expect(other.status()).toBe(404);
});

async function chooseCalendarDate(page: import("@playwright/test").Page, value: string) {
  const picker = page.getByRole("dialog", { name: "Choose calendar date" });
  const target = new Date(`${value}T12:00:00Z`);
  await picker.getByLabel("Year", { exact: true }).selectOption(String(target.getUTCFullYear()));
  await picker.getByLabel("Month", { exact: true }).selectOption(String(target.getUTCMonth()));
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(target);
  await picker.getByRole("button", { name: label, exact: true }).click();
}

test("calendar date picker keeps an implicitly selected location", async ({ page }) => {
  const check = expect.configure({ timeout: 30_000 });
  const chosenDate = localDayAfter(26);
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await check(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/calendars?view=month");
  expect(new URL(page.url()).searchParams.has("location")).toBe(false);
  const context = page.locator(".waybook-month-calendar .waybook-calendar-toolbar > div").first().locator("span");
  const initiallySelectedLocation = await context.innerText();

  await page.locator(".calendar-date-picker > button").click();
  await chooseCalendarDate(page, chosenDate);
  await check(page).toHaveURL(new RegExp(`day=${chosenDate}`));
  expect(new URL(page.url()).searchParams.has("location")).toBe(true);
  await check(context).toHaveText(initiallySelectedLocation);
});

test("monthly calendar keeps all-staff scope and shows every booking for a day", async ({ page }) => {
  const check = expect.configure({ timeout: 30_000 });
  const monthDay = localDayAfter(10);
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await check(page).toHaveURL(/\/nordic\/app/);
  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);
  await page.locator(".calendar-date-picker > button").click();
  await chooseCalendarDate(page, monthDay);
  await check(page).toHaveURL(new RegExp(`day=${monthDay}`));

  const day = page.locator(`a.waybook-month-calendar__day-link[href*="day=${monthDay}"]`);
  const dayCell = day.locator("..");
  await check(dayCell).toContainText("3 bookings");
  await check(dayCell.locator(".waybook-month-calendar__appointment")).toHaveCount(3);
  const dayView = page.getByRole("link", { name: "Day", exact: true });
  expect(await dayView.getAttribute("href")).not.toContain("employee=");
  await dayView.click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await check(page.locator(".team-day-calendar")).toBeVisible();
  await check(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute("href", /employee=[^&]+&view=staff/);
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await check(page.locator(".waybook-month-calendar")).toBeVisible();
  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);
  await day.focus();
  await page.keyboard.press("Enter");
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await check(page).toHaveURL(new RegExp(`view=team.*day=${monthDay}`));
  await check(page.locator(".team-day-calendar")).toBeVisible();

  await page.goto(`/nordic/app/calendars?view=month&day=${monthDay}`);
  await page.getByLabel("Next month").click();
  expect(new URL(page.url()).searchParams.has("employee")).toBe(false);
  await page.getByLabel("Previous month").click();
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Staff").fill("Z E2E roster 21");
  await page.getByRole("option", { name: "Z E2E roster 21" }).click();
  await check(page).toHaveURL(/employee=/);
  const allStaffDay = page.getByRole("link", { name: "Day", exact: true });
  await check(allStaffDay).toHaveAttribute("href", /view=team/);
  expect(await allStaffDay.getAttribute("href")).not.toContain("employee=");
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await check(page).toHaveURL(/view=staff/);
  await check(page.getByRole("heading", { name: "Z E2E roster 21", exact: true })).toBeVisible();
  await check(page.locator(".waybook-week-calendar")).toBeVisible();
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await check(page).toHaveURL(/view=month/);
  await check(page.locator(".waybook-month-calendar")).toBeVisible();
  // The Week-to-Month switch can land in a different month near a boundary.
  await page.locator(".calendar-date-picker > button").click();
  await chooseCalendarDate(page, monthDay);
  await check.poll(() => {
    const params = new URL(page.url()).searchParams;
    return [params.get("view"), params.get("day")];
  }).toEqual(["month", monthDay]);
  expect(new URL(page.url()).searchParams.has("employee")).toBe(true);
  const scopedDay = page.locator(`a.waybook-month-calendar__day-link[href*="day=${monthDay}"]`).locator("..");
  await check(scopedDay).toContainText("1 booking");
  await check(scopedDay.locator(".waybook-month-calendar__appointment")).toContainText("Monthly calendar 15");
});

test("changing the reschedule day ignores an older availability response", async ({ page }) => {
  let firstAvailabilityStarted!: () => void;
  const firstAvailability = new Promise<void>(resolve => { firstAvailabilityStarted = resolve; });
  let requests = 0;
  await page.route("**/nordic/api/public/manage", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "lookup") {
      await route.fulfill({ json: { booking: { service: "Studio session", location: "Preview location", startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), status: "confirmed", canChange: true, canCancel: true } } });
      return;
    }
    if (body.action === "availability") {
      const current = ++requests;
      if (current === 1) { firstAvailabilityStarted(); await new Promise(resolve => setTimeout(resolve, 1500)); }
      const day = current === 1 ? localDayAfter(0) : localDayAfter(2);
      const hour = current === 1 ? "09:00" : "14:00";
      const { fromZonedTime } = await import("date-fns-tz");
      const startTime = fromZonedTime(`${day}T${hour}:00`, "Europe/Copenhagen").toISOString();
      await route.fulfill({ json: { availability: [{ slots: [{ startTime, endTime: new Date(new Date(startTime).getTime() + 3600000).toISOString() }] }] } });
      return;
    }
    await route.abort();
  });
  await page.goto("/nordic/book");
  await page.getByRole("button", { name: "Manage booking" }).click();
  await page.getByLabel("Booking number").fill("TEST123");
  await page.getByLabel("Email address").fill("preview@example.invalid");
  await page.getByRole("button", { name: "Find booking" }).click();
  await page.getByRole("button", { name: "Reschedule booking" }).click();
  await firstAvailability;
  await page.getByLabel("Day").fill(localDayAfter(2));
  await expect(page.getByRole("button", { name: "14:00", exact: true })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByRole("button", { name: "14:00", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "09:00", exact: true })).toHaveCount(0);
});
