import Link from "next/link";
import { BarChart3, CalendarDays, LayoutDashboard, UsersRound } from "lucide-react";
import { logout } from "@/app/actions";
import { tenantFeatures } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireIdentity } from "@/lib/waybook/auth";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantDb } from "@/lib/waybook/database";
import { TenantAppMenu, type TenantAppLink } from "@/components/tenant-app-menu";
import { TenantUserMenu } from "@/components/tenant-user-menu";
import { TenantNavTools } from "@/components/tenant-nav-tools";
import { DrawerToggleSemantics } from "@/components/drawer-toggle-semantics";
import { DrawerHeaderSubmitActions } from "@/components/drawer-header-submit-actions";

type TenantDashboardNavProps = {
  tenantId: string;
  tenantSlug?: string;
  tenantName: string;
  active: "overview" | "bookings" | "sales" | "products" | "giftCards" | "packages" | "search" | "reports" | "services" | "clients" | "team" | "calendars" | "locations" | "waitlist" | "resources" | "notifications" | "emails" | "onlineBooking" | "settings";
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
  const permissionAndReview = staffPermissionContext(tenant, membership).then(async (permissions) => {
    const [review] = permissions.isManager ? await tenantDb(tenant)<{ pending: boolean }[]>`SELECT EXISTS (SELECT 1 FROM bookings WHERE tenant_id=${tenant.id} AND status='arrived' AND ends_at <= now()) AS pending` : [];
    return { permissions, review };
  });
  const [identity, features, { permissions, review }] = await Promise.all([
    requireIdentity(),
    tenantFeatures(tenantId),
    permissionAndReview,
  ]);
  const enabled = new Set(features.filter((feature) => feature.isEnabled).map((feature) => feature.featureKey));
  const profilePhotoKey = `waybook.profile-photo.v2:${tenant.id}:${identity.id}`;
  const clientsEnabled = enabled.has("clients"), teamEnabled = enabled.has("team"), calendarsEnabled = enabled.has("calendars"), resourcesEnabled = enabled.has("resources"), notificationsEnabled = enabled.has("email-notifications");
  const canUse = {
    overview: permissions.isManager,
    clients: clientsEnabled && (permissions.isManager || permissions.canViewClients || permissions.canManageClients),
    calendars: calendarsEnabled && (permissions.isManager || Boolean(permissions.teamMemberId)),
    bookings: calendarsEnabled && (permissions.isManager || permissions.canManageOwnAppointments),
    sales: permissions.isManager,
    products: permissions.isManager,
    giftCards: permissions.isManager,
    packages: permissions.isManager,
    team: teamEnabled && (permissions.isManager || Boolean(permissions.teamMemberId)),
    reports: permissions.isManager || permissions.canAccessReports,
    waitlist: calendarsEnabled && (permissions.isManager || permissions.canManageWaitlist),
    resources: resourcesEnabled && (permissions.isManager || permissions.canManageResources),
    serviceSettings: permissions.isManager || permissions.canManageServiceSettings,
    notifications: permissions.isManager,
    emails: notificationsEnabled && permissions.isManager,
    targets: permissions.isManager,
  };
  const toHref = (href: string) => resolvedTenantSlug ? tenantPath(resolvedTenantSlug, href) : href;
  const primary = primaryLinks.filter((link) => canUse[link.id as keyof typeof canUse]).map((link) => ({ ...link, href: toHref(link.href) }));
  const appLinks: TenantAppLink[] = [
    canUse.bookings ? { id: "bookings", href: toHref("/app/bookings"), label: "Bookings", description: "All appointments", group: "Operations" } : null,
    canUse.sales ? { id: "sales", href: toHref("/app/sales"), label: "Sales", description: "Checkout and payment status", group: "Commerce" } : null,
    canUse.products ? { id: "products", href: toHref("/app/products"), label: "Products", description: "Retail catalogue", group: "Commerce" } : null,
    canUse.giftCards ? { id: "giftCards", href: toHref("/app/gift-cards"), label: "Gift cards", description: "Balances and owners", group: "Commerce" } : null,
    canUse.packages ? { id: "packages", href: toHref("/app/packages"), label: "Packages", description: "Client visit balances", group: "Commerce" } : null,
    canUse.calendars ? { id: "calendars", href: toHref("/app/calendars"), label: "Calendar", description: "Schedule and availability", group: "Operations" } : null,
    canUse.waitlist ? { id: "waitlist", href: toHref("/app/waitlist"), label: "Waitlist", description: "Fill open times", group: "Operations" } : null,
    canUse.clients ? { id: "clients", href: toHref("/app/customers"), label: "Clients", description: "Client history", group: "Operations" } : null,
    canUse.team ? { id: "team", href: toHref("/app/team"), label: "Staff", description: "Hours and eligibility", group: "Setup" } : null,
    canUse.targets ? { id: "targets", href: toHref("/app/targets"), label: "Targets", description: "Monthly staff plans", group: "Insights" } : null,
    canUse.serviceSettings ? { id: "onlineBooking", href: toHref("/app/online-booking"), label: "Online booking", description: "Public page and catalogue", group: "Setup" } : null,
    canUse.serviceSettings ? { id: "services", href: toHref("/app/services"), label: "Services", description: "Prices and duration", group: "Setup" } : null,
    canUse.serviceSettings ? { id: "locations", href: toHref("/app/locations"), label: "Locations", description: "Where you operate", group: "Setup" } : null,
    canUse.resources ? { id: "resources", href: toHref("/app/resources"), label: "Resources", description: "Rooms and equipment", group: "Operations" } : null,
    canUse.notifications ? { id: "notifications", href: toHref("/app/notifications"), label: "Notifications", description: "Appointments to review", group: "Operations" } : null,
    canUse.emails ? { id: "emails", href: toHref("/app/emails"), label: "Emails", description: "Email delivery history", group: "Operations" } : null,
    canUse.reports ? { id: "reports", href: toHref("/app/reports"), label: "Reports", description: "Business performance", group: "Insights" } : null,
  ].filter(Boolean) as TenantAppLink[];

  return <><DrawerToggleSemantics /><DrawerHeaderSubmitActions /><header className="tenant-dashboard-nav" aria-label="Tenant dashboard navigation">
    <div className="tenant-dashboard-nav__workspace"><span className="tenant-dashboard-nav__brand"><img className="tenant-dashboard-nav__logo tenant-dashboard-nav__logo--light" src="/brand/waybook-logo.svg" alt="Waybook" /><img className="tenant-dashboard-nav__logo tenant-dashboard-nav__logo--dark" src="/brand/waybook-logo-white.svg" alt="" aria-hidden="true" /></span><strong>{tenantName}</strong></div>
    <nav aria-label="Primary navigation">{primary.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}><link.Icon aria-hidden="true" />{link.label}</Link>)}</nav>
    <TenantAppMenu links={appLinks} active={active} />
    <div className="tenant-nav-account-actions"><TenantNavTools searchHref={toHref("/app/search")} notificationsHref={canUse.notifications ? toHref("/app/notifications") : undefined} notificationsPending={review?.pending ?? false} /><TenantUserMenu key={profilePhotoKey} profilePhotoKey={profilePhotoKey} displayName={identity.displayName} email={identity.email} tenantName={tenantName} role={identity.isPlatformAdmin ? "Platform administrator" : membership.role === "owner" ? "Owner" : membership.role === "manager" ? "Manager" : "Staff member"} staffHref={canUse.team ? toHref("/app/team") : undefined} settingsHref={toHref("/app/settings")} onSignOut={logout} /></div>
  </header></>;
}
