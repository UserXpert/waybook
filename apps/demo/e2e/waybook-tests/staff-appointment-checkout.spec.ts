import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("staff checkout settles the assigned appointment without opening workspace sales", { tag: "@smoke" }, async ({ browser, baseURL, ignoreHTTPSErrors, page }, testInfo) => {
  const options = { max: 1, ssl: false } as const;
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, options);
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, options);
  const otherTenant = postgres(process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL!, options);
  const tag = randomUUID().slice(0, 8);
  const email = `checkout-${tag}@example.test`;
  const salePath = "/nordic/app/sales";
  const calendarPath = "/nordic/app/calendars";

  try {
    const [tenant] = await db<{ id: string }[]>`SELECT tenant_id AS id FROM tenant_settings`;
    const [foreignBooking] = await otherTenant<{ id: string }[]>`
      WITH workspace AS (
        SELECT settings.tenant_id,
          (SELECT id FROM locations WHERE tenant_id=settings.tenant_id AND slug='primary') AS location_id,
          (SELECT id FROM services WHERE tenant_id=settings.tenant_id ORDER BY id LIMIT 1) AS service_id,
          (SELECT id FROM team_members WHERE tenant_id=settings.tenant_id AND role='owner' LIMIT 1) AS member_id
        FROM tenant_settings settings
      ), customer AS (
        INSERT INTO customers (tenant_id,name,email)
        SELECT tenant_id,'Foreign checkout QA',${`foreign-checkout-${tag}@example.test`} FROM workspace
        RETURNING id
      ), reservation AS (
        INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        SELECT tenant_id,member_id,location_id,now()-${testInfo.project.name === "mobile" ? 25 : 24} * interval '1 day',
          now()-${testInfo.project.name === "mobile" ? 25 : 24} * interval '1 day' + interval '1 hour','confirmed'
        FROM workspace
        RETURNING id, starts_at, ends_at
      )
      INSERT INTO bookings
        (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,attendance_stage,booked_price_cents)
      SELECT tenant_id,reservation.id,service_id,member_id,location_id,customer.id,starts_at,ends_at,'arrived','checking_out',65000
      FROM workspace CROSS JOIN customer CROSS JOIN reservation
      RETURNING id
    `;
    const [foreignSale] = await otherTenant<{ id: string }[]>`SELECT id FROM commerce_sales WHERE booking_id=${foreignBooking.id}`;
    const [identity] = await control<{ id: string }[]>`
      INSERT INTO identities (email,password_hash,display_name)
      SELECT ${email}, password_hash, 'Checkout QA staff' FROM identities WHERE email='owner@nordic.local'
      RETURNING id
    `;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenant.id},${identity.id},'staff')`;
    const [role] = await db<{ id: string }[]>`
      INSERT INTO staff_roles (tenant_id,name,permissions)
      VALUES (${tenant.id},${`Checkout QA ${tag}`},'{"canUpdateAppointmentStatus":true,"canViewTeamCalendar":true}')
      RETURNING id
    `;
    const [member, colleague] = await db<{ id: string }[]>`
      INSERT INTO team_members (tenant_id,identity_id,name,email,role,staff_role_id)
      VALUES (${tenant.id},${identity.id},${`QA Checkout staff ${tag}`},${email},'staff',${role.id}),
        (${tenant.id},NULL,${`QA Checkout colleague ${tag}`},${`checkout-colleague-${tag}@example.test`},'staff',NULL)
      RETURNING id
    `;
    const [location] = await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${tenant.id} AND slug='primary'`;
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${tenant.id} AND slug='studio-session'`;
    const assign = (id: string) => db`
      INSERT INTO team_member_locations (tenant_id,team_member_id,location_id)
      VALUES (${tenant.id},${id},${location.id})
    `;
    await assign(member.id);
    await assign(colleague.id);

    async function createBooking(provider: string, label: string, stage: string, hoursAgo: number) {
      const name = `${label} ${tag}`;
      const [customer] = await db<{ id: string }[]>`
        INSERT INTO customers (tenant_id,name,email) VALUES (${tenant.id},${name},${`${label.toLowerCase().replaceAll(" ", "-")}-${tag}@example.test`})
        RETURNING id
      `;
      const [block] = await db<{ id: string; startsAt: Date; endsAt: Date }[]>`
        INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${tenant.id},${provider},${location.id},now()-${hoursAgo} * interval '1 hour',
          now()-(${hoursAgo}-1) * interval '1 hour','confirmed')
        RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt"
      `;
      const [booking] = await db<{ id: string }[]>`
        INSERT INTO bookings
          (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,attendance_stage,booked_price_cents)
        VALUES (${tenant.id},${block.id},${service.id},${provider},${location.id},${customer.id},${block.startsAt},${block.endsAt},'arrived',${stage},65000)
        RETURNING id
      `;
      const [sale] = await db<{ id: string }[]>`SELECT id FROM commerce_sales WHERE tenant_id=${tenant.id} AND booking_id=${booking.id}`;
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(block.startsAt);
      const params = new URLSearchParams({ location: location.id, employee: provider, day, view: "staff", booking: booking.id });
      return { ...booking, name, calendar: `${calendarPath}?${params}`, sale: sale.id };
    }

    const own = await createBooking(member.id, "Assigned checkout", "in_service", 3);
    const other = await createBooking(colleague.id, "Colleague checkout", "checking_out", 3);
    const shared = await createBooking(member.id, "Shared checkout", "checking_out", 6);
    const [sharedBlock] = await db<{ id: string }[]>`
      INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
      VALUES (${tenant.id},${colleague.id},${location.id},now()-interval '5 hours',now()-interval '4 hours','confirmed')
      RETURNING id
    `;
    await db`
      INSERT INTO booking_service_segments (tenant_id,booking_id,booking_block_id,service_id,position,booked_price_cents)
      VALUES (${tenant.id},${shared.id},${sharedBlock.id},${service.id},2,25000)
    `;
    const paymentRows = () => db`
      SELECT amount_cents,method,recorded_by_identity_id FROM payment_records
      WHERE booking_id=${own.id} ORDER BY recorded_at,id
    `;
    const bookingStatus = async () => (await db<{ status: string }[]>`SELECT status FROM bookings WHERE id=${own.id}`)[0].status;
    await page.emulateMedia({ colorScheme: testInfo.project.name === "mobile" ? "dark" : "light" });
    await page.goto("/nordic/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);

    await page.goto(own.calendar);
    const appointment = page.getByRole("dialog", { name: `Appointment with ${own.name}` });
    await expect(appointment.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0);
    await db`UPDATE staff_roles SET permissions=permissions || '{"canCheckoutAppointments":true}'::jsonb WHERE id=${role.id}`;

    await page.goto(salePath);
    await expect(page).toHaveURL(/\/nordic\/app\/calendars$/);
    for (const denied of [`${salePath}?sale=${other.sale}`, `${salePath}?sale=${shared.sale}`, `${salePath}?sale=${foreignSale.id}`]) {
      await page.goto(denied);
      await expect(page).toHaveURL(/\/app\/calendars$/);
      await expect(page.getByRole("dialog", { name: "Appointment checkout" })).toHaveCount(0);
    }
    await db`UPDATE staff_roles SET permissions=permissions || '{"canManageTeamAppointments":true}'::jsonb WHERE id=${role.id}`;
    await page.goto(`${salePath}?sale=${shared.sale}`);
    const checkout = page.getByRole("dialog", { name: "Appointment checkout" });
    await expect(checkout.getByText(shared.name, { exact: true })).toBeVisible();
    await db`UPDATE staff_roles SET permissions=permissions - 'canManageTeamAppointments' WHERE id=${role.id}`;

    await page.goto(own.calendar);
    await appointment.getByRole("button", { name: "Checkout", exact: true }).click();
    await expect(checkout.getByText(own.name, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sales", exact: true })).toHaveCount(0);
    await expect(checkout.getByRole("heading", { name: "Client details" })).toHaveCount(0);
    await checkout.getByRole("link", { name: "Go to payments" }).click();

    const amount = checkout.getByLabel("Amount (DKK)");
    await expect(amount).toHaveValue("650.00");
    await expect(amount).toHaveAttribute("readonly", "");
    await expect(checkout.getByRole("button", { name: "Record partial payment", exact: true })).toHaveCount(0);
    await checkout.getByRole("radio", { name: "Cash", exact: true }).check();

    if (!baseURL) throw new Error("Waybook checkout tests require a base URL.");
    const stripeOrigin = new URL(baseURL).origin;
    const [attempt] = await db<{ id: string }[]>`
      INSERT INTO stripe_sandbox_checkout_attempts
        (tenant_id,booking_id,account_id,amount_cents,return_path,return_origin,created_by_identity_id,expires_at_seconds,session_id)
      VALUES (${tenant.id},${own.id},'acct_staffCheckoutFixture',65000,${salePath},${stripeOrigin},
        ${identity.id}, extract(epoch FROM now() + interval '1 hour')::int,${`cs_test_staffcheckout${tag}`})
      RETURNING id
    `;
    await checkout.getByRole("button", { name: "Record payment" }).click();
    await expect(checkout.getByRole("alert")).toContainText("Resolve the open Stripe sandbox payment before changing checkout.");
    expect(await paymentRows()).toHaveLength(0);

    const paymentPath = `${salePath}?booking=${own.id}&step=payment`;
    await page.goto(paymentPath);
    await expect(checkout.getByText("A card payment is in progress.", { exact: false })).toBeVisible();
    await expect(checkout.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await expect(checkout.getByRole("button", { name: "Finish checkout" })).toHaveCount(0);
    await db`UPDATE stripe_sandbox_checkout_attempts SET state='expired' WHERE id=${attempt.id}`;
    await page.goto(paymentPath);
    await checkout.getByRole("radio", { name: "Cash", exact: true }).check();

    await amount.evaluate((input) => {
      (input as HTMLInputElement).form?.addEventListener("formdata", (event) => {
        event.formData.set("amountDkk", "649.99");
      }, { once: true });
    });
    const settle = checkout.getByRole("button", { name: "Record payment and finish checkout", exact: true });
    await settle.click();
    await expect(checkout.getByRole("alert")).toContainText("Record the full balance due");
    expect(await paymentRows()).toHaveLength(0);
    expect(await bookingStatus()).toBe("arrived");

    const [manager] = await control<{ id: string }[]>`SELECT id FROM identities WHERE email='owner@nordic.local'`;
    const managerContext = await browser.newContext({ baseURL, ignoreHTTPSErrors, viewport: page.viewportSize() });
    try {
      const managerPage = await managerContext.newPage();
      await managerPage.goto("/nordic/login");
      await managerPage.getByLabel("Work email").fill("owner@nordic.local");
      await managerPage.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await managerPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(managerPage).toHaveURL(/\/nordic\/app/);
      await managerPage.goto(`${salePath}?booking=${own.id}&step=payment`);
      const managerCheckout = managerPage.getByRole("dialog", { name: "Appointment checkout" });
      await managerCheckout.getByLabel("Amount (DKK)").fill("200.00");
      await managerCheckout.getByRole("radio", { name: "Bank transfer", exact: true }).check();
      await managerCheckout.getByRole("button", { name: "Record partial payment", exact: true }).click();
      await expect(managerCheckout.getByRole("region", { name: "Payments recorded", exact: true })).toBeVisible();
      expect(await bookingStatus()).toBe("arrived");
      expect(await paymentRows()).toEqual([{ amount_cents: 20000, method: "bank_transfer", recorded_by_identity_id: manager.id }]);
    } finally {
      await managerContext.close();
    }

    await page.reload();
    await expect(amount).toHaveValue("450.00");
    await expect(amount).toHaveAttribute("readonly", "");
    await expect(checkout.getByRole("region", { name: "Payments recorded", exact: true })).toBeVisible();
    await checkout.getByRole("radio", { name: "Cash", exact: true }).check();

    const actionRoute = `**${new URL(page.url()).pathname}**`;
    await page.route(actionRoute, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        await route.fetch();
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await settle.click();
    const retry = checkout.getByRole("button", { name: "Retry entry", exact: true });
    await expect(retry).toBeVisible();
    await expect.poll(bookingStatus).toBe("completed");
    await page.unroute(actionRoute);
    await retry.click();
    await expect(checkout.getByText("Paid SALE", { exact: true })).toBeVisible();
    expect(await paymentRows()).toEqual([
      { amount_cents: 20000, method: "bank_transfer", recorded_by_identity_id: manager.id },
      { amount_cents: 45000, method: "cash", recorded_by_identity_id: identity.id },
    ]);
    expect(await db`SELECT id FROM booking_events WHERE booking_id=${own.id} AND event_type='booking.completed'`).toHaveLength(1);
    await expect(checkout.getByRole("link", { name: "View receipt" })).toHaveCount(0);
    await checkout.getByRole("link", { name: "Open appointment" }).click();
    await expect(appointment.getByRole("link", { name: "View sale" })).toBeVisible();
  } finally {
    await Promise.all([control.end(), db.end(), otherTenant.end()]);
  }
});
