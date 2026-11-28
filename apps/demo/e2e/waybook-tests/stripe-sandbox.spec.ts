import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/calendars)?$/);
}

test("owners can rehearse in Sales and clear only practice sales", { tag: "@mobile" }, async ({ page, browser, baseURL, viewport }) => {
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const tenant = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const path = "/nordic/app/settings?tab=payments";
  const [{ id: tenantId }] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
  const retailPath = "/nordic/app/sales/retail";
  const regularSale = randomUUID();
  const connections = () => control`SELECT account_id, creation_key
    FROM waybook_stripe_sandbox_connections WHERE tenant_id=${tenantId}`;
  try {
    expect(await connections()).toHaveLength(0);
    await page.route("https://accounts.stripe.com/**", (route) => route.fulfill({ body: "Stripe onboarding fixture" }));
    await signIn(page, "owner@nordic.local");
    await page.goto("/nordic/app/settings");
    const payments = page.getByRole("link", { name: "Payments", exact: true });
    await expect(payments).toBeVisible();
    await payments.click();
    const livePanel = page.getByRole("region", { name: "Stripe Connect" });
    const sandboxPanel = page.getByRole("region", { name: "Stripe sandbox" });
    await expect(livePanel.getByRole("status")).toHaveText("Unavailable");
    await expect(sandboxPanel.getByRole("status")).toHaveText("Not linked");
    const logo = sandboxPanel.locator(".payment-provider__logo-light");
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    for (const provider of ["Quickpay", "Nets Easy", "Mollie"]) {
      const row = page.getByRole("region", { name: provider, exact: true });
      await expect(row.getByRole("status")).toHaveText("Planned");
      await expect(row.getByRole("button", { name: `Connect ${provider}` })).toBeDisabled();
      await expect.poll(() => row.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(page.getByRole("heading", { name: "Record payments" })).toHaveCount(0);
    const start = page.getByRole("button", { name: "Set up Stripe sandbox" });
    await start.scrollIntoViewIfNeeded();
    await start.press("Enter");
    await expect(page.getByRole("region", { name: "Stripe sandbox" }).getByRole("alert")).toContainText("Stripe setup could not open");
    const [interrupted] = await connections();
    expect(interrupted.account_id).toBeNull();

    const resume = page.getByRole("button", { name: "Continue Stripe setup", exact: true });
    await resume.click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.stripe\.com\/r\/acct_/);
    const [first] = await connections();
    expect(first.creation_key).toBe(interrupted.creation_key);
    expect(first.account_id).toBe(`acct_${interrupted.creation_key.replaceAll("-", "")}`);
    await page.goto(path + "&stripe=returned");
    await expect(sandboxPanel.getByRole("status")).toHaveText("Setup incomplete");
    await expect(page.getByRole("button", { name: /Check (Stripe|sandbox) status/ })).toHaveCount(0);

    await page.goto(path + "&stripe=resume");
    await expect(page.getByText("Continue setup to open a fresh Stripe link.")).toBeVisible();
    await resume.click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.stripe\.com\/r\/acct_/);
    expect(await connections()).toEqual([first]);
    await page.goto(path + "&stripe=returned");
    await expect(sandboxPanel.getByRole("status")).toHaveText("Test payments on");
    await tenant`INSERT INTO commerce_sales (id,tenant_id,customer_id)
      SELECT ${regularSale},${tenantId},id FROM customers WHERE tenant_id=${tenantId} LIMIT 1`;
    const paymentsBefore = await tenant`SELECT count(*) FROM payment_records WHERE tenant_id=${tenantId}`;
    await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ body: "Stripe sandbox checkout fixture" }));
    await page.getByRole("button", { name: "Start a DKK 10 test payment" }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    const [practice] = await tenant`SELECT id FROM commerce_sales WHERE tenant_id=${tenantId} AND is_stripe_practice AND stripe_practice_cleared_at IS NULL`;
    await page.goto(`${retailPath}?sale=${practice.id}&sandbox=payment-returned`);
    await expect(page.getByRole("link", { name: "Practice sale", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Completed test payment" })).toBeVisible();
    await page.goto(`${retailPath}?sale=${practice.id}&sandbox=payment-returned`);
    await expect(page.getByRole("heading", { name: "Completed test payment" })).toBeVisible();
    expect(await tenant`SELECT amount_cents FROM commerce_sale_transactions WHERE tenant_id=${tenantId} AND sale_id=${practice.id}`)
      .toEqual([{ amount_cents: 1000 }]);
    expect(await tenant`SELECT count(*) FROM payment_records WHERE tenant_id=${tenantId}`).toEqual(paymentsBefore);
    await page.getByRole("link", { name: "Close checkout" }).click();
    const practiceRow = page.getByRole("row").filter({ hasText: "Practice sale" });
    await expect(practiceRow.getByText("Paid", { exact: true })).toBeVisible();
    if (viewport?.width === 390) {
      const table = page.locator(".retail-checkout-history");
      expect(await table.evaluate((element) => element.scrollWidth)).toBe(await table.evaluate((element) => element.clientWidth));
    }
    await page.goto(path);
    await page.getByRole("button", { name: "Clear practice sales (1)", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Practice sales cleared." })).toBeVisible();
    await page.goto(`${retailPath}?sale=${practice.id}`);
    await expect(page.getByRole("link", { name: "Practice sale", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Retail checkout", exact: true }).first()).toBeVisible();
    expect(await tenant`SELECT id FROM commerce_sales WHERE id=${regularSale} AND stripe_practice_cleared_at IS NULL`).toHaveLength(1);

    const appointment = await tenant.begin(async (tx) => {
      const [customer] = await tx`INSERT INTO customers (tenant_id,name,email)
        VALUES (${tenantId},'Practice appointment',${randomUUID() + "@example.test"}) RETURNING id`;
      const [location] = await tx`SELECT id FROM locations WHERE tenant_id=${tenantId} AND slug='primary'`;
      const [service] = await tx`SELECT id FROM services WHERE tenant_id=${tenantId} LIMIT 1`;
      const [member] = await tx`INSERT INTO team_members (tenant_id,name,email,role)
        VALUES (${tenantId},'Practice test provider',${randomUUID() + "@example.test"},'staff') RETURNING id`;
      const [block] = await tx`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state)
        VALUES (${tenantId},${member.id},${location.id},now()+interval '2 days',now()+interval '49 hours','confirmed')
        RETURNING id,starts_at,ends_at`;
      const [booking] = await tx`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,booked_price_cents)
        VALUES (${tenantId},${block.id},${service.id},${member.id},${location.id},${customer.id},${block.starts_at},${block.ends_at},'confirmed',1425) RETURNING id`;
      return booking;
    });
    const appointmentPath = `/nordic/app/sales?booking=${appointment.id}`;
    await page.goto(appointmentPath);
    await page.getByRole("link", { name: "Go to payments", exact: true }).click();
    await page.getByRole("button", { name: "Pay with test card", exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    const [appointmentPractice] = await tenant`SELECT id FROM commerce_sales WHERE tenant_id=${tenantId}
      AND is_stripe_practice AND stripe_practice_cleared_at IS NULL`;
    const appointmentReturn = `${retailPath}?sale=${appointmentPractice.id}&sandbox=payment-returned`;
    await page.goto(appointmentReturn);
    await expect(page.getByRole("heading", { name: "Completed test payment" })).toBeVisible();
    await page.goto(appointmentReturn);
    await expect(page.getByRole("heading", { name: "Completed test payment" })).toBeVisible();
    expect(await tenant`SELECT amount_cents FROM commerce_sale_transactions WHERE tenant_id=${tenantId} AND sale_id=${appointmentPractice.id}`)
      .toEqual([{ amount_cents: 1425 }]);
    expect(await tenant`SELECT id FROM payment_records WHERE booking_id=${appointment.id}`).toHaveLength(0);
    expect(await tenant`SELECT status FROM bookings WHERE id=${appointment.id}`).toEqual([{ status: "confirmed" }]);
    await page.goto(path);
    await page.getByRole("button", { name: "Clear practice sales (1)", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Practice sales cleared." })).toBeVisible();
    await page.goto(`${retailPath}?sale=${appointmentPractice.id}`);
    await expect(page.getByRole("link", { name: "Practice sale", exact: true })).toHaveCount(0);

    const otherContext = await browser.newContext({ baseURL, viewport });
    try {
      const other = await otherContext.newPage();
      await signIn(other, "owner@copenhagen-physio.local");
      await other.goto("/copenhagen/app/settings?tab=payments");
      await expect(other.getByRole("button", { name: "Set up Stripe sandbox" })).toBeVisible();
      await expect(other.getByRole("link", { name: "View test payments in Sales" })).toHaveCount(0);
      expect((await other.goto(path))?.status()).toBe(404);
    } finally {
      await otherContext.close();
    }

    for (const role of ["manager", "staff"]) {
      const context = await browser.newContext({ baseURL, viewport });
      const email = `stripe-${randomUUID()}@example.test`;
      let identityId: string | undefined;
      try {
        const [identity] = await control`INSERT INTO identities (email,password_hash,display_name)
          SELECT ${email},password_hash,'Stripe access QA' FROM identities WHERE email='owner@nordic.local' RETURNING id`;
        identityId = identity.id;
        await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identityId},${role})`;
        await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email)
          VALUES (${tenantId},${identityId},${role},'Stripe access QA',${email})`;
        const restricted = await context.newPage();
        await signIn(restricted, email);
        await restricted.goto("/nordic/app/settings");
        await expect(restricted.getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
        expect((await restricted.goto(path))?.status()).toBe(404);
        expect(await connections()).toEqual([first]);
      } finally {
        await context.close();
        if (identityId) {
          await tenant`DELETE FROM team_members WHERE tenant_id=${tenantId} AND identity_id=${identityId}`;
          await control`DELETE FROM identities WHERE id=${identityId}`;
        }
      }
    }
  } finally {
    await tenant`DELETE FROM commerce_sales WHERE id=${regularSale} AND tenant_id=${tenantId}`;
    await control`DELETE FROM waybook_stripe_sandbox_connections WHERE tenant_id=${tenantId}`;
    await Promise.all([control.end(), tenant.end()]);
  }
});
