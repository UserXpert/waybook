import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("an owner can select a profile photo and oversized files are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/team");
  const button = page.getByRole("button", { name: "Change photo for Sofie Andersen" });
  await expect(button).toBeVisible();
  let chooserPromise = page.waitForEvent("filechooser");
  await button.click();
  let chooser = await chooserPromise;
  await chooser.setFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(250_001) });
  await expect(page.locator(".staff-photo-upload__error")).toContainText("smaller than 250 KB");
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#6c56ad" } }).png().toBuffer();
  chooserPromise = page.waitForEvent("filechooser");
  await button.click();
  chooser = await chooserPromise;
  await chooser.setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: image });
  await expect(button.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Change photo for Sofie Andersen" }).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
});

test("Apps menu groups, search, keyboard and navigation work", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  await apps.click();
  const dialog = page.getByRole("dialog", { name: "Apps & settings" });
  await expect(dialog).toBeVisible();
  for (const group of ["Operations", "Commerce", "Setup", "Insights"]) await expect(dialog.getByRole("heading", { name: group, exact: true })).toBeVisible();
  const columns = await dialog.locator(".tenant-app-menu__groups").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(testInfo.project.name === "mobile" ? 1 : 4);
  const search = dialog.getByRole("textbox", { name: "Search apps and settings" });
  await search.fill("staff");
  await expect(dialog.getByRole("link", { name: "Staff", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Sales", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(apps).toBeFocused();
  await apps.click();
  await dialog.getByRole("link", { name: "Staff", exact: true }).click();
  await expect(page).toHaveURL(/\/nordic\/app\/team/);
});

test("staff can change their own photo and read-only members cannot", async ({ page, browser }) => {
  const { default: postgres } = await import("postgres");
  const { randomUUID } = await import("node:crypto");
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  const tenantUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  for (const raw of [controlUrl, tenantUrl]) {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) throw new Error("Staff photo tests require disposable local databases.");
  }
  const control = postgres(controlUrl, { max: 1, ssl: false });
  const tenant = postgres(tenantUrl, { max: 1, ssl: false });
  const suffix = randomUUID();
  const staffEmail = `staff-${suffix}@example.test`;
  const readOnlyEmail = `readonly-${suffix}@example.test`;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [staff] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${staffEmail},${owner.password_hash},'Test staff') RETURNING id`;
    const [readOnly] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${readOnlyEmail},${owner.password_hash},'Test read only') RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${staff.id},'staff'),(${workspace.id},${readOnly.id},'read-only')`;
    const [staffMember] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${staff.id},'staff','Test staff',${staffEmail}) RETURNING id`;
    await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${readOnly.id},'read-only','Test read only',${readOnlyEmail})`;
    await page.goto('/login');
    await page.getByLabel('Work email').fill(staffEmail);
    await page.getByPlaceholder('Enter your password').fill('waybook-local-only');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/nordic\/app\/calendars/);
    await page.goto('/nordic/app/team');
    const button = page.getByRole('button', { name: 'Change photo for Test staff' });
    await expect(button).toBeVisible();
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#6c56ad' } }).png().toBuffer();
    const chooserPromise = page.waitForEvent('filechooser');
    await button.click();
    await (await chooserPromise).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
    await expect(button.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const [beforeDowngradedUpload] = await tenant<{ photoDataUrl: string | null; auditCount: number }[]>`SELECT tm.photo_data_url AS "photoDataUrl",(SELECT count(*)::int FROM tenant_audit_events WHERE tenant_id=${workspace.id} AND action='staff.photo_updated' AND target_type='team_member' AND target_id=${staffMember.id}) AS "auditCount" FROM team_members tm WHERE tm.tenant_id=${workspace.id} AND tm.id=${staffMember.id}`;
    await control`UPDATE tenant_memberships SET role='read-only' WHERE tenant_id=${workspace.id} AND identity_id=${staff.id}`;
    const deniedChooser = page.waitForEvent('filechooser');
    await button.click();
    await (await deniedChooser).setFiles({ name: 'forged-after-downgrade.png', mimeType: 'image/png', buffer: image });
    await expect(page.locator('.staff-photo-upload__error')).toContainText('Could not upload photo');
    const [afterDowngradedUpload] = await tenant<{ photoDataUrl: string | null; auditCount: number }[]>`SELECT tm.photo_data_url AS "photoDataUrl",(SELECT count(*)::int FROM tenant_audit_events WHERE tenant_id=${workspace.id} AND action='staff.photo_updated' AND target_type='team_member' AND target_id=${staffMember.id}) AS "auditCount" FROM team_members tm WHERE tm.tenant_id=${workspace.id} AND tm.id=${staffMember.id}`;
    expect(afterDowngradedUpload).toEqual(beforeDowngradedUpload);
    await expect(page.getByRole('link', { name: /Sofie Andersen/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const readContext = await browser.newContext({ baseURL: "http://localhost:3336" });
    const readPage = await readContext.newPage();
    await readPage.goto('/login');
    await readPage.getByLabel('Work email').fill(readOnlyEmail);
    await readPage.getByPlaceholder('Enter your password').fill('waybook-local-only');
    await readPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(readPage).toHaveURL(/\/nordic\/app\/calendars/);
    await readPage.goto('/nordic/app/team');
    await expect(readPage.getByRole('heading', { name: 'Test read only' })).toBeVisible();
    await expect(readPage.getByRole('button', { name: /Change photo/ })).toHaveCount(0);
    await readPage.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(readPage.getByRole('dialog').getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await readContext.close();
  } finally { await control.end(); await tenant.end(); }
});

test("staff can complete past bookings and upcoming attendance is read-only", async ({ page }) => {
  const { default: postgres } = await import("postgres");
  const { randomUUID } = await import("node:crypto");
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  const tenantUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  for (const raw of [controlUrl, tenantUrl]) {
    const url = new URL(raw);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/waybook_e2e_')) throw new Error('Status-only calendar tests require disposable local databases.');
  }
  const control = postgres(controlUrl, { max: 1, ssl: false });
  const tenant = postgres(tenantUrl, { max: 1, ssl: false });
  const suffix = randomUUID();
  const staffEmail = `status-only-${suffix}@example.test`;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug='nordic-studio'`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email='owner@nordic.local'`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${staffEmail},${owner.password_hash},'Status-only staff') RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identity.id},'staff')`;
    const [staff] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${identity.id},'staff','Status-only staff',${staffEmail}) RETURNING id`;
    await tenant`INSERT INTO staff_permissions (tenant_id,team_member_id,can_update_appointment_status) VALUES (${workspace.id},${staff.id},TRUE)`;
    const [settings] = await tenant<{ timezone: string }[]>`SELECT timezone FROM tenant_settings WHERE tenant_id=${workspace.id}`;
    const [location] = await tenant<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${workspace.id} AND is_active=TRUE ORDER BY slug LIMIT 1`;
    const [service] = await tenant<{ id: string; durationMinutes: number }[]>`SELECT s.id,s.duration_minutes AS "durationMinutes" FROM services s JOIN service_locations sl ON sl.tenant_id=s.tenant_id AND sl.service_id=s.id AND sl.location_id=${location.id} WHERE s.tenant_id=${workspace.id} AND s.is_active=TRUE LIMIT 1`;
    await tenant`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${workspace.id},${staff.id},${location.id}) ON CONFLICT DO NOTHING`;
    await tenant`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${workspace.id},${service.id},${staff.id}) ON CONFLICT DO NOTHING`;
    const [customer] = await tenant`INSERT INTO customers (tenant_id,name,email) VALUES (${workspace.id},'Status-only customer',${`status-customer-${suffix}@example.test`}) RETURNING id`;
    async function createBooking(dayOffset: number) {
      const [slot] = await tenant<{ startsAt: Date; endsAt: Date; day: string }[]>`
        SELECT local_day::text AS day, start_time AS "startsAt",
          start_time + ${service.durationMinutes} * interval '1 minute' AS "endsAt"
        FROM (SELECT local_day, (local_day + '11:00'::time) AT TIME ZONE ${settings.timezone} AS start_time
              FROM (SELECT (now() AT TIME ZONE ${settings.timezone})::date + ${dayOffset}::int AS local_day) date_value) slot
      `;
      const [block] = await tenant`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${workspace.id},${staff.id},${location.id},${slot.startsAt},${slot.endsAt},'confirmed') RETURNING id`;
      const [booking] = await tenant<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,idempotency_key,booked_price_cents) VALUES (${workspace.id},${block.id},${service.id},${staff.id},${location.id},${customer.id},${slot.startsAt},${slot.endsAt},'confirmed','tenant',${`status-only-${suffix}-${dayOffset}`},0) RETURNING id`;
      return { id: booking.id, day: slot.day };
    }
    const past = await createBooking(-1);
    const future = await createBooking(1);
    const attendanceLabels = ['Arrived', 'Completed', 'No show'];

    async function signIn(email: string) {
      await page.goto('/login');
      await page.getByLabel('Work email').fill(email);
      await page.getByPlaceholder('Enter your password').fill('waybook-local-only');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/nordic\/app/);
    }
    await signIn(staffEmail);

    await page.goto(`/nordic/app/calendars?day=${future.day}`);
    await page.getByRole('link', { name: /Status-only customer/ }).click();
    await expect(page.getByText('Attendance can be updated once the appointment starts.')).toBeVisible();
    for (const label of attendanceLabels) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);

    await page.goto(`/nordic/app/calendars?day=${past.day}`);
    await page.getByRole('link', { name: /Status-only customer/ }).click();
    await expect(page.getByText('Current: no show')).toBeVisible();
    for (const heading of ['Edit', 'Reschedule', 'Sales ledger']) await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /cancel appointment/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Arrived', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect.poll(async () => (await tenant<{ status: string }[]>`SELECT status FROM bookings WHERE id=${past.id}`)[0]?.status).toBe('completed');
    await expect(page.getByText('This appointment’s status is final and cannot be changed.')).toBeVisible();
    const [audit] = await tenant`SELECT metadata FROM tenant_audit_events WHERE tenant_id=${workspace.id} AND target_id=${past.id} AND action='booking.completed'`;
    expect(audit?.metadata).toMatchObject({ previousStatus: 'no_show' });

    await page.context().clearCookies();
    await signIn('owner@nordic.local');
    await page.goto(`/nordic/app/bookings?booking=${future.id}`);
    await expect(page.getByText('Attendance can be updated once the appointment starts.')).toBeVisible();
    for (const label of attendanceLabels) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /cancel appointment/i })).toBeVisible();
    await page.goto(`/nordic/app/bookings?booking=${past.id}`);
    await expect(page.getByText('This appointment’s status is final and cannot be changed.')).toBeVisible();
  } finally { await control.end(); await tenant.end(); }
});
