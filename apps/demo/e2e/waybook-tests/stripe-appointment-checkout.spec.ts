import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("Stripe checkout reserves one balance, reconciles once, and releases a cancelled attempt", async ({ page }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 2, ssl: false });
  const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug = 'nordic-studio'`;
  const marker = randomUUID().slice(0, 8);
  const name = `Stripe checkout QA ${marker}`;
  try {
    await control`INSERT INTO waybook_stripe_sandbox_connections (tenant_id, account_id)
      VALUES (${tenantId}, 'acct_checkoutFixture')`;
    const [actor] = await control`SELECT id FROM identities WHERE email = 'owner@nordic.local'`;
    const appointments = await db.begin(async (tx) => {
      const [location] = await tx`INSERT INTO locations (tenant_id, slug, name, timezone)
        VALUES (${tenantId}, ${`stripe-${marker}`}, ${name}, 'Europe/Copenhagen') RETURNING id`;
      const [service] = await tx`SELECT id FROM services WHERE tenant_id = ${tenantId} AND title = 'Studio session'`;
      const [member] = await tx`INSERT INTO team_members (tenant_id, name, email, role)
        VALUES (${tenantId}, ${name}, ${`stripe-staff-${marker}@example.test`}, 'staff') RETURNING id`;
      const [customer] = await tx`INSERT INTO customers (tenant_id, name, email)
        VALUES (${tenantId}, ${name}, ${`stripe-client-${marker}@example.test`}) RETURNING id`;
      const bookings: string[] = [];
      for (const [hoursAgo, amount] of [[25, 6501], [27, 6502]]) {
        const [block] = await tx`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
          VALUES (${tenantId}, ${member.id}, ${location.id}, now() - ${hoursAgo} * interval '1 hour',
            now() - ${hoursAgo - 1} * interval '1 hour', 'confirmed') RETURNING id, starts_at, ends_at`;
        const [booking] = await tx`INSERT INTO bookings (
          tenant_id, booking_block_id, service_id, team_member_id, location_id, customer_id, starts_at, ends_at, status, booked_price_cents
        ) VALUES (${tenantId}, ${block.id}, ${service.id}, ${member.id}, ${location.id}, ${customer.id},
          ${block.starts_at}, ${block.ends_at}, 'arrived', ${amount}) RETURNING id`;
        await tx`UPDATE bookings SET attendance_stage = 'checking_out' WHERE tenant_id = ${tenantId} AND id = ${booking.id}`;
        bookings.push(booking.id);
      }
      return bookings;
    });
    await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ body: "Stripe sandbox checkout fixture" }));
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    const sale = page.getByRole("dialog", { name: "Appointment checkout" });
    const receipts = (id: string) => db`SELECT id, amount_cents, method FROM payment_records WHERE booking_id = ${id}`;
    const attempts = (id: string) => db`SELECT id, state, session_id FROM stripe_sandbox_checkout_attempts WHERE booking_id = ${id}`;

    for (const [index, id] of appointments.entries()) {
      const paymentPath = `/nordic/app/sales?booking=${id}&step=payment`;
      await page.goto(paymentPath);
      await sale.getByRole("button", { name: "Pay by card in Stripe sandbox" }).click();
      await expect(sale.getByRole("alert")).toContainText("Stripe sandbox checkout is temporarily unavailable.");
      await expect(sale.getByRole("button", { name: "Record payment" })).toHaveCount(0);
      const [reserved] = await attempts(id);
      expect(reserved).toMatchObject({ state: "pending", session_id: null });
      expect(await receipts(id)).toEqual([]);
      await expect(db`INSERT INTO payment_records (tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id)
        VALUES (${tenantId}, ${id}, 'payment', 100, 'cash', ${actor.id})`).rejects.toThrow("Resolve the open Stripe sandbox payment");
      await expect(db`UPDATE bookings SET booked_price_cents = 100 WHERE id = ${id}`)
        .rejects.toThrow("Resolve the open Stripe sandbox payment");
      await sale.getByRole("button", { name: "Continue in Stripe" }).click();
      const sessionId = `cs_test_${reserved.id.replaceAll("-", "")}`;
      await expect(page).toHaveURL(`https://checkout.stripe.com/c/pay/${sessionId}`);
      expect(await attempts(id)).toEqual([{ id: reserved.id, state: "pending", session_id: sessionId }]);
      await page.goto(paymentPath);

      if (index === 0) {
        const other = await page.context().newPage();
        try {
          await other.goto(paymentPath);
          const otherCheck = other.getByRole("button", { name: "Check payment status" });
          await expect(otherCheck).toBeVisible();
          await Promise.all([sale.getByRole("button", { name: "Check payment status" }).click(), otherCheck.click()]);
          await expect(other.getByText("Stripe sandbox card", { exact: true })).toBeVisible();
        } finally {
          await other.close();
        }
        await expect(sale.getByText("Stripe sandbox card", { exact: true })).toBeVisible();
        await expect(sale.getByRole("button", { name: "Edit payment" })).toHaveCount(0);
        const receipt = [{ id: reserved.id, amount_cents: 6501, method: "card" }];
        expect(await receipts(id)).toEqual(receipt);
        expect(await db`SELECT metadata->>'source' AS source FROM booking_events
          WHERE booking_id = ${id} AND event_type = 'payment.payment'`).toEqual([{ source: "stripe_sandbox" }]);
        await page.goto(paymentPath);
        expect(await receipts(id)).toEqual(receipt);
        await expect(db`INSERT INTO payment_records (tenant_id, booking_id, kind, amount_cents, method, recorded_by_identity_id)
          VALUES (${tenantId}, ${id}, 'refund', 100, 'cash', ${actor.id})`).rejects.toThrow("must be reconciled through Stripe");
        await sale.getByRole("button", { name: "Finish checkout" }).click();
        await expect.poll(async () => (await db`SELECT status FROM bookings WHERE id = ${id}`)[0].status).toBe("completed");
      } else {
        await sale.getByRole("button", { name: "Cancel card payment" }).click();
        await expect(sale.getByRole("button", { name: "Record payment" })).toBeVisible();
        expect(await attempts(id)).toEqual([{ id: reserved.id, state: "expired", session_id: sessionId }]);
        expect(await receipts(id)).toEqual([]);
        await sale.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
        await sale.getByRole("button", { name: "Record payment" }).click();
        await expect(sale.getByRole("button", { name: "Finish checkout" })).toBeVisible();
        expect(await receipts(id)).toEqual([{ id: expect.any(String), amount_cents: 6502, method: "cash" }]);
      }
    }
  } finally {
    await control`DELETE FROM waybook_stripe_sandbox_connections WHERE tenant_id = ${tenantId} AND account_id = 'acct_checkoutFixture'`;
    await Promise.all([control.end(), db.end()]);
  }
});
