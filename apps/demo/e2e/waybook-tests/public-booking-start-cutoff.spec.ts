import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const tenant of [
  { route: "nordic", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`open booking forms stop offering changes after the appointment starts in ${tenant.route}`, async ({ page }) => {
  const db = postgres(process.env[tenant.database]!, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const memberEmail = `cutoff-staff-${tag}@example.test`;
  try {
    const [settings] = await db`SELECT tenant_id,timezone,((now() AT TIME ZONE timezone)::date+3)::text AS day
      FROM tenant_settings LIMIT 1`;
    const tenantId = settings.tenant_id;
    const fixtures = await db.begin(async tx => {
      const [location] = await tx`INSERT INTO locations (tenant_id,slug,name,timezone)
        VALUES (${tenantId},${tag},${`Cutoff location ${tag}`},${settings.timezone}) RETURNING id`;
      const [service] = await tx`INSERT INTO services (tenant_id,slug,title,duration_minutes)
        VALUES (${tenantId},${tag},${`Cutoff service ${tag}`},30) RETURNING id`;
      const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${tenantId},${`Cutoff staff ${tag}`},${memberEmail},'staff') RETURNING id`;
      await tx`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
        SELECT ${tenantId},${location.id},day,'09:00','16:00' FROM generate_series(0,6) AS day`;
      await tx`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${service.id},${location.id})`;
      await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${member.id},${location.id})`;
      await tx`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
      await tx`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
        VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','16:00',${settings.timezone})`;
      const bookings = [];
      for (const [index, action] of (["availability", "reschedule", "cancel"] as const).entries()) {
        const email = `cutoff-${action}-${tag}@example.test`;
        const time = `${10 + index}:00`;
        const [customer] = await tx`INSERT INTO customers (tenant_id,name,email) VALUES (${tenantId},${`Cutoff ${action} ${tag}`},${email}) RETURNING id`;
        const [block] = await tx`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
          VALUES (${tenantId},${member.id},${location.id},${`${settings.day}T${time}:00`}::timestamp AT TIME ZONE ${settings.timezone},
            (${`${settings.day}T${time}:00`}::timestamp AT TIME ZONE ${settings.timezone})+interval '30 minutes','confirmed')
          RETURNING id,starts_at,ends_at`;
        const [booking] = await tx`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,
            starts_at,ends_at,status,booked_price_cents)
          VALUES (${tenantId},${block.id},${service.id},${member.id},${location.id},${customer.id},
            ${block.starts_at},${block.ends_at},'confirmed',10000) RETURNING id,booking_number`;
        bookings.push({ action, booking, block, email });
      }
      return bookings;
    });

    await page.goto(`/${tenant.route}/book`);
    const dialog = page.getByRole("dialog");
    const reschedule = dialog.getByRole("button", { name: "Reschedule booking", exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel booking", exact: true });
    const contact = dialog.getByText("This booking can no longer be changed online. Please contact the business if you need help.", { exact: true });
    for (const [index, { action, booking, block, email }] of fixtures.entries()) {
      await page.getByRole("button", { name: "Manage booking", exact: true }).click();
      await dialog.getByLabel("Booking number").fill(booking.booking_number);
      await dialog.getByLabel("Email address").fill(email);
      await dialog.getByRole("button", { name: "Find booking", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Your booking", exact: true })).toBeVisible();

      if (action === "reschedule") {
        await reschedule.click();
        await dialog.getByLabel("Day").fill(settings.day);
        await dialog.getByRole("button", { name: "13:00", exact: true }).click();
      } else if (action === "cancel") {
        await cancel.click();
      }
      const submit = action === "availability" ? reschedule : dialog.getByRole("button", {
        name: action === "reschedule" ? "Confirm new time" : "Confirm cancellation", exact: true,
      });
      await expect(submit).toBeEnabled();

      const started = await db.begin(async tx => {
        const offset = `-${5 + 40 * index} minutes`;
        const [updated] = await tx`UPDATE booking_blocks SET starts_at=now()+${offset}::interval,
            ends_at=now()+${offset}::interval+interval '30 minutes' WHERE tenant_id=${tenantId} AND id=${block.id}
            RETURNING starts_at,ends_at`;
        await tx`UPDATE bookings SET starts_at=${updated.starts_at},ends_at=${updated.ends_at} WHERE tenant_id=${tenantId} AND id=${booking.id}`;
        return updated;
      });

      const [response] = await Promise.all([
        page.waitForResponse(result => result.request().method() === "POST" && new URL(result.url()).pathname === `/${tenant.route}/api/public/manage`),
        submit.click(),
      ]);
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({ canChange: false });
      await expect(contact).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Your booking", exact: true })).toBeFocused();
      await expect(submit).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Retry availability", exact: true })).toHaveCount(0);
      await expect(reschedule).toHaveCount(0);
      await expect(cancel).toHaveCount(0);
      expect(await db`SELECT b.status,bb.state,b.starts_at,b.ends_at,
          (SELECT count(*)::int FROM booking_events WHERE booking_id=b.id) AS events,
          (SELECT count(*)::int FROM email_outbox WHERE booking_id=b.id) AS messages
        FROM bookings b JOIN booking_blocks bb ON bb.id=b.booking_block_id AND bb.tenant_id=b.tenant_id
        WHERE b.tenant_id=${tenantId} AND b.id=${booking.id}`)
        .toEqual([{ ...started, status: "confirmed", state: "confirmed", events: 0, messages: 0 }]);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  } finally {
    try {
      await db.begin(async tx => {
        await tx`UPDATE locations SET is_active=false WHERE slug=${tag}`;
        await tx`UPDATE services SET is_active=false WHERE slug=${tag}`;
        await tx`UPDATE team_members SET is_active=false WHERE email=${memberEmail}`;
      });
    } finally {
      await db.end();
    }
  }
});
