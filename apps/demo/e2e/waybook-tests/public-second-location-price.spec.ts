import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`public booking preserves second location, staff, time and price in ${tenant.route}`, async ({ page, browser, baseURL, hasTouch, ignoreHTTPSErrors }) => {
  page.setDefaultTimeout(8000);
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const locationName = `Second location QA ${tag}`;
  const serviceName = `Second location service ${tag}`;
  const staffName = `Second location staff ${tag}`;
  const customerName = `Second location customer ${tag}`;
  const email = `public-location-${tag}@example.test`;
  const price = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" }).format(250.75);
  const owner = await browser.newContext({ baseURL, ignoreHTTPSErrors, viewport: page.viewportSize() ?? undefined });
  try {
    const [settings] = await db`SELECT tenant_id,timezone,((now() AT TIME ZONE timezone)::date+3)::text AS day FROM tenant_settings LIMIT 1`;
    const tenantId = settings.tenant_id;
    const fixture = await db.begin(async tx => {
      const [location] = await tx`INSERT INTO locations (tenant_id,slug,name,timezone)
        VALUES (${tenantId},${tag},${locationName},${settings.timezone}) RETURNING id`;
      const [service] = await tx`INSERT INTO services (tenant_id,slug,title,duration_minutes,price_cents)
        VALUES (${tenantId},${tag},${serviceName},45,25075) RETURNING id`;
      const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${tenantId},${staffName},${`qa-staff-${tag}@example.test`},'staff') RETURNING id`;
      await tx`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
        SELECT ${tenantId},${location.id},day,'09:00','16:00' FROM generate_series(0,6) AS day`;
      await tx`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${service.id},${location.id})`;
      await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${member.id},${location.id})`;
      await tx`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
      await tx`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
        VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','16:00',${settings.timezone})`;
      return { location, service, member };
    });
    const start = fromZonedTime(`${settings.day}T09:45:00`, settings.timezone);
    const end = fromZonedTime(`${settings.day}T10:30:00`, settings.timezone);
    const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" }).format(start);

    await page.goto(`/${tenant.route}/book`);
    const service = page.getByRole("button", { name: new RegExp(serviceName) });
    await expect(service).toHaveCount(0);
    const location = page.getByRole("combobox", { name: "Location", exact: true });
    await location.fill(locationName);
    const result = page.getByRole("option", { name: locationName, exact: true });
    if (hasTouch) await result.tap();
    else await result.click();
    await expect(location).toHaveValue(locationName);
    if (hasTouch) await location.tap();
    else await location.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await location.press("Escape");
    await expect(location).toHaveValue(locationName);
    await expect(service).toContainText("45 min");
    await expect(service).toContainText(price);
    await service.click();
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${settings.day}T12:00:00Z`));
    await page.locator(".tenant-day-list").getByRole("button", { name: new RegExp(`^${weekday}\\s*${settings.day.slice(-2)}$`) }).click();
    await page.locator(".tenant-time-grid").getByRole("button", { name: "09:45", exact: true }).click();
    await expect(page.locator(".tenant-customer-stage")).toContainText(staffName);
    await expect(location).toHaveValue(locationName);
    await page.getByLabel(/^(Patient name|Name)$/).fill(customerName);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    const confirmation = page.locator(".tenant-complete-stage");
    await expect(confirmation).toContainText("BOOKING CONFIRMED");
    await expect(confirmation).toContainText(staffName);
    await expect(confirmation).toContainText("09:45");
    await expect(location).toHaveValue(locationName);

    const matches = await db`SELECT b.id,b.booking_number,b.location_id,b.team_member_id,b.service_id,b.booked_price_cents,
      b.starts_at,b.ends_at,b.status,b.source,b.customer_id
      FROM bookings b JOIN customers c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id
      WHERE b.tenant_id=${tenantId} AND c.email=${email}`;
    expect(matches).toHaveLength(1);
    const [booking] = matches;
    expect(booking).toMatchObject({
      location_id: fixture.location.id, team_member_id: fixture.member.id, service_id: fixture.service.id,
      booked_price_cents: 25075, starts_at: start, ends_at: end, status: "confirmed", source: "public",
    });
    await expect(confirmation.getByText(`Booking number: ${booking.booking_number}`, { exact: true })).toHaveCount(1);

    const operator = await owner.newPage();
    const app = `/${tenant.route}/app`;
    await operator.goto("/login");
    await operator.getByLabel("Work email").fill(tenant.owner);
    await operator.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await operator.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(operator).toHaveURL(url => url.pathname === app);
    const calendar = `${app}/calendars?view=team&day=${settings.day}&location=${fixture.location.id}`;
    await operator.goto(calendar);
    const card = operator.locator(`a.waybook-week-calendar__entry[href*="booking=${booking.id}"]`);
    await expect(card).toContainText(customerName);
    await card.click();
    const detail = operator.getByRole("complementary", { name: `Appointment with ${customerName}` });
    for (const value of [booking.booking_number, serviceName, staffName, "09:45–10:30"]) await expect(detail).toContainText(value);

    await operator.goto(`${app}/bookings?q=${booking.booking_number}`);
    const row = operator.getByRole("row").filter({ hasText: booking.booking_number });
    await expect(row).toHaveCount(1);
    for (const value of [localTime, "Ends 10:30", locationName, staffName, serviceName, price]) await expect(row).toContainText(value);
    await expect(row.getByRole("cell", { name: "confirmed", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: "public", exact: true })).toBeVisible();

    await operator.goto(`${app}/customers?customer=${booking.customer_id}`);
    const history = operator.locator("#client-timeline").getByRole("listitem");
    await expect(history).toHaveCount(1);
    for (const value of [serviceName, localTime, staffName, price, "confirmed"]) await expect(history).toContainText(value);
  } finally {
    try {
      await db.begin(async tx => {
        await tx`UPDATE locations SET is_active=false WHERE slug=${tag}`;
        await tx`UPDATE services SET is_active=false WHERE slug=${tag}`;
        await tx`UPDATE team_members SET is_active=false WHERE email=${`qa-staff-${tag}@example.test`}`;
      });
    } finally {
      await Promise.all([db.end(), owner.close()]);
    }
  }
});
