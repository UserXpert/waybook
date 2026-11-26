import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

test("book two services with separate providers and settle one sale", async ({ page }) => {
  page.setDefaultTimeout(8000);
  const database = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const url = new URL(database);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Linked appointment QA requires a disposable local database.");
  }
  const sql = postgres(database, { max: 1, ssl: false });
  const tag = randomUUID().slice(0, 8);
  const clientName = `Linked client ${tag}`;
  const clientEmail = `linked-${tag}@example.test`;
  try {
    const [{ tenantId, timezone, day }] = await sql<{ tenantId: string; timezone: string; day: string }[]>`
      SELECT tenant_id AS "tenantId", timezone, ((now() AT TIME ZONE timezone)::date + 3)::text AS day FROM tenant_settings LIMIT 1
    `;
    const [location] = await sql`INSERT INTO locations (tenant_id, slug, name, timezone)
      VALUES (${tenantId}, ${`linked-${tag}`}, ${`Linked studio ${tag}`}, ${timezone}) RETURNING id`;
    const [first, second] = await sql`INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
      VALUES (${tenantId}, ${`first-${tag}`}, ${`First treatment ${tag}`}, 45, 7000),
             (${tenantId}, ${`second-${tag}`}, ${`Second treatment ${tag}`}, 30, 3000) RETURNING id, title`;
    const [primary, secondary] = await sql`INSERT INTO team_members (tenant_id, name, email, role)
      VALUES (${tenantId}, ${`Primary provider ${tag}`}, ${`primary-${tag}@example.test`}, 'staff'),
             (${tenantId}, ${`Second provider ${tag}`}, ${`second-${tag}@example.test`}, 'staff') RETURNING id, name`;
    const providers = [primary.id, secondary.id];
    await sql`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
      SELECT ${tenantId}, ${location.id}, day, '09:00', '17:00' FROM generate_series(0,6) AS day`;
    await sql`INSERT INTO service_locations (tenant_id, service_id, location_id)
      VALUES (${tenantId}, ${first.id}, ${location.id}), (${tenantId}, ${second.id}, ${location.id})`;
    await sql`INSERT INTO service_team_members (tenant_id, service_id, team_member_id)
      VALUES (${tenantId}, ${first.id}, ${primary.id}), (${tenantId}, ${second.id}, ${secondary.id})`;
    await sql`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id)
      SELECT ${tenantId}, member, ${location.id} FROM unnest(${providers}::uuid[]) AS member`;
    await sql`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone)
      SELECT ${tenantId}, member, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', '09:00', '17:00', ${timezone}
      FROM unnest(${providers}::uuid[]) AS member`;
    const time = (clock: string) => fromZonedTime(`${day}T${clock}`, timezone);
    const [competingBlock] = await sql`INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
      VALUES (${tenantId}, ${secondary.id}, ${location.id}, ${time("10:45")}, ${time("11:15")}, 'confirmed') RETURNING id`;

    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto(`/nordic/app/calendars?${new URLSearchParams({
      view: "team", location: location.id, day, service: first.id, employee: primary.id,
      createStaff: primary.id, create: `${day}T10:00`,
    })}`);
    const drawer = page.getByRole("complementary", { name: "New appointment" });
    await drawer.getByRole("button", { name: "Add client", exact: true }).click();
    await drawer.getByLabel("Client name").fill(clientName);
    await drawer.getByLabel("Email", { exact: true }).fill(clientEmail);
    await drawer.getByRole("button", { name: "Add service", exact: true }).click();
    await drawer.getByRole("combobox", { name: "Service 2", exact: true }).fill(second.title);
    await drawer.getByRole("option", { name: new RegExp(second.title) }).click();
    await drawer.getByRole("combobox", { name: "Provider for service 2" }).fill(secondary.name);
    await drawer.getByRole("option", { name: secondary.name, exact: true }).click();
    await expect(drawer.getByText("Defaults to 10:45")).toBeVisible();
    await expect(drawer.getByText(/75 min/)).toBeVisible();
    await drawer.getByRole("button", { name: "Confirm appointment" }).click();
    await expect(drawer.getByRole("alert")).toContainText(`${second.title} is unavailable`);
    const [existing] = await sql`SELECT count(*)::int AS count FROM bookings b JOIN customers c ON c.id=b.customer_id
      WHERE b.tenant_id=${tenantId} AND c.email=${clientEmail}`;
    expect(existing.count).toBe(0);
    await sql`UPDATE booking_blocks SET state='released' WHERE tenant_id=${tenantId} AND id=${competingBlock.id}`;
    await drawer.getByRole("button", { name: "Confirm appointment" }).click();
    await expect(drawer.getByRole("status").filter({ hasText: "Appointment confirmed" })).toBeVisible();
    const [booking] = await sql`SELECT b.id, b.starts_at, block.starts_at AS added_start, block.team_member_id AS added_provider
      FROM bookings b JOIN customers c ON c.id=b.customer_id
      JOIN booking_service_segments segment ON segment.tenant_id=b.tenant_id AND segment.booking_id=b.id
      JOIN booking_blocks block ON block.tenant_id=segment.tenant_id AND block.id=segment.booking_block_id
      WHERE b.tenant_id=${tenantId} AND c.email=${clientEmail}`;
    expect(booking).toMatchObject({ starts_at: time("10:00"), added_start: time("10:45"), added_provider: secondary.id });
    await drawer.getByRole("link", { name: "View appointment" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("booking") === booking.id && !url.searchParams.has("create"));
    const saved = page.getByRole("complementary", { name: `Appointment with ${clientName}` });
    await expect(saved.getByText(second.title, { exact: true })).toBeVisible();
    await saved.getByRole("button", { name: "Close appointment", exact: true }).click();
    const segments = page.getByRole("link").filter({ hasText: clientName });
    await expect(segments).toHaveCount(2);

    await page.goto(`/nordic/app/sales?booking=${booking.id}`);
    const checkout = page.getByRole("complementary", { name: `Sale details for ${clientName}` });
    await expect(checkout.getByText(second.title, { exact: false })).toBeVisible();
    await checkout.getByRole("link", { name: "Go to payments" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "payment");
    await expect(checkout.getByLabel("Amount (DKK)")).toHaveValue("100.00");
    const method = checkout.getByRole("combobox", { name: "Method", exact: true });
    await method.selectOption("cash");
    await expect(method).toHaveValue("cash");
    await checkout.getByRole("button", { name: "Record payment" }).click();
    await expect(checkout.getByText("Paid SALE", { exact: true })).toBeVisible();
    const [settled] = await sql`SELECT
      (SELECT count(*)::int FROM commerce_sales WHERE tenant_id=${tenantId} AND booking_id=${booking.id}) AS sales,
      (SELECT sum(amount_cents)::int FROM payment_records WHERE tenant_id=${tenantId} AND booking_id=${booking.id} AND kind='payment') AS paid`;
    expect(settled).toEqual({ sales: 1, paid: 10000 });
  } finally {
    await sql.end();
  }
});
