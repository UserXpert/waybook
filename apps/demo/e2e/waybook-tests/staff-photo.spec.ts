import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";

test("an owner can select a profile photo and oversized files are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("owner@nordic.local");
  await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nordic\/app/);
  await page.goto("/nordic/app/team");
  const directory = page.getByRole("complementary", { name: "Staff directory" });
  await directory.getByRole("link", { name: /Sofie Andersen/ }).click();
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
  await expect(page.getByRole("button", { name: "Account menu for Sofie Andersen" }).locator("img")).toHaveAttribute("src", `data:image/png;base64,${image.toString("base64")}`);
  await page.reload();
  await expect(page.getByRole("button", { name: "Change photo for Sofie Andersen" }).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);

  const profile = page.locator(".staff-workspace__profile-header");
  const photoControls = profile.getByRole("button", { name: /^Change photo for / });

  for (const name of ["Z E2E roster 01", "Z E2E roster 02", "Sofie Andersen"]) {
    await directory.getByRole("link", { name: new RegExp(name) }).click();
    await expect(profile.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(photoControls).toHaveCount(1);
    const photo = profile.getByRole("button", { name: `Change photo for ${name}`, exact: true }).locator("img");
    if (name === "Sofie Andersen") await expect(photo).toHaveAttribute("src", /^data:image\/png;base64,/);
    else await expect(photo).toHaveCount(0);
  }
});

test("owner profile photos stay in their workspace when the owner uses one login", async ({ page }) => {
  const workspaces = [
    { route: "nordic", slug: "nordic-studio", url: process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL! },
    { route: "copenhagen", slug: "copenhagen-physio", url: process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL! },
  ];
  // The Waybook E2E config requires all three URLs to target disposable local databases.
  const control = postgres(process.env.WAYBOOK_CONTROL_DATABASE_URL!, { max: 1, ssl: false });
  const email = `shared-owner-${randomUUID()}@example.test`;
  const name = "Shared test owner";
  const profiles: { url: string; tenantId: string; staffId: string }[] = [];
  const tenants = workspaces.map(({ url }) => postgres(url, { max: 1, ssl: false }));
  try {
    const [identity] = await control<{ id: string }[]>`
      INSERT INTO identities (email, password_hash, display_name)
      SELECT ${email}, password_hash, ${name} FROM identities WHERE email = 'owner@nordic.local'
      RETURNING id
    `;
    for (const [index, { route, slug }] of workspaces.entries()) {
      const [workspace] = await control<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${slug}`;
      await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${workspace.id}, ${identity.id}, 'owner')`;
      const [staff] = await tenants[index]<{ id: string }[]>`
        INSERT INTO team_members (tenant_id, identity_id, role, name, email)
        VALUES (${workspace.id}, ${identity.id}, 'owner', ${name}, ${email}) RETURNING id
      `;
      profiles.push({ url: `/${route}/app/team?employee=${staff.id}`, tenantId: workspace.id, staffId: staff.id });
    }

    await page.goto("/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/(nordic|copenhagen)\/app/);

    const profile = page.locator(".staff-workspace__profile-header");
    const photo = profile.getByRole("button", { name: `Change photo for ${name}`, exact: true }).locator("img");
    const savedPhotos: string[] = [];
    for (const [index, { url }] of profiles.entries()) {
      await page.goto(url);
      await expect(profile.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(photo).toHaveCount(0);
      const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: index === 0 ? "#6c56ad" : "#267050" } }).png().toBuffer();
      await profile.locator('input[type="file"]').setInputFiles({ name: "owner.png", mimeType: "image/png", buffer: image });
      await expect(photo).toHaveAttribute("src", /^data:image\/png;base64,/);
      savedPhotos.push((await photo.getAttribute("src"))!);
    }
    expect(savedPhotos[0]).not.toBe(savedPhotos[1]);
    for (const [index, { url }] of profiles.entries()) {
      await page.goto(url);
      await expect(photo).toHaveAttribute("src", savedPhotos[index]);
    }
  } finally {
    try {
      for (const [index, { tenantId, staffId }] of profiles.entries()) {
        await tenants[index]`DELETE FROM team_members WHERE tenant_id = ${tenantId} AND id = ${staffId}`;
      }
      await control`DELETE FROM identities WHERE email = ${email}`;
    } finally {
      await Promise.all([control.end(), ...tenants.map((db) => db.end())]);
    }
  }
});

test("account menu photos stay with the owner across browser sessions", async ({ page, browser }, testInfo) => {
  const accounts = [
    { email: "owner@nordic.local", name: "Sofie Andersen", home: /\/nordic\/app/, color: "#b24c69" },
    { email: "owner@copenhagen-physio.local", name: "Mikkel Holm", home: /\/copenhagen\/app/, color: "#267050" },
  ];
  const signIn = async (target: typeof page, account: (typeof accounts)[number]) => {
    await target.goto("/login");
    await target.getByLabel("Work email").fill(account.email);
    await target.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await target.getByRole("button", { name: "Sign in" }).click();
    await expect(target).toHaveURL(account.home);
  };

  const savedPhotos: string[] = [];
  for (const account of accounts) {
    await signIn(page, account);
    const accountButton = page.getByRole("button", { name: `Account menu for ${account.name}` });
    if (savedPhotos.length) await expect(accountButton.locator(`img[src="${savedPhotos[0]}"]`)).toHaveCount(0);
    await accountButton.click();
    const menu = page.getByRole("menu", { name: "Account menu" });
    const upload = menu.getByRole("button", { name: "Upload profile photo" });
    const image = await sharp({
      create: { width: testInfo.project.name === "mobile" ? 9 : 8, height: 8, channels: 3, background: account.color },
    }).png().toBuffer();
    const chooser = page.waitForEvent("filechooser");
    await upload.click();
    await (await chooser).setFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
    const expectedPhoto = `data:image/png;base64,${image.toString("base64")}`;
    savedPhotos.push(expectedPhoto);
    await expect(accountButton.locator("img")).toHaveAttribute("src", expectedPhoto);
    await expect(upload.locator("img")).toHaveAttribute("src", expectedPhoto);
    await menu.getByRole("menuitem", { name: "Edit profile" }).click();
    await expect(page.getByRole("button", { name: `Change photo for ${account.name}` }).locator("img")).toHaveAttribute("src", expectedPhoto);
    if (account === accounts[0]) {
      // An older browser may still have an unscoped avatar from before this change.
      await page.evaluate((photo) => localStorage.setItem("waybook.profile-photo", photo), expectedPhoto);
    }
    await accountButton.click();
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  for (const [index, account] of accounts.entries()) {
    const freshContext = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: page.viewportSize() });
    try {
      const freshPage = await freshContext.newPage();
      await signIn(freshPage, account);
      const accountButton = freshPage.getByRole("button", { name: `Account menu for ${account.name}` });
      await expect(accountButton.locator("img")).toHaveAttribute("src", savedPhotos[index]);
      await accountButton.click();
      await expect(freshPage.getByRole("button", { name: "Upload profile photo" }).locator("img")).toHaveAttribute("src", savedPhotos[index]);
    } finally {
      await freshContext.close();
    }
  }
});

test("switching staff profiles keeps exactly one avatar for the selected member", async ({ page }) => {
  const { default: postgres } = await import("postgres");
  const db = postgres(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!, { max: 1, ssl: false });
  const members = await db<{ id: string; name: string; photoDataUrl: string | null }[]>`
    SELECT id,name,photo_data_url AS "photoDataUrl" FROM team_members
    WHERE email IN ('e2e-roster-1@example.test','e2e-roster-2@example.test','e2e-roster-3@example.test') ORDER BY name
  `;
  const originalPhotos = new Map(members.map((member) => [member.id, member.photoDataUrl]));
  try {
    expect(members).toHaveLength(3);
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@nordic.local");
    await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/nordic\/app/);
    await page.goto("/nordic/app/team");
    const header = page.locator(".staff-workspace__profile-header");
    const directory = page.getByRole("complementary", { name: "Staff directory" });
    const avatar = header.getByRole("button", { name: /^Change photo for/ });
    async function expectProfile(member: (typeof members)[number]) {
      await expect(header.getByRole("heading", { name: member.name, exact: true })).toBeVisible();
      await expect(avatar).toHaveCount(1);
      await expect(avatar).toHaveAccessibleName(`Change photo for ${member.name}`);
      if (member.photoDataUrl) await expect(avatar.locator("img")).toHaveAttribute("src", member.photoDataUrl);
      else await expect(avatar.locator("img")).toHaveCount(0);
    }

    for (const [index, member] of members.entries()) {
      await directory.getByRole("link", { name: new RegExp(member.name) }).click();
      await expectProfile(member);
      if (index < 2) {
        const background = index === 0 ? "#67c7cf" : "#a78bfa";
        const image = await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer();
        const chooser = page.waitForEvent("filechooser");
        await avatar.click();
        await (await chooser).setFiles({ name: "synthetic-staff.png", mimeType: "image/png", buffer: image });
        member.photoDataUrl = `data:image/png;base64,${image.toString("base64")}`;
        await expectProfile(member);
      }
    }
    await page.goBack();
    await expectProfile(members[1]);
    await page.goForward();
    await expectProfile(members[2]);
    await page.reload();
    await expectProfile(members[2]);
  } finally {
    try {
      for (const [id, photoDataUrl] of originalPhotos) {
        await db`UPDATE team_members SET photo_data_url=${photoDataUrl} WHERE id=${id}`;
      }
    } finally {
      await db.end();
    }
  }
});

test("Apps menu groups, search, keyboard and navigation work", async ({ page }) => {
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
  const width = page.viewportSize()!.width;
  expect(columns).toBe(width <= 540 ? 1 : width <= 900 ? 2 : 4);
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
    page.once("dialog", (prompt) => prompt.accept());
    await page.getByRole("button", { name: "Remove photo for Test staff" }).click();
    await expect(page.locator(".staff-photo-upload__error")).toContainText("Could not remove the profile photo");

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
    await tenant`UPDATE team_members SET photo_data_url=${`data:image/png;base64,${image.toString("base64")}`} WHERE identity_id=${readOnly.id}`;
    const readContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const readPage = await readContext.newPage();
    await readPage.goto('/login');
    await readPage.getByLabel('Work email').fill(readOnlyEmail);
    await readPage.getByPlaceholder('Enter your password').fill('waybook-local-only');
    await readPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(readPage).toHaveURL(/\/nordic\/app\/calendars/);
    await readPage.goto('/nordic/app/team');
    await expect(readPage.getByRole('heading', { name: 'Test read only' })).toBeVisible();
    await expect(readPage.getByRole('button', { name: /Change photo/ })).toHaveCount(0);
    await expect(readPage.getByRole("button", { name: /Remove photo/ })).toHaveCount(0);
    await readPage.getByRole("button", { name: "Account menu for Test read only" }).click();
    await expect(readPage.getByRole("menuitem", { name: "Remove profile photo" })).toHaveCount(0);
    await readPage.keyboard.press("Escape");

    await readPage.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(readPage.getByRole('dialog').getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
    await readContext.close();
  } finally { await control.end(); await tenant.end(); }
});

for (const workspaceCase of [
  { route: "nordic", slug: "nordic-studio", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", slug: "copenhagen-physio", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
]) test(`staff can complete past bookings and upcoming attendance is read-only in ${workspaceCase.route}`, async ({ page }) => {
  const { default: postgres } = await import("postgres");
  const { randomUUID } = await import("node:crypto");
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL!;
  const tenantUrl = process.env[workspaceCase.database]!;
  for (const raw of [controlUrl, tenantUrl]) {
    const url = new URL(raw);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/waybook_e2e_')) throw new Error('Status-only calendar tests require disposable local databases.');
  }
  const control = postgres(controlUrl, { max: 1, ssl: false });
  const tenant = postgres(tenantUrl, { max: 1, ssl: false });
  const suffix = randomUUID();
  const staffEmail = `status-only-${suffix}@example.test`;
  try {
    const [workspace] = await control`SELECT id FROM tenants WHERE slug=${workspaceCase.slug}`;
    const [owner] = await control`SELECT password_hash FROM identities WHERE email=${workspaceCase.owner}`;
    const [identity] = await control`INSERT INTO identities (email,password_hash,display_name) VALUES (${staffEmail},${owner.password_hash},'Status-only staff') RETURNING id`;
    await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${workspace.id},${identity.id},'staff')`;
    const [staff] = await tenant`INSERT INTO team_members (tenant_id,identity_id,role,name,email) VALUES (${workspace.id},${identity.id},'staff','Status-only staff',${staffEmail}) RETURNING id`;
    await tenant`INSERT INTO staff_permissions (tenant_id,team_member_id,can_update_appointment_status) VALUES (${workspace.id},${staff.id},TRUE)`;
    const [settings] = await tenant<{ timezone: string }[]>`SELECT timezone FROM tenant_settings WHERE tenant_id=${workspace.id}`;
    const [location] = await tenant<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${workspace.id} AND is_active=TRUE AND slug='primary'`;
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
      const [booking] = await tenant<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,idempotency_key,booked_price_cents) VALUES (${workspace.id},${block.id},${service.id},${staff.id},${location.id},${customer.id},${slot.startsAt},${slot.endsAt},'confirmed','tenant',${`status-only-${suffix}-${dayOffset}`},5000) RETURNING id`;
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
      const appPath = `/${workspaceCase.route}/app`;
      await expect(page).toHaveURL((url) => url.pathname === (email === staffEmail ? `${appPath}/calendars` : appPath));
    }
    await signIn(staffEmail);
    const bookingLink = (bookingId: string) => page.getByRole('link', { name: /Status-only customer/ })
      .and(page.locator(`a[href*="booking=${bookingId}"]`));

    await page.goto(`/${workspaceCase.route}/app/calendars?day=${future.day}`);
    await bookingLink(future.id).click();
    await expect(page.getByText('Attendance can be updated once the appointment starts.')).toBeVisible();
    for (const label of attendanceLabels) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);

    await page.goto(`/${workspaceCase.route}/app/calendars?day=${past.day}`);
    await bookingLink(past.id).click();
    await expect(page.getByText('Current: no show')).toBeVisible();
    for (const heading of ['Edit', 'Reschedule', 'Sales ledger']) await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /cancel appointment/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Arrived', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save changes', exact: true });
    await expect(save).toBeEnabled();
    expect((await tenant<{ status: string }[]>`SELECT status FROM bookings WHERE id=${past.id}`)[0]?.status).toBe('no_show');
    await save.click();
    const appointment = page.getByRole('complementary', { name: 'Appointment with Status-only customer' });
    await expect(appointment.getByRole('alert')).toContainText('Ask a manager to record a payment before completing this no-show.');
    await tenant`INSERT INTO payment_records (tenant_id, booking_id, kind, method, amount_cents)
      VALUES (${workspace.id}, ${past.id}, 'payment', 'cash', 5000)`;
    await save.click();
    await expect.poll(async () => (await tenant<{ status: string }[]>`SELECT status FROM bookings WHERE id=${past.id}`)[0]?.status).toBe('completed');
    await expect(page.getByText('This appointment’s status is final and cannot be changed.')).toBeVisible();
    const [audit] = await tenant`SELECT metadata FROM tenant_audit_events WHERE tenant_id=${workspace.id} AND target_id=${past.id} AND action='booking.completed'`;
    expect(audit?.metadata).toMatchObject({ previousStatus: 'no_show' });

    await page.context().clearCookies();
    await signIn(workspaceCase.owner);
    await page.goto(`/${workspaceCase.route}/app/bookings?booking=${future.id}`);
    await expect(page.getByText('Attendance can be updated once the appointment starts.')).toBeVisible();
    for (const label of attendanceLabels) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /cancel appointment/i })).toBeVisible();
    await page.goto(`/${workspaceCase.route}/app/bookings?booking=${past.id}`);
    await expect(page.getByText('This appointment’s status is final and cannot be changed.')).toBeVisible();
  } finally { await control.end(); await tenant.end(); }
});
