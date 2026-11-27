import Link from "next/link";
import { ArrowUpRight, CalendarDays, Mail, MapPin, Package, UsersRound, Wrench } from "lucide-react";
import { notFound } from "next/navigation";
import { TenantAppearanceControls } from "@/components/tenant-appearance-controls";
import { TenantBusinessProfileForm } from "@/components/tenant-business-profile-form";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { TenantTerminologyForm } from "@/components/tenant-terminology-form";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { parseBookingPage, publicBookingImageUrl } from "@/lib/waybook/booking-page-media";
import { parseBusinessProfile } from "@/lib/waybook/business-profile";
import { tenantDb } from "@/lib/waybook/database";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { getTenantTerminologySettings } from "@/lib/waybook/tenant-terminology";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { terminologyLabels, titleTerminology } from "@/lib/waybook/terminology-labels";
import { calendarDisplayIntervals, getCalendarDisplay } from "@/lib/waybook/calendar-display-preferences";
import { calendarHolidayRegions } from "@/lib/waybook/calendar-holidays";
import { calendarTimezones } from "@/lib/waybook/calendar-timezones";
import { saveCalendarDisplay } from "./calendar-actions";
import { StaffRolesPanel } from "./roles/panel";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; role?: string; new?: string; calendarStatus?: string }> }) {
  const { tenant, membership } = await requireTenantWorkspace();
  const [params, slug, permissions, teamEnabled, resourcesEnabled, emailsEnabled, terminology] = await Promise.all([
    searchParams,
    currentTenantRouteSlug(tenant.slug), staffPermissionContext(tenant, membership),
    isFeatureEnabled(tenant.id, "team"), isFeatureEnabled(tenant.id, "resources"),
    isFeatureEnabled(tenant.id, "email-notifications"),
    getTenantTerminologySettings(tenant),
  ]);
  const labels = terminologyLabels(terminology.preferences.clientTerm, terminology.preferences.staffTerm);
  const canManageRoles = teamEnabled && membership.role === "owner";
  const showingCalendar = params.tab === "calendar";
  const calendar = showingCalendar ? await getCalendarDisplay(tenant.id) : null;
  const hours = Array.from({ length: 25 }, (_, index) => index);
  const showingRoles = params.tab === "roles";
  const showingBusiness = params.tab === "business";
  if (showingRoles && !canManageRoles) notFound();
  const settingsHref = tenantPath(slug, "/app/settings");
  const rolesHref = `${settingsHref}?tab=roles`;
  const businessHref = `${settingsHref}?tab=business`;
  const bookingSettings = permissions.isManager || permissions.canManageServiceSettings;
  const links = [
    ...(bookingSettings ? [
      { title: "Online booking", description: "Booking page, embed and cancellation preferences", href: "/app/online-booking", Icon: CalendarDays },
      { title: "Services", description: "Services, prices and staff eligibility", href: "/app/services", Icon: Package },
      { title: "Locations", description: "Locations, contact details and opening hours", href: "/app/locations", Icon: MapPin },
    ] : []),
    ...(teamEnabled && (permissions.isManager || permissions.teamMemberId) ? [{ title: titleTerminology(labels.staffPlural), description: "Team profiles and availability", href: "/app/team", Icon: UsersRound }] : []),
    ...(resourcesEnabled && (permissions.isManager || permissions.canManageResources) ? [{ title: "Resources", description: "Rooms, equipment and availability", href: "/app/resources", Icon: Wrench }] : []),
    ...(emailsEnabled && permissions.isManager ? [{ title: "Email", description: "Sender connection, templates and reminders", href: "/app/emails?view=connection", Icon: Mail }] : []),
  ];
  const canEditBusiness = membership.role === "owner";
  const canViewBusiness = canEditBusiness || links.length > 0;
  if (showingBusiness && !canViewBusiness) notFound();
  const [business] = showingBusiness && canEditBusiness ? await tenantDb(tenant)<{
    name: string; profile: unknown; bookingPage: { logoUrl?: unknown } | string; available: boolean;
  }[]>`
    SELECT name, to_jsonb(ts)->'business_profile' AS profile, booking_page AS "bookingPage",
      to_jsonb(ts) ? 'business_profile' AS available
    FROM tenant_settings ts WHERE tenant_id = ${tenant.id}
  ` : [];
  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={slug} tenantName={tenant.name} active="settings" />
    <div className="workspace-settings">
      <header className="workspace-settings__heading"><p>WORKSPACE</p><h1>Settings</h1><span>Manage your preferences and business setup.</span></header>
      <div className="workspace-settings__layout">
        <nav className="workspace-settings__nav" aria-label="Settings sections">
          <Link href={settingsHref} aria-current={!showingRoles && !showingBusiness && !showingCalendar ? "page" : undefined}>Appearance</Link>
          <Link href={`${settingsHref}?tab=calendar`} aria-current={showingCalendar ? "page" : undefined}>Calendar</Link>
          {canViewBusiness ? <Link href={businessHref} aria-current={showingBusiness ? "page" : undefined}>Business setup</Link> : null}
          {canManageRoles ? <Link href={rolesHref} aria-current={showingRoles ? "page" : undefined}>Roles &amp; permissions</Link> : null}
        </nav>
        <div className="workspace-settings__content">
          {calendar ? <section className="workspace-settings__panel">
            <h2>Calendar</h2>
            <p>Choose how the calendar appears on this browser. Booked appointments stay visible outside your chosen hours.</p>
            {params.calendarStatus === "saved" ? <p role="status">Calendar preferences saved.</p> : null}
            {params.calendarStatus === "hours" ? <p role="alert">The calendar end time must be later than the start time.</p> : null}
            <form action={saveCalendarDisplay} className="tenant-drawer-form calendar-display-form">
              <div className="calendar-display-form__hours">
                <label>Show from <select name="start" defaultValue={calendar.start ?? ""}>
                  <option value="">Automatic</option>
                  {hours.slice(0, -1).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
                </select></label>
                <label>Show until <select name="end" defaultValue={calendar.end ?? ""}>
                  <option value="">Automatic</option>
                  {hours.slice(1).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
                </select></label>
              </div>
              <label>Calendar interval <select name="interval" defaultValue={calendar.interval}>
                {calendarDisplayIntervals.map((interval) => <option key={interval} value={interval}>{interval} minutes</option>)}
              </select></label>
              <label>Calendar time zone <select name="timezone" defaultValue={calendar.timezone ?? ""}>
                <option value="">Workspace time ({tenant.timezone})</option>
                {calendarTimezones.filter((timezone) => timezone !== tenant.timezone).map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}
              </select></label>
              <div className="calendar-display-form__holiday">
                <label>Public holidays <select name="holidayRegion" defaultValue={calendar.holidayRegion ?? ""} aria-describedby="calendar-holiday-help">
                  <option value="">Hidden</option>
                  {Object.entries(calendarHolidayRegions).map(([region, name]) => <option key={region} value={region}>{name}</option>)}
                </select></label>
                <small id="calendar-holiday-help">Holiday labels are for reference. Booking availability follows your work schedule.</small>
              </div>
              <label className="calendar-display-form__check"><input type="checkbox" name="showNow" defaultChecked={calendar.showNow} /> Show current time</label>
              <label className="calendar-display-form__check"><input type="checkbox" name="showWeekends" defaultChecked={calendar.showWeekends} /> Show weekends in Week and Month views</label>
              <label className="calendar-display-form__check"><input type="checkbox" name="autofillLatestService" defaultChecked={calendar.autofillLatestService} /> Autofill service from the latest completed appointment</label>
              <button type="submit" className="waybook-action">Save calendar preferences</button>
            </form>
          </section> : showingRoles ? <StaffRolesPanel tenant={tenant} rolesHref={rolesHref} roleKey={params.role} creating={params.new === "1"} /> : showingBusiness ? <>
            {canEditBusiness ? <section className="workspace-settings__panel" id="business-settings">
              <h2>Business details</h2>
              <p>Manage your branding, registration and contact details.</p>
              {business?.available ? <TenantBusinessProfileForm key={tenant.id} name={business.name}
                profile={parseBusinessProfile(business.profile)}
                logo={publicBookingImageUrl(parseBookingPage(business.bookingPage).logoUrl)} />
                : <p>Update the workspace database to edit business details.</p>}
            </section> : null}
            {membership.role === "owner" ? <section className="workspace-settings__panel" id="terminology">
              <h2>Terminology</h2>
              <p>Choose the terms used in your workspace and online booking.</p>
              {terminology.available ? <TenantTerminologyForm preferences={terminology.preferences} /> : <p>Update the workspace database to change terminology.</p>}
            </section> : null}
            {links.length ? <section className="workspace-settings__panel"><h2>Operations settings</h2>
              <div className="workspace-settings__links">{links.map(({ title, description, href, Icon }) => <Link key={title} href={tenantPath(slug, href)}><i><Icon aria-hidden="true" /></i><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</div>
            </section> : null}
          </> : <section className="workspace-settings__panel" id="appearance"><h2>Appearance</h2><p>Choose how Waybook looks on this browser.</p><TenantAppearanceControls /></section>}
        </div>
      </div>
    </div>
  </main>;
}
