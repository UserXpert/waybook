import Link from "next/link";
import { BarChart3, CalendarDays, LayoutDashboard, UsersRound } from "lucide-react";
import { logout } from "@/app/actions";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireIdentity } from "@/lib/waybook/auth";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { TenantAppMenu, type TenantAppLink } from "@/components/tenant-app-menu";
import { TenantUserMenu } from "@/components/tenant-user-menu";

type TenantDashboardNavProps = {
  tenantId: string;
  tenantSlug?: string;
  tenantName: string;
  active: "overview" | "bookings" | "reports" | "services" | "clients" | "team" | "calendars" | "locations" | "waitlist" | "resources" | "notifications";
};

const primaryLinks = [
  { id: "overview", href: "/app", label: "Overview", Icon: LayoutDashboard },
  { id: "calendars", href: "/app/calendars", label: "Calendar", Icon: CalendarDays },
  { id: "clients", href: "/app/customers", label: "Clients", Icon: UsersRound },
  { id: "reports", href: "/app/reports", label: "Reports", Icon: BarChart3 },
] as const;

export async function TenantDashboardNav({ tenantId, tenantSlug, tenantName, active }: TenantDashboardNavProps) {
  const resolvedTenantSlug = tenantSlug ?? await currentTenantRouteSlug("");
  const { tenant, membership } = await requireTenantWorkspace();
  const [identity, clientsEnabled, teamEnabled, calendarsEnabled, resourcesEnabled, notificationsEnabled] = await Promise.all([
    requireIdentity(),
    isFeatureEnabled(tenantId, "clients"),
    isFeatureEnabled(tenantId, "team"),
    isFeatureEnabled(tenantId, "calendars"),
    isFeatureEnabled(tenantId, "resources"),
    isFeatureEnabled(tenantId, "email-notifications"),
  ]);
  const permissions = await staffPermissionContext(tenant, membership);
  const canUse = {
    overview: permissions.isManager,
    clients: clientsEnabled && (permissions.isManager || permissions.canViewClients || permissions.canManageClients),
    calendars: calendarsEnabled && (permissions.isManager || Boolean(permissions.teamMemberId)),
    bookings: calendarsEnabled && (permissions.isManager || permissions.canManageOwnAppointments),
    team: teamEnabled && (permissions.isManager || Boolean(permissions.teamMemberId)),
    reports: permissions.isManager || permissions.canAccessReports,
    waitlist: calendarsEnabled && (permissions.isManager || permissions.canManageWaitlist),
    resources: resourcesEnabled && (permissions.isManager || permissions.canManageResources),
    serviceSettings: permissions.isManager || permissions.canManageServiceSettings,
    notifications: notificationsEnabled && permissions.isManager,
    targets: permissions.isManager,
  };
  const toHref = (href: string) => resolvedTenantSlug ? tenantPath(resolvedTenantSlug, href) : href;
  const primary = primaryLinks.filter((link) => canUse[link.id as keyof typeof canUse]).map((link) => ({ ...link, href: toHref(link.href) }));
  const appLinks: TenantAppLink[] = [
    canUse.bookings ? { id: "bookings", href: toHref("/app/bookings"), label: "Bookings", description: "All appointments", group: "Operations" } : null,
    canUse.calendars ? { id: "calendars", href: toHref("/app/calendars"), label: "Calendar", description: "Schedule and availability", group: "Operations" } : null,
    canUse.waitlist ? { id: "waitlist", href: toHref("/app/waitlist"), label: "Waitlist", description: "Fill open times", group: "Operations" } : null,
    canUse.clients ? { id: "clients", href: toHref("/app/customers"), label: "Clients", description: "Client history", group: "Manage" } : null,
    canUse.team ? { id: "team", href: toHref("/app/team"), label: "Staff", description: "Hours and eligibility", group: "Manage" } : null,
    canUse.serviceSettings ? { id: "services", href: toHref("/app/services"), label: "Services", description: "Prices and duration", group: "Manage" } : null,
    canUse.serviceSettings ? { id: "locations", href: toHref("/app/locations"), label: "Locations", description: "Where you operate", group: "Manage" } : null,
    canUse.resources ? { id: "resources", href: toHref("/app/resources"), label: "Resources", description: "Rooms and equipment", group: "Manage" } : null,
    canUse.notifications ? { id: "notifications", href: toHref("/app/notifications"), label: "Notifications", description: "Message delivery", group: "Tools" } : null,
    canUse.reports ? { id: "reports", href: toHref("/app/reports"), label: "Reports", description: "Business performance", group: "Tools" } : null,
  ].filter(Boolean) as TenantAppLink[];

  return <header className="tenant-dashboard-nav" aria-label="Tenant dashboard navigation">
    <div className="tenant-dashboard-nav__workspace"><span>WAYBOOK</span><strong>{tenantName}</strong></div>
    <nav aria-label="Primary navigation">{primary.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}><link.Icon aria-hidden="true" />{link.label}</Link>)}</nav>
    <TenantAppMenu links={appLinks} active={active} />
    <TenantUserMenu displayName={identity.displayName} email={identity.email} tenantName={tenantName} role={identity.isPlatformAdmin ? "Platform administrator" : "Workspace member"} staffHref={canUse.team ? toHref("/app/team") : undefined} targetsHref={canUse.targets ? toHref("/app/targets") : undefined} onSignOut={logout} />
  </header>;
}
