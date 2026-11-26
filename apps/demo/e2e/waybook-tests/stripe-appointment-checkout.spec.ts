import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

async function deliverStripe(sender: APIRequestContext, endpoint: string, event: object, valid = true) {
  const data = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", "whsec_waybookE2EFixture").update(`${timestamp}.${data}`).digest("hex");
  return (await sender.post(endpoint, { data, headers: {
    "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${valid ? digest : "0".repeat(64)}`,
  } })).status();
}

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
      for (const [hoursAgo, amount] of [[25, 6501], [27, 6502], [29, 6503], [31, 6504]]) {
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
    const receipts = (id: string) => db`SELECT id, amount_cents, method FROM payment_records WHERE booking_id = ${id}
      ORDER BY recorded_at, id`;
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
      const sessionId = `cs_test_${reserved.id.replaceAll("-", "")}`;
      if (index >= 2) {
        // Deliver signed notifications without staff authentication or a return from Stripe.
        const sender = await page.context().browser()!.newContext();
        try {
          const endpoint = new URL("/api/webhooks/stripe-sandbox", page.url()).href;
          const event = {
            object: "event", id: "evt_waybookfixture", livemode: false,
            account: "acct_checkoutFixture",
            type: index === 2 ? "checkout.session.completed" : "checkout.session.expired",
            data: { object: { object: "checkout.session", id: sessionId, livemode: false, client_reference_id: reserved.id } },
          };
          const deliver = () => deliverStripe(sender.request, endpoint, event);
          expect(await deliverStripe(sender.request, endpoint, event, false)).toBe(400);
          expect(await deliverStripe(sender.request, endpoint, { ...event, account: "acct_unrelated" })).toBe(204);
          expect(await attempts(id)).toEqual([{ id: reserved.id, state: "pending", session_id: null }]);
          expect(await receipts(id)).toEqual([]);
          if (index === 2) {
            expect(await deliver()).toBe(503);
            expect(await receipts(id)).toEqual([]);
          }
          expect(await Promise.all([deliver(), deliver()])).toEqual([204, 204]);
          expect(await attempts(id)).toEqual([{ id: reserved.id, state: index === 2 ? "settled" : "expired", session_id: sessionId }]);
          await page.reload();
          if (index === 2) {
            await expect(sale.getByText("Stripe sandbox card", { exact: true })).toBeVisible();
            const receipt = { id: reserved.id, amount_cents: 6503, method: "card" };
            expect(await receipts(id)).toEqual([receipt]);
            await sale.getByRole("button", { name: "Finish checkout" }).click();
            const refundAmount = sale.getByLabel("Refund amount (DKK)");
            const refundButton = sale.getByRole("button", { name: "Refund in Stripe sandbox" });
            for (const [amount, status] of [["12.02", "failed"], ["13.03", "succeeded"]]) {
              await refundAmount.fill(amount);
              await refundButton.click();
              await expect(sale.getByRole("button", { name: "Check refund status" })).toBeVisible();
              const [pending] = await db`SELECT id, refund_id FROM stripe_sandbox_refund_attempts
                WHERE payment_attempt_id = ${reserved.id} AND state = 'pending'`;
              const refundId = `re_${pending.id.replaceAll("-", "")}`;
              expect(pending.refund_id).toBe(status === "failed" ? refundId : null);
              const refund = {
                object: "event", id: "evt_waybookrefund", livemode: false, account: "acct_checkoutFixture",
                type: status === "failed" ? "refund.failed" : "refund.updated",
                data: { object: { object: "refund", id: refundId, metadata: { waybook_refund_attempt: pending.id } } },
              };
              await page.goto("/nordic/app/sales");
              expect(await deliverStripe(sender.request, endpoint, refund, false)).toBe(400);
              expect(await deliverStripe(sender.request, endpoint, { ...refund, account: "acct_unrelated" })).toBe(204);
              expect(await receipts(id)).toEqual([receipt]);
              const sendRefund = () => deliverStripe(sender.request, endpoint, refund);
              expect(await Promise.all([sendRefund(), sendRefund()])).toEqual([204, 204]);
              expect(await db`SELECT state, refund_id FROM stripe_sandbox_refund_attempts WHERE id = ${pending.id}`)
                .toEqual([{ state: status, refund_id: refundId }]);
              await page.goto(paymentPath);
              if (status === "failed") {
                await expect(sale.getByRole("alert")).toContainText("Stripe declined the last refund.");
                await expect(refundAmount).toHaveValue("65.03");
                expect(await receipts(id)).toEqual([receipt]);
              } else {
                await expect(refundAmount).toHaveValue("52.00");
                expect(await receipts(id)).toEqual([receipt, { id: pending.id, amount_cents: 1303, method: "card" }]);
              }
            }
          } else {
            await expect(sale.getByRole("button", { name: "Record payment" })).toBeVisible();
            expect(await receipts(id)).toEqual([]);
          }
        } finally {
          await sender.close();
        }
        continue;
      }
      await sale.getByRole("button", { name: "Continue in Stripe" }).click();
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
        const refundAmount = sale.getByLabel("Refund amount (DKK)");
        const submitRefund = sale.getByRole("button", { name: "Refund in Stripe sandbox" });
        const checkRefund = sale.getByRole("button", { name: "Check refund status" });
        await expect(refundAmount).toHaveValue("65.01");
        await refundAmount.fill("11.01");
        await submitRefund.click();
        await expect(sale.getByRole("alert")).toContainText("Stripe sandbox refund could not be confirmed.");
        const refundAttempts = () => db`SELECT id, state FROM stripe_sandbox_refund_attempts
          WHERE payment_attempt_id = ${reserved.id} ORDER BY created_at, id`;
        const [pending] = await refundAttempts();
        expect(pending.state).toBe("pending");
        await expect(submitRefund).toHaveCount(0);
        await checkRefund.click();
        await expect(sale.getByRole("status").filter({ hasText: "Stripe is processing" })).toBeVisible();
        expect(await receipts(id)).toEqual(receipt);
        await checkRefund.click();
        await expect(refundAmount).toHaveValue("54.00");
        expect(await refundAttempts()).toEqual([{ id: pending.id, state: "succeeded" }]);
        expect(await receipts(id)).toEqual([...receipt, { id: pending.id, amount_cents: 1101, method: "card" }]);
        await submitRefund.click();
        await expect(refundAmount).toHaveCount(0);
        expect(await receipts(id)).toEqual([...receipt, { id: pending.id, amount_cents: 1101, method: "card" },
          { id: expect.any(String), amount_cents: 5400, method: "card" }]);
        await expect(sale.getByRole("button", { name: "Record payment" })).toHaveCount(0);
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
