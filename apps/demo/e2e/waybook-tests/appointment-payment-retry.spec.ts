import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`manual payments and refunds can be retried without duplicate ledger entries in ${workspace.route}`, async ({ page }) => {
    const db = postgres(process.env[workspace.database]!, { max: 1, ssl: false });
    const marker = randomUUID().slice(0, 8);
    const name = `Receipt retry QA ${marker}`;
    try {
      const booking = await db.begin(async (tx) => {
        const [service] = await tx`SELECT id, tenant_id FROM services WHERE is_active ORDER BY id LIMIT 1`;
        const [location] = await tx`INSERT INTO locations (tenant_id,slug,name,timezone,is_active,is_online_bookable)
          VALUES (${service.tenant_id}, ${`receipt-retry-${marker}`}, ${name}, 'Europe/Copenhagen', false, false) RETURNING id`;
        const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role)
          VALUES (${service.tenant_id}, ${name}, ${`staff-${marker}@example.test`}, 'staff') RETURNING id`;
        const [customer] = await tx`INSERT INTO customers (tenant_id,name,email)
          VALUES (${service.tenant_id}, ${name}, ${`customer-${marker}@example.test`}) RETURNING id`;
        const [block] = await tx`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
          VALUES (${service.tenant_id},${member.id},${location.id},now()-interval '25 hours',now()-interval '24 hours','confirmed')
          RETURNING id,starts_at,ends_at`;
        const [created] = await tx`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,booked_price_cents)
          VALUES (${service.tenant_id},${block.id},${service.id},${member.id},${location.id},${customer.id},${block.starts_at},${block.ends_at},'completed',25050)
          RETURNING id`;
        return created;
      });

      await page.goto("/login");
      await page.getByLabel("Work email").fill(workspace.owner);
      await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${workspace.route}/app`));
      const path = `/${workspace.route}/app/bookings`;
      await page.goto(`${path}?booking=${booking.id}&q=${encodeURIComponent(name)}`);
      const form = page.getByRole("complementary", { name: `Appointment with ${name}` }).locator(".appointment-payment-form");
      const amount = form.getByRole("spinbutton", { name: "Amount (DKK)" });
      const payment = form.getByRole("combobox", { name: "Payment", exact: true });
      const method = form.getByLabel("Method");
      const submit = form.getByRole("button", { name: "Record entry" });
      const retry = form.getByRole("button", { name: "Retry entry" });
      const ledger = () => db`SELECT id, kind, amount_cents, method FROM payment_records WHERE booking_id=${booking.id} ORDER BY recorded_at, id`;
      const eventCount = async () => (await db`SELECT count(*)::int AS count FROM booking_events
        WHERE booking_id=${booking.id} AND event_type IN ('payment.payment','payment.refund')`)[0].count;
      const auditCount = async () => (await db`SELECT count(*)::int AS count FROM tenant_audit_events
        WHERE target_type='payment_record' AND metadata->>'bookingId'=${booking.id}`)[0].count;

      let drop: "before" | "after" | null = null;
      let replyStatuses: number[] = [];
      await page.route(`**${path}**`, async (route) => {
        const request = route.request();
        if (!drop || request.method() !== "POST" || !request.headers()["next-action"]) {
          await route.continue();
          return;
        }
        const interruption = drop;
        drop = null;
        if (interruption === "after") {
          const replies = await Promise.all([route.fetch(), route.fetch()]);
          replyStatuses = replies.map((reply) => reply.status());
        }
        await route.abort("failed");
      });

      await expect(payment).toHaveValue("");
      await expect(payment.locator("option:checked")).toHaveText("Select payment action");
      await expect(submit).toBeDisabled();
      await amount.fill("0");
      await expect(submit).toBeDisabled();
      await method.selectOption("cash");
      await amount.fill("50.25");
      await expect(submit).toBeDisabled();
      expect(await ledger()).toHaveLength(0);
      await payment.selectOption("payment");
      drop = "after";
      await submit.click();
      await expect.poll(() => replyStatuses).toEqual([200, 200]);
      expect(await ledger()).toHaveLength(1);
      await expect(form.getByRole("alert")).toContainText("Could not confirm");
      await expect(amount).toHaveValue("50.25");
      await expect(amount).toBeDisabled();
      await expect(payment).toHaveValue("payment");
      await expect(payment).toBeDisabled();
      await expect(method).toHaveValue("cash");
      const [original] = await ledger();
      expect(original).toMatchObject({ kind: "payment", amount_cents: 5025, method: "cash" });
      await retry.click();
      await expect(form.getByRole("status")).toContainText("Payment recorded");
      expect(await ledger()).toEqual([original]);
      expect(await eventCount()).toBe(1);
      expect(await auditCount()).toBe(1);
      await expect(payment).toHaveValue("");

      await amount.fill("50.25");
      await expect(submit).toBeDisabled();
      await payment.selectOption("payment");
      drop = "before";
      await submit.click();
      await expect(form.getByRole("alert")).toContainText("Could not confirm");
      expect(await ledger()).toEqual([original]);
      await retry.click();
      await expect(form.getByRole("status")).toContainText("Payment recorded");
      const payments = await ledger();
      expect(payments).toHaveLength(2);
      expect(payments[1]).toMatchObject({ kind: "payment", amount_cents: 5025, method: "cash" });
      expect(payments[1].id).not.toBe(original.id);

      await payment.selectOption("refund");
      await amount.fill("100.50");
      replyStatuses = [];
      drop = "after";
      await submit.click();
      await expect(form.getByRole("alert")).toContainText("Could not confirm");
      expect(replyStatuses).toEqual([200, 200]);
      const withRefund = await ledger();
      expect(withRefund).toHaveLength(3);
      expect(withRefund[2]).toMatchObject({ kind: "refund", amount_cents: 10050, method: "cash" });
      await retry.click();
      await expect(form.getByRole("status")).toContainText("Refund recorded");
      expect(await ledger()).toEqual(withRefund);
      expect(await eventCount()).toBe(3);
      expect(await auditCount()).toBe(3);
      await expect(payment).toHaveValue("");
      await expect(submit).toBeDisabled();
    } finally {
      await db.end();
    }
  });
}
