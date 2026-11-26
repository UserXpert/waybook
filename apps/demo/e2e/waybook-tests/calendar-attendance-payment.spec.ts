import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const [bookedCents, productCents] of [[25050, 0], [0, 0], [0, 3750]]) test(`calendar saves payment and completion together for a ${bookedCents ? "paid service" : productCents ? "product-only cart" : "zero-price no-show"}`, async ({ page }, testInfo) => {
  const due = bookedCents + productCents;
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const marker = randomUUID().slice(0, 8);
  const name = `Calendar attendance ${marker}`;
  try {
    const booking = await db.begin(async (tx) => {
      const [settings] = await tx`SELECT tenant_id FROM tenant_settings LIMIT 1`;
      const [location] = await tx`SELECT id FROM locations WHERE tenant_id=${settings.tenant_id} AND slug='primary'`;
      const [service] = await tx`SELECT id FROM services WHERE tenant_id=${settings.tenant_id} AND slug='studio-session'`;
      const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${settings.tenant_id},${name},${`staff-attendance-${marker}@example.test`},'staff') RETURNING id`;
      await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id)
        VALUES (${settings.tenant_id},${member.id},${location.id})`;
      const [customer] = await tx`INSERT INTO customers (tenant_id,name,email)
        VALUES (${settings.tenant_id},${name},${`attendance-${marker}@example.test`}) RETURNING id`;
      const [block] = await tx`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${settings.tenant_id},${member.id},${location.id},now()-interval '25 hours',now()-interval '24 hours','confirmed')
        RETURNING id,starts_at,ends_at`;
      const [result] = await tx<{ id: string }[]>`INSERT INTO bookings
        (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,booked_price_cents)
        VALUES (${settings.tenant_id},${block.id},${service.id},${member.id},${location.id},${customer.id},${block.starts_at},${block.ends_at},'arrived',${bookedCents})
        RETURNING id`;
      if (productCents) {
        await tx`INSERT INTO commerce_sale_lines (tenant_id,sale_id,line_kind,title_snapshot,unit_price_cents)
          SELECT tenant_id,id,'product','No-show cart fixture',${productCents}
          FROM commerce_sales WHERE tenant_id=${settings.tenant_id} AND booking_id=${result.id}`;
      }
      return { ...result, customerId: customer.id, startsAt: new Date(block.starts_at), location: location.id, employee: member.id };
    });

    await page.emulateMedia({ colorScheme: testInfo.project.name === "mobile" ? "dark" : "light" });
    await page.goto("/nordic/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(booking.startsAt);
    const calendarParams = new URLSearchParams({ location: booking.location, employee: booking.employee, day, view: "staff", booking: booking.id });
    const url = `/nordic/app/calendars?${calendarParams}`;
    await page.goto(url);
    const drawer = page.getByRole("dialog", { name: `Appointment with ${name}` });
    const readStatus = async () => (await db`SELECT status FROM bookings WHERE id=${booking.id}`)[0].status;
    const close = drawer.getByRole("button", { name: "Close appointment" });
    const closeState = () => close.evaluate((button) => {
      const style = getComputedStyle(button);
      const line = getComputedStyle(button, "::before");
      const box = button.getBoundingClientRect();
      return { background: style.backgroundColor, borderRadius: style.borderRadius, glyph: line.backgroundColor, width: box.width, height: box.height, left: line.left, top: line.top };
    });
    const before = await closeState();
    await close.hover();
    await expect.poll(async () => (await closeState()).background).not.toBe(before.background);
    const { background: _, ...hoverShape } = await closeState();
    const { background: __, ...restShape } = before;
    expect(hoverShape).toEqual(restShape);
    expect(hoverShape.width).toBe(hoverShape.height);
    expect(hoverShape.borderRadius).toBe("50%");

    const noShow = drawer.getByRole("button", { name: "No show", exact: true });
    const complete = drawer.getByRole("button", { name: "Completed", exact: true });
    const save = drawer.getByRole("button", { name: "Save changes", exact: true });
    await expect(save).toBeDisabled();
    await noShow.click();
    await expect(noShow).toHaveAttribute("aria-pressed", "true");
    expect(await readStatus()).toBe("arrived");
    await save.click();
    await expect.poll(readStatus).toBe("no_show");
    await expect(complete).toBeEnabled();
    const amount = drawer.getByLabel(due ? "Amount (DKK)" : "No-show fee (DKK)", { exact: true });
    await expect(drawer.getByRole("heading", { name: "Payment details" })).toBeVisible();
    await expect(amount).toBeVisible();
    await expect(save).toBeDisabled();
    await complete.click();
    const phone = "+45 55 42 11 01";
    await drawer.getByLabel("Phone", { exact: true }).fill(phone);
    const savedPhone = async () => (await db`SELECT phone FROM customers WHERE id=${booking.customerId}`)[0].phone;

    if (due) {
      await save.click();
      await expect(drawer.getByRole("alert")).toContainText("Record a payment before marking this no-show as completed.");
      expect(await readStatus()).toBe("no_show");
      expect(await savedPhone()).toBeNull();
      await expect(drawer.getByLabel("Phone", { exact: true })).toHaveValue(phone);
      await amount.fill("300");
      await save.click();
      await expect(drawer.getByRole("alert")).toContainText(productCents ? "appointment payment cannot exceed the checkout total" : "appointment payment cannot exceed booked service value");
      expect(await readStatus()).toBe("no_show");
      expect(await db`SELECT id FROM payment_records WHERE booking_id=${booking.id}`).toHaveLength(0);
    }

    const paymentCents = due || 12550;
    await amount.fill((paymentCents / 100).toFixed(2));
    await drawer.getByRole("combobox", { name: "Method", exact: true }).selectOption("cash");
    await expect(drawer.getByRole("button", { name: "Record entry", exact: true })).toHaveCount(0);
    const staleTab = await page.context().newPage();
    try {
      await staleTab.goto(url);
      const staleDrawer = staleTab.getByRole("dialog", { name: `Appointment with ${name}` });
      await staleDrawer.getByRole("button", { name: "Completed", exact: true }).click();
      await staleDrawer.getByLabel(due ? "Amount (DKK)" : "No-show fee (DKK)", { exact: true }).fill("100");

      await expect(complete).toHaveAttribute("aria-pressed", "true");
      expect(await readStatus()).toBe("no_show");
      expect(await db`SELECT id FROM payment_records WHERE booking_id=${booking.id}`).toHaveLength(0);
      await save.click();
      await expect.poll(readStatus).toBe("completed");
      expect(await savedPhone()).toBe(phone);
      await expect(drawer.getByText("This appointment’s status is final and cannot be changed.")).toBeVisible();

      await staleDrawer.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(staleDrawer.getByRole("alert")).toContainText("The appointment status has changed.");
      expect(await db`SELECT kind, amount_cents, method FROM payment_records WHERE booking_id=${booking.id}`).toEqual([
        { kind: "payment", amount_cents: paymentCents, method: "cash" },
      ]);
      expect((await db`SELECT booked_price_cents, no_show_charge_cents FROM bookings WHERE id=${booking.id}`)[0]).toEqual({
        booked_price_cents: bookedCents, no_show_charge_cents: due ? 0 : paymentCents,
      });
      if (!due) {
        const [sale] = await db`SELECT id FROM commerce_sales WHERE booking_id=${booking.id}`;
        await staleTab.goto(`/nordic/app/sales?sale=${sale.id}`);
        await expect(staleTab.getByRole("dialog", { name: "Appointment checkout" }).getByText("No-show fee", { exact: true })).toBeVisible();
      }
    } finally {
      await staleTab.close();
    }
    await close.click();
    await expect(drawer).toHaveCount(0);
  } finally {
    await db.end();
  }
});
