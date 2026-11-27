import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("appointment card setup resumes, returns a mask, and leaves the appointment unpaid", async ({ page }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug = 'nordic-studio'`;
  const marker = randomUUID().slice(0, 8);
  const name = `Card setup QA ${marker}`;
  const staffEmail = `card-staff-${marker}@example.test`;
  try {
    await control`INSERT INTO waybook_stripe_sandbox_connections (tenant_id, account_id) VALUES (${tenantId}, 'acct_checkoutFixture')`;
    const [staff] = await control`INSERT INTO identities (email, password_hash, display_name)
      SELECT ${staffEmail}, password_hash, ${name} FROM identities WHERE email = 'owner@nordic.local' RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${staff.id}, 'staff')`;
    const { booking, customer } = await db.begin(async (tx) => {
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
        VALUES (${tenantId}, ${member.id}, ${location.id}, now() + interval '2 hours', now() + interval '3 hours', 'confirmed')
        RETURNING id, starts_at, ends_at`;
      const [booking] = await tx`INSERT INTO bookings
        (tenant_id, booking_block_id, service_id, team_member_id, location_id, customer_id, starts_at, ends_at, status, booked_price_cents)
        VALUES (${tenantId}, ${block.id}, ${service.id}, ${member.id}, ${location.id}, ${customer.id},
          ${block.starts_at}, ${block.ends_at}, 'confirmed', 65000) RETURNING id`;
      return { booking, customer };
    });

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
    await control`DELETE FROM waybook_stripe_sandbox_connections WHERE tenant_id = ${tenantId} AND account_id = 'acct_checkoutFixture'`;
    await db.end();
    await control.end();
  }
});
