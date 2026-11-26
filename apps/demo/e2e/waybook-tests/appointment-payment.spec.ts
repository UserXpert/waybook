import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("appointment payment and refund limits preserve exact amounts in Reports", async ({ page }) => {
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const marker = randomUUID().slice(0, 8);
  const customerName = `Payment QA ${marker}`;
  const customerEmail = `payment-qa-${marker}@example.test`;
  try {
    const booking = await db.begin(async (tx) => {
      const [workspace] = await tx`SELECT tenant_id FROM tenant_settings LIMIT 1`;
      const [location] = await tx`INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${workspace.tenant_id},${`payment-qa-${marker}`},${`Payment QA location ${marker}`},'Europe/Copenhagen') RETURNING id`;
      const [service] = await tx`SELECT id FROM services WHERE tenant_id=${workspace.tenant_id} AND title='Studio session'`;
      const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role) VALUES (${workspace.tenant_id},${`Z QA payment staff ${marker}`},${`staff-${customerEmail}`},'staff') RETURNING id`;
      const [customer] = await tx`INSERT INTO customers (tenant_id,name,email) VALUES (${workspace.tenant_id},${customerName},${customerEmail}) RETURNING id`;
      const [block] = await tx`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${workspace.tenant_id},${member.id},${location.id},now()-interval '25 hours',now()-interval '24 hours','confirmed') RETURNING id,starts_at,ends_at`;
      const [created] = await tx`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,booked_price_cents)
        VALUES (${workspace.tenant_id},${block.id},${service.id},${member.id},${location.id},${customer.id},${block.starts_at},${block.ends_at},'arrived',25050) RETURNING id, location_id`;
      return created;
    });

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto(`/nordic/app/bookings?booking=${booking.id}&q=${encodeURIComponent(customerName)}`);
    const drawer = page.getByRole("complementary", { name: `Appointment with ${customerName}` });
    await expect(drawer.getByRole("heading", { name: "Sales ledger" })).toBeVisible();
    const form = drawer.locator(".appointment-payment-form");
    const amount = form.getByRole("spinbutton", { name: "Amount (DKK)" });
    const payment = form.getByRole("combobox", { name: "Payment", exact: true });
    const submit = form.getByRole("button", { name: "Record entry" });
    await expect(submit).toBeDisabled();
    await expect(amount).toHaveValue("250.50");
    await payment.selectOption("payment");
    await form.getByLabel("Method").selectOption("cash");
    await amount.fill("301");
    await submit.click();
    await expect(form.getByRole("alert")).toContainText("appointment payment cannot exceed booked service value");
    expect(await db`SELECT id FROM payment_records WHERE booking_id=${booking.id}`).toHaveLength(0);
    await expect(form.getByLabel("Method")).toHaveValue("cash");
    await expect(payment).toHaveValue("payment");
    await expect(amount).toHaveValue("301");

    await amount.fill("150.50");
    await submit.click();
    await expect(form.getByRole("status")).toContainText("Payment recorded");
    await expect(submit).toBeDisabled();
    await expect(amount).toHaveValue("");
    await expect(payment.locator('option[value="payment"]')).toHaveCount(0);
    await payment.selectOption("refund");
    await form.getByLabel("Method").selectOption("cash");
    await amount.fill("40.25");
    await submit.click();
    await expect(form.getByRole("status")).toContainText("Refund recorded");
    await expect(submit).toBeDisabled();
    await expect(payment).toHaveValue("");
    await payment.selectOption("refund");
    await amount.fill("151");
    await submit.click();
    await expect(form.getByRole("alert")).toContainText("appointment refund cannot exceed collected payment");
    expect(await db`SELECT kind, amount_cents, method FROM payment_records WHERE booking_id=${booking.id} ORDER BY recorded_at`).toEqual([
      { kind: "payment", amount_cents: 15_050, method: "cash" },
      { kind: "refund", amount_cents: 4_025, method: "cash" },
    ]);

    await page.goto("/nordic/app/reports?range=7&sort=newest");
    const paymentRows = page.getByRole("row").filter({ hasText: customerName });
    const money = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });
    const rowFor = (kind: string) => paymentRows.filter({ has: page.getByRole("cell", { name: kind, exact: true }) });
    await expect.soft(rowFor("payment")).toContainText(money.format(150.5));
    await expect(rowFor("refund")).toContainText(money.format(40.25));

    const [monthly] = await db<{ cents: number }[]>`
      SELECT coalesce(sum(CASE kind WHEN 'payment' THEN amount_cents ELSE -amount_cents END), 0)::int AS cents
      FROM payment_records
      WHERE recorded_at >= date_trunc('month', now(), 'Europe/Copenhagen')
    `;
    await page.goto("/nordic/app");
    const net = page.getByText("Net payments", { exact: true }).locator("..");
    const overviewMoney = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    await expect(net).toContainText(overviewMoney.format(monthly.cents / 100));

    const [sale] = await db`SELECT id FROM commerce_sales WHERE booking_id=${booking.id}`;
    await db`UPDATE locations SET is_active=false WHERE id=${booking.location_id}`;
    await page.goto(`/nordic/app/sales?sale=${sale.id}`);
    await page.getByRole("link", { name: "Open appointment", exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(payment).toHaveValue("");
    await expect(submit).toBeDisabled();
    expect(new URL(page.url()).searchParams.get("booking")).toBe(booking.id);
    expect(new URL(page.url()).searchParams.get("day")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(drawer.getByRole("button", { name: "Edit payment" })).toBeVisible();
    await expect(payment.locator('option[value="payment"]')).toHaveCount(0);

    await drawer.getByRole("link", { name: "Checkout", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Appointment checkout" })).toContainText(customerName);

    await page.goto(`/nordic/app/sales?q=${encodeURIComponent(customerName)}`);
    await page.getByRole("cell", { name: customerName, exact: true }).click();
    const saleDrawer = page.getByRole("dialog", { name: "Appointment checkout" });
    await expect(saleDrawer.getByRole("link", { name: "Open appointment" })).toBeVisible();
    await saleDrawer.getByLabel("Phone").fill("+45 31 22 33 44");
    await saleDrawer.getByRole("button", { name: "Save details" }).click();
    await expect(saleDrawer.getByText("Details saved.", { exact: true })).toBeVisible();
    expect((await db`SELECT phone FROM customers WHERE email=${customerEmail}`)[0].phone).toBe("+45 31 22 33 44");

    const salePayment = saleDrawer.locator(".appointment-payment-form");
    await expect(salePayment).toHaveCount(0);
    await saleDrawer.getByRole("button", { name: "Edit payment", exact: true }).click();
    await expect(saleDrawer.getByLabel("Amount (DKK)")).toHaveValue("150.50");
    await saleDrawer.getByLabel("Amount (DKK)").fill("160.50");
    await saleDrawer.getByLabel("Method").selectOption("bank_transfer");
    await saleDrawer.getByRole("button", { name: "Save payment" }).click();
    await expect(saleDrawer.locator(".recorded-appointment-payments")).toContainText("160,50");
    await expect(saleDrawer.locator(".recorded-appointment-payments")).toContainText("Bank transfer");
    await expect(saleDrawer.getByText("Payment adjustment · bank transfer", { exact: true })).toBeVisible();

    await saleDrawer.getByRole("button", { name: "Delete payment", exact: true }).click();
    await saleDrawer.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(salePayment).toHaveCount(0);
    await saleDrawer.getByRole("button", { name: "Delete payment", exact: true }).click();
    await saleDrawer.getByRole("button", { name: "Confirm deletion" }).click();
    await saleDrawer.getByRole("link", { name: "Go to payments" }).click();
    await expect(salePayment.getByLabel("Amount (DKK)")).toHaveValue("250.50");
    await expect(salePayment.getByRole("button", { name: "Record payment" })).toBeDisabled();
    await saleDrawer.getByRole("link", { name: "Back to checkout" }).click();
    await expect(salePayment).toHaveCount(0);
    await saleDrawer.getByRole("link", { name: "Go to payments" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "payment");
    await expect(salePayment.getByLabel("Method")).toBeVisible();

    const staleTab = await page.context().newPage();
    try {
      await staleTab.goto(page.url());
      const stalePayment = staleTab.getByRole("dialog", { name: "Appointment checkout" }).locator(".appointment-payment-form");
      await stalePayment.getByLabel("Method").selectOption("card");
      await salePayment.getByLabel("Method").selectOption("card");
      await salePayment.getByRole("button", { name: "Record payment" }).click();
      await expect(salePayment).toHaveCount(0);
      await expect(saleDrawer.locator(".recorded-appointment-payments")).toContainText("250,50");
      await stalePayment.getByRole("button", { name: "Record payment" }).click();
      await expect(stalePayment.getByRole("alert")).toContainText("A payment is already recorded.");
    } finally {
      await staleTab.close();
    }
    const entries = await db`SELECT kind, amount_cents, method FROM payment_records WHERE booking_id=${booking.id} ORDER BY recorded_at, id`;
    expect(entries).toEqual([
      { kind: "payment", amount_cents: 15_050, method: "cash" },
      { kind: "refund", amount_cents: 4_025, method: "cash" },
      { kind: "payment", amount_cents: 1_000, method: "bank_transfer" },
      { kind: "refund", amount_cents: 12_025, method: "bank_transfer" },
      { kind: "payment", amount_cents: 25_050, method: "card" },
    ]);
    await page.keyboard.press("Escape");
    await expect(saleDrawer).toHaveCount(0);
    await page.goto("/nordic/app/sales");
    await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("payment-newest");
    await page.getByRole("combobox", { name: "Payment activity", exact: true }).selectOption("with");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Payments", exact: true })).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("tbody tr").first()).toContainText(customerName);
    await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("payment-oldest");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Payments", exact: true })).toHaveAttribute("aria-sort", "ascending");
  } finally {
    await db.end();
  }
});
