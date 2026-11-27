import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

for (const settleRemainder of [false, true]) test(
  settleRemainder ? "partial gift-card tender leaves one manual remainder on the same sale" : "gift-card tender returns to the same card on cancellation",
  { tag: settleRemainder ? "@mobile" : [] }, async ({ page, browser, baseURL, ignoreHTTPSErrors }, testInfo) => {
  test.setTimeout(180_000);
  const raw = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const url = new URL(raw);
  if (!/^\/waybook_(i28|e2e)_/.test(url.pathname)) throw new Error("Gift-card tests require a disposable database.");
  const db = postgres(raw, { max: 2, ssl: ["localhost", "127.0.0.1"].includes(url.hostname) ? false : "require" });
  const controlRaw = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  if (!/^\/waybook_(i28|e2e)_/.test(new URL(controlRaw).pathname)) throw new Error("Gift-card tests require disposable Control data.");
  const control = postgres(controlRaw, { max: 1, ssl: ["localhost", "127.0.0.1"].includes(new URL(controlRaw).hostname) ? false : "require" });
  const unique = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const email = `gift-${unique.toLowerCase()}@example.invalid`;
  const code = `TEST${unique}`;
  const digest = createHmac("sha256", process.env.WAYBOOK_GIFT_CARD_CODE_SECRET!).update(code).digest("hex");
  try {
    const [settings] = await db<{ tenantId: string; currency: string }[]>`SELECT tenant_id AS "tenantId",currency FROM tenant_settings LIMIT 1`;
    const [member] = await db<{ id: string; locationId: string }[]>`SELECT tm.id, tml.location_id AS "locationId" FROM team_members tm JOIN team_member_locations tml ON tml.tenant_id=tm.tenant_id AND tml.team_member_id=tm.id JOIN locations l ON l.id=tml.location_id AND l.tenant_id=tm.tenant_id
      WHERE tm.tenant_id=${settings.tenantId} AND tm.role='owner' AND tm.is_active AND l.slug='primary' AND l.is_active LIMIT 1`;
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${settings.tenantId} AND slug='studio-session'`;
    const date = new Date("2028-01-01T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + (Number.parseInt(unique.slice(0, 6), 16) % 700));
    const day = date.toISOString().slice(0, 10);
    const fixture = await db.begin(async tx => {
      const [client] = await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},${`Synthetic Gift ${unique}`},${email}) RETURNING id`;
      const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${member.locationId},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed') RETURNING id`;
      const [booking] = await tx<{ id: string; number: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents) VALUES (${settings.tenantId},${block.id},${service.id},${member.id},${member.locationId},${client.id},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed','tenant',65000) RETURNING id,booking_number AS number`;
      if (settleRemainder) {
        await tx`UPDATE bookings SET status='arrived', attendance_stage='in_service' WHERE tenant_id=${settings.tenantId} AND id=${booking.id}`;
        await tx`UPDATE bookings SET attendance_stage='checking_out' WHERE tenant_id=${settings.tenantId} AND id=${booking.id}`;
      }
      const [sale] = await tx<{ id: string }[]>`SELECT id FROM commerce_sales WHERE tenant_id=${settings.tenantId} AND booking_id=${booking.id}`;
      const [card] = await tx<{ id: string }[]>`INSERT INTO commerce_gift_cards (tenant_id,issued_to_customer_id,code_hash,code_hash_version,code_last_four,currency) VALUES (${settings.tenantId},${client.id},${digest},2,${unique.slice(-4)},${settings.currency}) RETURNING id`;
      await tx`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason) VALUES (${settings.tenantId},${card.id},'issue','credit',50000,${settings.currency},'Synthetic test issue')`;
      return { booking, sale, card };
    });

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/nordic\/app/, { timeout: 30_000 });
    await page.goto(`/nordic/app/sales?sale=${fixture.sale.id}`);
    await page.getByRole("link", { name: "Go to payments" }).click();
    await page.getByRole("link", { name: "Gift card", exact: true }).click();
    await expect(page.getByRole("form", { name: "Gift card", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Other payment methods" }).click();
    await expect(page.getByRole("radio", { name: "Cash" })).toBeVisible();
    await page.getByRole("link", { name: "Gift card", exact: true }).click();
    const giftAmount = page.getByRole("form", { name: "Gift card", exact: true }).getByLabel("Amount (DKK)");
    await page.getByLabel("Gift-card number").fill("INVALID12345");
    await giftAmount.fill("100");
    await page.getByRole("button", { name: "Use gift card" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The gift card could not be used" })).toBeVisible({ timeout: 30_000 });
    await expect(giftAmount).toHaveValue("100");
    console.log("Invalid card produced a safe error");
    await page.getByLabel("Gift-card number").fill(code);
    if (testInfo.project.name === "desktop") {
      const readEmail = `readonly-${unique.toLowerCase()}@example.invalid`;
      const [owner] = await control<{ passwordHash: string }[]>`SELECT password_hash AS "passwordHash" FROM identities WHERE email='owner@nordic.local'`;
      const [readIdentity] = await control<{ id: string }[]>`INSERT INTO identities (email,password_hash,display_name) VALUES (${readEmail},${owner.passwordHash},'Synthetic read-only') RETURNING id`;
      await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${settings.tenantId},${readIdentity.id},'read-only')`;
      await db`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${settings.tenantId},${readIdentity.id},'read-only','Synthetic read-only',${readEmail})`;
      const readContext = await browser.newContext({ baseURL, ignoreHTTPSErrors });
      try {
        const readPage = await readContext.newPage();
        await readPage.goto("/login"); await readPage.getByLabel("Work email").fill(readEmail);
        await readPage.getByPlaceholder("Enter your password").fill("waybook-local-only");
        await readPage.getByRole("button", { name: "Sign in" }).click();
        await expect(readPage).toHaveURL(/\/nordic\/app/, { timeout: 30_000 });
        console.log("Read-only test account signed in");
        let capture!: (request: import("@playwright/test").Request) => void;
        const intercepted = new Promise<import("@playwright/test").Request>(resolve => { capture = resolve; });
        await page.route("**/nordic/app/sales**", async route => {
          if (route.request().method() === "POST" && route.request().headers()["next-action"]) { capture(route.request()); await route.abort(); }
          else await route.continue();
        });
        await page.getByRole("button", { name: "Use gift card" }).click();
        const request = await Promise.race([intercepted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gift-card request was not captured")), 15_000))]);
        await page.unroute("**/nordic/app/sales**");
        const body = request.postDataBuffer();
        if (!body) throw new Error("The text-only gift-card action request could not be captured.");
        const sourceHeaders = request.headers();
        const headers: Record<string, string> = { Origin: new URL(request.url()).origin, "Content-Type": sourceHeaders["content-type"], "Next-Action": sourceHeaders["next-action"], Accept: sourceHeaders.accept ?? "text/x-component" };
        if (sourceHeaders["next-router-state-tree"]) headers["Next-Router-State-Tree"] = sourceHeaders["next-router-state-tree"];
        await readContext.request.post(request.url(), { headers, data: body, maxRedirects: 0 });
        const [afterDenied] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM commerce_gift_card_entries WHERE booking_id=${fixture.booking.id} AND kind='redeem'`;
        expect(afterDenied.count).toBe(0);
        await page.request.post(request.url(), { headers, data: body, maxRedirects: 0 });
        const [afterOwner] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM commerce_gift_card_entries WHERE booking_id=${fixture.booking.id} AND kind='redeem'`;
        expect(afterOwner.count).toBe(1);
        await page.goto(`/nordic/app/sales?sale=${fixture.sale.id}&step=payment`);
      } finally { await readContext.close(); }
    } else {
      await page.getByRole("button", { name: "Use gift card" }).click();
    }
    const checkout = page.getByRole("dialog", { name: "Appointment checkout" });
    await expect(checkout.getByText("Gift card applied. Record the remaining balance.")).toBeVisible();
    await expect(checkout.getByLabel("Amount (DKK)")).toHaveValue("550.00");
    await expect(checkout.getByLabel("Amount (DKK)")).not.toBeEditable();
    await expect(checkout.getByRole("link", { name: "Gift card", exact: true })).toHaveCount(0);
    await expect(checkout.getByRole("button", { name: "Finish checkout", exact: true })).toHaveCount(0);
    const [afterPay] = await db<{ debits: number; payments: number; transactions: number }[]>`
      SELECT (SELECT count(*)::int FROM commerce_gift_card_entries WHERE booking_id=${fixture.booking.id} AND kind='redeem') AS debits,
        (SELECT count(*)::int FROM payment_records WHERE booking_id=${fixture.booking.id} AND method='gift_card' AND kind='payment') AS payments,
        (SELECT count(*)::int FROM commerce_sale_transactions WHERE sale_id=${fixture.sale.id} AND method='gift_card' AND kind='payment') AS transactions
    `;
    expect(afterPay).toMatchObject({ debits: 1, payments: 1, transactions: 1 });

    if (settleRemainder) {
      await checkout.getByRole("radio", { name: "Cash", exact: true }).check();
      await checkout.getByLabel("Amount (DKK)").evaluate((input: HTMLInputElement) => { input.value = "549.99"; });
      await checkout.getByRole("button", { name: "Record payment" }).click();
      await expect(checkout.getByRole("alert")).toContainText("Record the full balance remaining after the gift-card payment.");
      expect(await db`SELECT id FROM payment_records WHERE booking_id=${fixture.booking.id} AND method='cash'`).toEqual([]);
      await expect(checkout.getByLabel("Amount (DKK)")).toHaveValue("550.00");

      const stalePage = await page.context().newPage();
      try {
        await stalePage.goto(page.url());
        await stalePage.getByRole("radio", { name: "Cash", exact: true }).check();
        await checkout.getByRole("radio", { name: "Cash", exact: true }).check();
        await checkout.getByRole("button", { name: "Record payment" }).click();
        await expect(checkout.getByText("Paid SALE", { exact: true })).toBeVisible();
        await stalePage.getByRole("button", { name: "Record payment and finish checkout", exact: true }).click();
        await expect(stalePage.getByRole("dialog", { name: "Appointment checkout" }).getByRole("alert"))
          .toContainText("This checkout is already complete.");
      } finally {
        await stalePage.close();
      }
      expect(await db`SELECT method, amount_cents FROM payment_records WHERE booking_id=${fixture.booking.id} ORDER BY method`)
        .toEqual([{ method: "cash", amount_cents: 55000 }, { method: "gift_card", amount_cents: 10000 }]);
      await expect.poll(async () => (await db`SELECT status FROM bookings WHERE id=${fixture.booking.id}`)[0].status).toBe("completed");
      expect(await db`SELECT id FROM commerce_sales WHERE booking_id=${fixture.booking.id}`).toEqual([fixture.sale]);
      return;
    }

    await checkout.getByRole("link", { name: "Back to checkout" }).click();
    await expect(checkout.getByText("A gift card has been used for this appointment.")).toBeVisible();

    await db`UPDATE commerce_gift_cards SET status='void',expires_at=now()-interval '1 day' WHERE id=${fixture.card.id} AND tenant_id=${settings.tenantId}`;
    if (testInfo.project.name === "mobile") {
      await page.getByRole("link", { name: "Open appointment" }).click();
      await expect(page).toHaveURL((url) => /\/app\/(calendars|bookings)$/.test(url.pathname)
        && url.searchParams.get("booking") === fixture.booking.id);
      if (new URL(page.url()).pathname.endsWith("/calendars")) {
        await page.getByRole("button", { name: "More appointment actions" }).click();
        await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
        await page.getByRole("alertdialog", { name: "Cancel this appointment?" })
          .getByRole("button", { name: "Cancel appointment" }).click();
      } else {
        await page.getByRole("button", { name: "Cancel appointment" }).click({ timeout: 30_000 });
      }
      await expect(page.getByText("This appointment has been cancelled.", { exact: false })).toBeVisible({ timeout: 30_000 });
    } else {
      await page.goto("/nordic/book");
      await page.getByRole("button", { name: "Manage booking" }).click();
      await page.getByLabel("Booking number").fill(fixture.booking.number);
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Find booking" }).click();
      await page.getByRole("button", { name: "Cancel booking" }).click();
      await expect(page.getByText("Your gift-card payment will be returned to the same card.")).toBeVisible();
      const trigger = `waybook_test_refund_${unique.toLowerCase()}`;
      await db.unsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='appointment_sale.gift_card_refunded' AND NEW.target_id='${fixture.sale.id}' THEN RAISE EXCEPTION 'Synthetic refund audit failure'; END IF; RETURN NEW; END $$`);
      await db.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON tenant_audit_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
      try {
        await page.getByRole("button", { name: "Confirm cancellation" }).click();
        await expect(page.getByText("We couldn’t process your request. Please try again later.")).toBeVisible({ timeout: 30_000 });
        const [rolledBack] = await db<{ status: string; cardStatus: string; refunds: number }[]>`
          SELECT b.status,gc.status AS "cardStatus",(SELECT count(*)::int FROM commerce_gift_card_entries WHERE booking_id=b.id AND kind='refund') AS refunds
          FROM bookings b JOIN commerce_gift_cards gc ON gc.id=${fixture.card.id} WHERE b.id=${fixture.booking.id}
        `;
        expect(rolledBack).toMatchObject({ status: "confirmed", cardStatus: "void", refunds: 0 });
      } finally {
        await db.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON tenant_audit_events`);
        await db.unsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
      }
      await page.getByRole("button", { name: "Confirm cancellation" }).click();
      await expect(page.getByText("Your booking has been cancelled.")).toBeVisible({ timeout: 30_000 });
    }
    const [afterCancel] = await db<{ status: string; expiry: Date | null; balance: number; refunds: number; payments: number; transactions: number }[]>`
      SELECT gc.status,gc.expires_at AS expiry,
        (SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::int FROM commerce_gift_card_entries WHERE gift_card_id=gc.id) AS balance,
        (SELECT count(*)::int FROM commerce_gift_card_entries WHERE booking_id=${fixture.booking.id} AND kind='refund') AS refunds,
        (SELECT count(*)::int FROM payment_records WHERE booking_id=${fixture.booking.id} AND method='gift_card' AND kind='refund') AS payments,
        (SELECT count(*)::int FROM commerce_sale_transactions WHERE sale_id=${fixture.sale.id} AND method='gift_card' AND kind='refund') AS transactions
      FROM commerce_gift_cards gc WHERE gc.id=${fixture.card.id} AND gc.tenant_id=${settings.tenantId}
    `;
    expect(afterCancel).toMatchObject({ status: "active", expiry: null, balance: 50000, refunds: 1, payments: 1, transactions: 1 });
    const retry = await page.request.post("/nordic/api/public/manage", { headers: { Origin: new URL(page.url()).origin }, data: { action: "cancel", bookingId: fixture.booking.number, email } });
    expect(retry.status()).toBe(200);
    const [repeat] = await db<{ refunds: number }[]>`SELECT count(*)::int AS refunds FROM commerce_gift_card_entries WHERE booking_id=${fixture.booking.id} AND kind='refund'`;
    expect(repeat.refunds).toBe(1);
  } finally { await db.end(); await control.end(); }
});
