import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

const workspaces = [
  { route: "nordic", owner: "owner@nordic.local", database: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL" },
  { route: "copenhagen", owner: "owner@copenhagen-physio.local", database: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL" },
];

for (const workspace of workspaces) {
  test(`calendar appointment grants keep staff actions in scope in ${workspace.route}`, async ({ page }) => {
    test.setTimeout(90_000);
    const controlUrl = new URL(process.env.WAYBOOK_CONTROL_DATABASE_URL!);
    const tenantUrl = new URL(process.env[workspace.database]!);
    for (const url of [controlUrl, tenantUrl]) {
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
        throw new Error("Calendar staff access QA requires disposable local databases.");
      }
    }
    const control = postgres(controlUrl.href, { max: 1, ssl: false });
    const db = postgres(tenantUrl.href, { max: 1, ssl: false });
    const tag = randomUUID().slice(0, 8);
    const staffEmail = `calendar-access-${tag}@example.test`;
    const ownCustomer = `QA own appointment ${tag}`;
    const teamCustomer = `QA team appointment ${tag}`;

    try {
      const [{ tenantId, timezone, day }] = await db<{ tenantId: string; timezone: string; day: string }[]>`
        SELECT tenant_id AS "tenantId", timezone, ((now() AT TIME ZONE timezone)::date + 2)::text AS day
        FROM tenant_settings
      `;
      const [identity] = await control<{ id: string }[]>`
        INSERT INTO identities (email,password_hash,display_name)
        SELECT ${staffEmail}, password_hash, 'QA calendar staff' FROM identities WHERE email=${workspace.owner}
        RETURNING id
      `;
      await control`INSERT INTO tenant_memberships (tenant_id,identity_id,role) VALUES (${tenantId},${identity.id},'staff')`;
      const [own, colleague] = await db<{ id: string; name: string }[]>`
        INSERT INTO team_members (tenant_id,identity_id,name,email,role)
        VALUES (${tenantId},${identity.id},${`Z QA calendar staff ${tag}`},${staffEmail},'staff'),
               (${tenantId},NULL,${`A QA calendar colleague ${tag}`},${`calendar-colleague-${tag}@example.test`},'staff')
        RETURNING id,name
      `;
      const [location] = await db<{ id: string }[]>`
        INSERT INTO locations (tenant_id,slug,name,timezone) VALUES (${tenantId},${`qa-calendar-${tag}`},${`Z QA calendar branch ${tag}`},${timezone}) RETURNING id
      `;
      const [service] = await db<{ id: string }[]>`
        INSERT INTO services (tenant_id,slug,title,duration_minutes)
        VALUES (${tenantId},${`qa-calendar-${tag}`},${`Z QA calendar session ${tag}`},30) RETURNING id
      `;

      try {
        await db`INSERT INTO location_hours (tenant_id,location_id,day_of_week,start_time,end_time)
          SELECT ${tenantId},${location.id},day,'09:00','15:00' FROM generate_series(0,6) day`;
        await db`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${tenantId},${service.id},${location.id})`;
        for (const member of [own, colleague]) {
          await db`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${tenantId},${member.id},${location.id})`;
          await db`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${tenantId},${service.id},${member.id})`;
          await db`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone)
            VALUES (${tenantId},${member.id},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','15:00',${timezone})`;
        }
        await db`INSERT INTO staff_permissions (tenant_id,team_member_id,can_manage_own_appointments)
          VALUES (${tenantId},${own.id},TRUE)`;

        const path = `/${workspace.route}/app/calendars`;
        const board = `${path}?day=${day}&location=${location.id}&service=${service.id}`;
        const teamBoard = `${board}&view=team`;
        const createPanel = page.getByRole("complementary", { name: "New appointment" });
        const bookingCard = (id: string) => page.locator(`a.waybook-week-calendar__entry[href*="booking=${id}"]`);
        const panelFor = (name: string) => page.getByRole("complementary", { name: `Appointment with ${name}` });
        const slot = (memberId: string, time: string) => page.locator(`a.is-bookable[data-calendar-team-member-id="${memberId}"][data-calendar-starts-at="${day}T${time}"]`);
        const startsAt = (time: string) => fromZonedTime(`${day}T${time}`, timezone).toISOString();
        const getBooking = async (name: string) => {
          const [booking] = await db<{ id: string; memberId: string; status: string; blockState: string; startsAt: Date }[]>`
            SELECT b.id,b.status,b.team_member_id AS "memberId",b.starts_at AS "startsAt", bb.state AS "blockState"
            FROM bookings b JOIN customers c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id
            JOIN booking_blocks bb ON bb.tenant_id=b.tenant_id AND bb.id=b.booking_block_id
            WHERE b.tenant_id=${tenantId} AND b.service_id=${service.id} AND c.name=${name}
          `;
          expect(booking).toBeDefined();
          return { ...booking, startsAt: booking.startsAt.toISOString() };
        };
        const setGrants = async ({ viewTeam, manageOwn, manageTeam }: { viewTeam: boolean; manageOwn: boolean; manageTeam: boolean }) => {
          await db`UPDATE staff_permissions SET can_view_team_calendar=${viewTeam},
            can_manage_own_appointments=${manageOwn},can_manage_team_appointments=${manageTeam}
            WHERE tenant_id=${tenantId} AND team_member_id=${own.id}`;
        };
        const create = async (name: string, email: string, time: string) => {
          await createPanel.getByLabel(/^(client|patient) name$/i).fill(name);
          await createPanel.getByLabel("Email", { exact: true }).fill(email);
          await createPanel.getByLabel("Phone", { exact: true }).fill("+4511223344");
          await expect(createPanel.getByRole("region", { name: "Selected calendar slot" })).toContainText(time);
          await createPanel.getByRole("button", { name: "Confirm appointment" }).click();
          await expect(createPanel.getByText("Appointment confirmed and added to the calendar.")).toBeVisible();
        };

        await page.goto("/login");
        await page.getByLabel("Work email").fill(staffEmail);
        await page.getByPlaceholder("Enter your password").fill("waybook-local-only");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === path);

        await page.goto(board);
        await expect(slot(colleague.id, "10:00")).toHaveCount(0);
        await slot(own.id, "10:00").click();
        await expect(createPanel.getByRole("region", { name: "Selected calendar slot" })).toContainText(own.name);
        await createPanel.getByRole("button", { name: "Change slot" }).click();
        const fixedStaff = createPanel.getByRole("textbox").filter({ visible: true });
        await expect(createPanel.locator("input[readonly]")).toHaveValue(own.name);
        await expect(fixedStaff.and(createPanel.locator("input[readonly]"))).toBeVisible();
        await createPanel.getByRole("button", { name: "Hide slot options" }).click();
        await create(ownCustomer, `calendar-own-${tag}@example.test`, "10:00");
        const ownBooking = await getBooking(ownCustomer);
        expect(ownBooking).toMatchObject({ memberId: own.id, startsAt: startsAt("10:00"), status: "confirmed" });

        // The own-schedule grant exposes the same controls on direct and client-opened drawers.
        await page.goto(`${board}&booking=${ownBooking.id}`);
        const ownPanel = panelFor(ownCustomer);
        await expect(ownPanel.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
        await ownPanel.getByRole("button", { name: "More appointment actions" }).click();
        await expect(ownPanel.getByRole("button", { name: "Reschedule", exact: true })).toBeVisible();
        await expect(ownPanel.getByRole("button", { name: "Cancel appointment", exact: true })).toBeVisible();
        for (const name of ["Edit", "Sales ledger"]) await expect(ownPanel.getByRole("heading", { name })).toHaveCount(0);
        await expect(ownPanel.getByRole("button", { name: "Completed", exact: true })).toHaveCount(0);
        await page.goto(board);
        await expect(bookingCard(ownBooking.id)).toHaveAttribute("draggable", "true");
        await bookingCard(ownBooking.id).click();
        await ownPanel.getByRole("button", { name: "Edit appointment" }).click();
        await ownPanel.getByRole("button", { name: "Reschedule", exact: true }).click();
        await ownPanel.locator(".appointment-reschedule-picker__day").filter({ hasText: day.slice(-2) }).click();
        await ownPanel.getByRole("button", { name: "11:30", exact: true }).click();
        await ownPanel.getByRole("button", { name: "Reschedule appointment" }).click();
        const confirmation = page.getByRole("dialog", { name: `Appointment with ${ownCustomer}` })
          .getByRole("status").filter({ hasText: "Appointment rescheduled" });
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole("button", { name: "Dismiss notification" }).click();
        await expect(confirmation).toHaveCount(0);
        await expect.poll(() => getBooking(ownCustomer)).toMatchObject({ memberId: own.id, startsAt: startsAt("11:30"), blockState: "confirmed" });
        await expect(bookingCard(ownBooking.id).locator(".waybook-calendar-entry__time")).toContainText("11:30");

        await setGrants({ viewTeam: true, manageOwn: false, manageTeam: true });
        await page.goto(teamBoard);
        await expect(slot(own.id, "10:00")).toBeVisible();
        await slot(colleague.id, "10:00").click();
        await createPanel.getByRole("button", { name: "Change slot" }).click();
        await expect(createPanel.locator("input[readonly]")).toHaveCount(0);
        await createPanel.getByRole("button", { name: "Hide slot options" }).click();
        await create(teamCustomer, `calendar-team-${tag}@example.test`, "10:00");
        const teamBooking = await getBooking(teamCustomer);
        expect(teamBooking).toMatchObject({ memberId: colleague.id, startsAt: startsAt("10:00"), status: "confirmed" });

        await setGrants({ viewTeam: true, manageOwn: false, manageTeam: false });
        await page.goto(teamBoard);
        await expect(page.getByRole("link", { name: /^New appointment/ })).toHaveCount(0);
        await expect(bookingCard(teamBooking.id)).toHaveAttribute("draggable", "false");
        await bookingCard(teamBooking.id).click();
        const teamPanel = panelFor(teamCustomer);
        await expect(teamPanel.getByText("You have view-only access to this appointment.")).toBeVisible();
        await expect(teamPanel.getByRole("heading", { name: "Reschedule" })).toHaveCount(0);
        await expect(teamPanel.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);

        await setGrants({ viewTeam: true, manageOwn: true, manageTeam: false });
        await page.goto(teamBoard);
        await expect(slot(own.id, "10:00")).toBeVisible();
        await expect(slot(colleague.id, "11:30")).toHaveCount(0);
        await expect(bookingCard(teamBooking.id)).toHaveAttribute("draggable", "false");
        await expect(page.locator(`[data-calendar-drop-cell][data-calendar-team-member-id="${colleague.id}"]`)).toHaveCount(0);
        await page.getByRole("link", { name: "New appointment", exact: true }).click();
        await expect(createPanel.getByRole("region", { name: "Selected calendar slot" })).toContainText(own.name);
        await expect(createPanel.getByRole("region", { name: "Appointment schedule" })).toHaveCount(0);
        await createPanel.getByRole("button", { name: /^(Change|Choose) slot$/ }).click();
        await expect(createPanel.locator("input[readonly]")).toHaveValue(own.name);
        await page.goto(`${teamBoard}&booking=${teamBooking.id}`);
        await expect(teamPanel.getByText("You have view-only access to this appointment.")).toBeVisible();
        await expect(teamPanel.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
        await page.goto(`${teamBoard}&booking=${ownBooking.id}`);
        await ownPanel.getByRole("button", { name: "More appointment actions" }).click();
        await ownPanel.getByRole("button", { name: "Cancel appointment", exact: true }).click();
        await page.getByRole("alertdialog", { name: "Cancel this appointment?" }).getByRole("button", { name: "Cancel appointment" }).click();
        await expect(ownPanel.getByText("This appointment has been cancelled.", { exact: false })).toBeVisible();
        await expect.poll(() => getBooking(ownCustomer)).toMatchObject({ status: "cancelled", blockState: "cancelled" });

        await setGrants({ viewTeam: true, manageOwn: false, manageTeam: true });
        await page.goto(teamBoard);
        await expect(bookingCard(teamBooking.id)).toHaveAttribute("draggable", "true");
        await bookingCard(teamBooking.id).click();
        await teamPanel.getByRole("button", { name: "More appointment actions" }).click();
        await teamPanel.getByRole("button", { name: "Cancel appointment", exact: true }).click();
        await expect(teamPanel.getByRole("heading", { name: "Sales ledger" })).toHaveCount(0);
        await page.getByRole("alertdialog", { name: "Cancel this appointment?" }).getByRole("button", { name: "Cancel appointment" }).click();
        await expect(teamPanel.getByText("This appointment has been cancelled.", { exact: false })).toBeVisible();
        await expect.poll(() => getBooking(teamCustomer)).toMatchObject({ status: "cancelled", blockState: "cancelled" });
      } finally {
        await db`UPDATE team_members SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=ANY(${[own.id, colleague.id]}::uuid[])`;
        await db`UPDATE services SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${service.id}`;
        await db`UPDATE locations SET is_active=FALSE WHERE tenant_id=${tenantId} AND id=${location.id}`;
      }
    } finally {
      await Promise.all([control.end(), db.end()]);
    }
  });
}
