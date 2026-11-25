import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`public contact validation retains the reserved time in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const title = `Contact validation ${tag}`;
  const phone = "+45 11 22 33 44";
  const email = `contact-${tag}@example.test`;
  let data: { location: string; service: string; staff: string } | undefined;
  try {
    const [settings] = await db`SELECT tenant_id,timezone,((now() AT TIME ZONE timezone)::date+3)::text AS day FROM tenant_settings LIMIT 1`;
    const tenantId = settings.tenant_id;
    data = await db.begin(async (sql) => {
      const [location] = await sql`INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${tenantId},${tag},${`QA location ${tag}`},${settings.timezone}) RETURNING id`;
      const [service] = await sql`INSERT INTO services (tenant_id,slug,title,duration_minutes) VALUES (${tenantId},${tag},${title},30) RETURNING id`;
      const [member] = await sql`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${tenantId},${`QA staff ${tag}`},${`staff-${tag}@example.test`},'staff') RETURNING id`;
      await sql`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
        SELECT ${tenantId},${location.id},day,'09:00','16:00' FROM generate_series(0,6) AS day`;
      await sql`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${service.id},${location.id})`;
      await sql`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${member.id},${location.id})`;
      await sql`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
      await sql`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
        VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','16:00',${settings.timezone})`;
      return { location: location.id, service: service.id, staff: member.id };
    });

    await page.goto(`/${tenant.route}/book?location=${data.location}&service=${data.service}`);
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
      .format(new Date(`${settings.day}T12:00:00Z`));
    await page.locator(".tenant-day-list").getByRole("button", { name: new RegExp(`^${weekday}\\s*${settings.day.slice(-2)}$`) }).click();
    await page.locator(".tenant-time-grid").getByRole("button", { name: "10:00", exact: true }).click();
    const details = page.locator(".tenant-customer-stage");
    const name = details.getByLabel(/^(Patient name|Name)$/);
    const emailInput = details.getByLabel("Email", { exact: true });
    const phoneInput = details.getByLabel("Phone", { exact: true });
    const submit = details.getByRole("button", { name: "Confirm booking" });
    await expect(details.locator("article b")).toContainText("10:00");
    const time = await details.locator("article b").innerText();

    await submit.click();
    expect(await name.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    await name.fill("QA client");
    await emailInput.fill("invalid-email");
    await phoneInput.fill(phone);
    await submit.click();
    expect(await emailInput.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
    await expect(name).toHaveValue("QA client");

    await name.fill("   ");
    await emailInput.fill(email);
    await submit.click();
    const status = details.getByRole("status");
    await expect(status).toHaveText("Enter your name to confirm your booking.");
    await expect(details.locator("article b")).toHaveText(time);
    await expect(emailInput).toHaveValue(email);
    await expect(phoneInput).toHaveValue(phone);
    expect(await db`SELECT id FROM bookings WHERE service_id=${data.service}`).toHaveLength(0);

    await name.fill("QA client");
    await submit.click();
    await expect(page.getByText("BOOKING CONFIRMED")).toBeVisible();
    const bookings = await db`SELECT b.booking_number,b.location_id,c.name,c.email,c.phone
      FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
      WHERE b.tenant_id=${tenantId} AND b.service_id=${data.service}`;
    expect(bookings).toEqual([{ booking_number: expect.any(String), location_id: data.location, name: "QA client", email, phone }]);
    await expect(page.locator(".tenant-complete-stage")).toContainText(bookings[0].booking_number);
  } finally {
    try {
      if (data) {
        await db`UPDATE team_members SET is_active=false WHERE id=${data.staff}`;
        await db`UPDATE services SET is_active=false WHERE id=${data.service}`;
        await db`UPDATE locations SET is_active=false WHERE id=${data.location}`;
      }
    } finally {
      await db.end();
    }
  }
});
