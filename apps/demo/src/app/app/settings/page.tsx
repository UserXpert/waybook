import Link from "next/link";
import { ArrowUpRight, CalendarDays, Mail, MapPin, Package, UsersRound, Wrench } from "lucide-react";
import { TenantAppearanceControls } from "@/components/tenant-appearance-controls";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { TenantTerminologyForm } from "@/components/tenant-terminology-form";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { getTenantTerminologySettings } from "@/lib/waybook/tenant-terminology";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { terminologyLabels, titleTerminology } from "@/lib/waybook/terminology-labels";

export default async function SettingsPage() {
  const { tenant, membership } = await requireTenantWorkspace();
  const [slug, permissions, teamEnabled, resourcesEnabled, emailsEnabled, terminology] = await Promise.all([
    currentTenantRouteSlug(tenant.slug), staffPermissionContext(tenant, membership),
    isFeatureEnabled(tenant.id, "team"), isFeatureEnabled(tenant.id, "resources"),
    isFeatureEnabled(tenant.id, "email-notifications"),
    getTenantTerminologySettings(tenant),
  ]);
  const labels = terminologyLabels(terminology.preferences.clientTerm, terminology.preferences.staffTerm);
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
  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={slug} tenantName={tenant.name} active="settings" />
    <div className="workspace-settings">
      <header className="workspace-settings__heading"><p>WORKSPACE</p><h1>Settings</h1><span>Manage your preferences and business setup.</span></header>
      <div className="workspace-settings__layout">
        <nav className="workspace-settings__nav" aria-label="Settings sections"><a href="#appearance">Appearance</a>{links.length ? <a href="#business-settings">Business setup</a> : null}</nav>
        <div className="workspace-settings__content">
          <section className="workspace-settings__panel" id="appearance"><h2>Appearance</h2><p>Choose how Waybook looks on this browser.</p><TenantAppearanceControls /></section>
          {links.length ? <section className="workspace-settings__panel" id="business-settings"><h2>Business setup</h2><p>Find the settings for your booking experience and operations.</p><div className="workspace-settings__links">{links.map(({ title, description, href, Icon }) => <Link key={title} href={tenantPath(slug, href)}><i><Icon aria-hidden="true" /></i><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</div></section> : null}
          {membership.role === "owner" ? <section className="workspace-settings__panel" id="terminology">
            <h2>Terminology</h2>
            <p>Choose the terms used in your workspace and online booking.</p>
            {terminology.available ? <TenantTerminologyForm preferences={terminology.preferences} /> : <p>Update the workspace database to change terminology.</p>}
          </section> : null}
        </div>
      </div>
    </div>
  </main>;
}
