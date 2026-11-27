import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("saved card setup stays unpaid until the client confirms Stripe checkout", async ({ page }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug = 'nordic-studio'`;
  const marker = randomUUID().slice(0, 8);
  const name = `Card setup QA ${marker}`;
  const staffEmail = `card-staff-${marker}@example.test`;
  let fixtureLocationId: string | undefined;
  try {
    await control`INSERT INTO waybook_stripe_sandbox_connections (tenant_id, account_id) VALUES (${tenantId}, 'acct_checkoutFixture')`;
    const [staff] = await control`INSERT INTO identities (email, password_hash, display_name)
      SELECT ${staffEmail}, password_hash, ${name} FROM identities WHERE email = 'owner@nordic.local' RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${staff.id}, 'staff')`;
    const { booking, customer, locationId } = await db.begin(async (tx) => {
      const [location] = await tx`INSERT INTO locations (tenant_id, slug, name, timezone)
        VALUES (${tenantId}, ${`qa-card-${marker}`}, ${name}, 'Europe/Copenhagen') RETURNING id`;
      const [service] = await tx`SELECT id FROM services WHERE tenant_id = ${tenantId} AND title = 'Studio session'`;
      const [member] = await tx`INSERT INTO team_members (tenant_id, identity_id, name, email, role)
        VALUES (${tenantId}, ${staff.id}, ${name}, ${staffEmail}, 'staff') RETURNING id`;
      await tx`INSERT INTO staff_permissions (tenant_id, team_member_id, can_manage_own_appointments)
        VALUES (${tenantId}, ${member.id}, TRUE)`;
      const [customer] = await tx`INSERT INTO customers (tenant_id, name, email, phone)
        VALUES (${tenantId}, ${name}, ${`card-client-${marker}@example.test`}, '+4512345678') RETURNING id`;
      const [block] = await tx`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
        SELECT ${tenantId}, ${member.id}, ${location.id}, starts_at, starts_at + interval '1 hour', 'confirmed'
        FROM (SELECT GREATEST(
          (date_trunc('day', now() AT TIME ZONE 'Europe/Copenhagen') + interval '12 hours') AT TIME ZONE 'Europe/Copenhagen',
          date_trunc('minute', now())
        ) AS starts_at) schedule
        RETURNING id, starts_at, ends_at`;
      const [booking] = await tx`INSERT INTO bookings
        (tenant_id, booking_block_id, service_id, team_member_id, location_id, customer_id, starts_at, ends_at, status, booked_price_cents)
        VALUES (${tenantId}, ${block.id}, ${service.id}, ${member.id}, ${location.id}, ${customer.id},
          ${block.starts_at}, ${block.ends_at}, 'confirmed', 65000) RETURNING id`;
      return { booking, customer, locationId: location.id };
    });
    fixtureLocationId = locationId;

    await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ body: "Stripe hosted setup fixture" }));
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    const bookingPath = `/nordic/app/calendars?booking=${booking.id}`;
    await page.goto(bookingPath);
    const drawer = page.getByRole("complementary", { name: `Appointment with ${name}` });
    await expect(drawer.getByRole("link", { name: /4512345678/ })).toHaveAttribute("href", "tel:+4512345678");
    const continueToStripe = drawer.getByRole("button", { name: "Continue to Stripe" });
    await drawer.getByRole("button", { name: "Add credit card" }).click();
    await expect(drawer.getByRole("checkbox")).not.toBeChecked();
    await continueToStripe.click();
    await expect(page).toHaveURL(new RegExp(booking.id));
    await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
    await drawer.getByRole("button", { name: "Add credit card" }).click();
    await drawer.getByRole("checkbox").check();
    await continueToStripe.click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_card/);
    const firstSession = page.url();

    const [pending] = await db`SELECT setup_id, setup_session_id, setup_return_url, card_last4
      FROM stripe_sandbox_client_cards WHERE tenant_id = ${tenantId} AND customer_id = ${customer.id}`;
    expect(pending.card_last4).toBeNull();
    await page.goto(bookingPath);
    await drawer.getByRole("button", { name: "Resume card setup" }).click();
    await drawer.getByRole("checkbox").check();
    await continueToStripe.click();
    await expect(page).toHaveURL(firstSession);
    await page.goto(pending.setup_return_url);
    await expect(drawer.getByText("Visa ending in 4242")).toBeVisible();
    await expect(page).not.toHaveURL(/cardSetup=return/);
    await page.goto(bookingPath);
    await expect(drawer.getByText("Visa ending in 4242")).toBeVisible();
    expect(await db`SELECT card_last4, setup_id FROM stripe_sandbox_client_cards WHERE customer_id = ${customer.id}`)
      .toEqual([{ card_last4: "4242", setup_id: null }]);
    expect(await db`SELECT id FROM payment_records WHERE booking_id = ${booking.id}`).toEqual([]);
    expect(await db`SELECT status FROM bookings WHERE id = ${booking.id}`).toEqual([{ status: "confirmed" }]);

    const [card] = await db`SELECT stripe_customer_id FROM stripe_sandbox_client_cards
      WHERE tenant_id = ${tenantId} AND customer_id = ${customer.id}`;
    await drawer.getByRole("button", { name: "Check in", exact: true }).click();
    await drawer.getByRole("button", { name: "In service", exact: true }).click();
    await drawer.getByRole("button", { name: "Checkout", exact: true }).click();
    const sale = page.getByRole("dialog", { name: "Appointment checkout" });
    await sale.getByRole("link", { name: "Go to payments" }).click();
    await sale.getByRole("button", { name: "Pay by card in Stripe sandbox" }).click();
    await expect(sale.getByRole("alert")).toContainText("Stripe sandbox checkout is temporarily unavailable.");
    const [attempt] = await db`SELECT id, stripe_customer_id, return_path, state
      FROM stripe_sandbox_checkout_attempts WHERE booking_id = ${booking.id}`;
    expect(attempt.stripe_customer_id).toBe(card.stripe_customer_id);
    expect(attempt.state).toBe("pending");
    expect(await db`SELECT id FROM payment_records WHERE booking_id = ${booking.id}`).toEqual([]);

    await sale.getByRole("button", { name: "Continue in Stripe", exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    await page.goto(attempt.return_path);
    await expect.poll(async () => (await db`SELECT status, attendance_stage FROM bookings
      WHERE tenant_id = ${tenantId} AND id = ${booking.id}`)[0]).toEqual({ status: "completed", attendance_stage: null });
    expect(await db`SELECT id FROM booking_events
      WHERE tenant_id = ${tenantId} AND booking_id = ${booking.id} AND event_type = 'booking.completed'`).toHaveLength(1);
    await expect(sale.getByRole("button", { name: "Finish checkout", exact: true })).toHaveCount(0);
    expect(await db`SELECT id,method,amount_cents FROM payment_records WHERE booking_id = ${booking.id}`)
      .toEqual([{ id: attempt.id, method: "card", amount_cents: 65000 }]);
    const [appointmentSale] = await db`SELECT id FROM commerce_sales WHERE tenant_id = ${tenantId} AND booking_id = ${booking.id}`;
    const receiptLink = sale.getByRole("link", { name: "View receipt", exact: true });
    await expect(receiptLink).toBeInViewport({ ratio: 1 });
    await receiptLink.click();
    await expect(page.getByRole("heading", { name: "Appointment receipt" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("sale")).toBe(appointmentSale.id);
    const receiptPayments = page.getByRole("table", { name: "Payments and refunds" });
    await expect(receiptPayments.getByRole("row", { name: /Payment · Card/ })).toContainText("650,00");


    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(staffEmail);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto(bookingPath);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Visa ending in 4242")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Add credit card" })).toHaveCount(0);
  } finally {
    if (fixtureLocationId) await db`UPDATE locations SET is_active=false WHERE tenant_id=${tenantId} AND id=${fixtureLocationId}`;
    await control`DELETE FROM waybook_stripe_sandbox_connections WHERE tenant_id = ${tenantId} AND account_id = 'acct_checkoutFixture'`;
    await db.end();
    await control.end();
  }
});
