import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import Link from "next/link";
import { BarChart3, CalendarDays, LayoutDashboard, UsersRound } from "lucide-react";
import { logout } from "@/app/actions";
import { saveStaffPhoto } from "@/app/app/team/actions";
import { canEditStaffPhoto } from "@/lib/waybook/staff-photo-permissions";
import { tenantFeatures } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireIdentity } from "@/lib/waybook/auth";
import { staffPermissionContext, workspaceSearchPermissions } from "@/lib/waybook/staff-permissions";
import { tenantDb } from "@/lib/waybook/database";
import { canReceiveArrivalAlerts, providerArrivalAlertPending } from "@/lib/waybook/provider-arrival-alerts";
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
  const identityResult = requireIdentity();
  const featuresResult = tenantFeatures(tenantId);
  const accountProfileResult = Promise.all([identityResult, featuresResult]).then(async ([identity, features]) => {
    if (identity.isPlatformAdmin || !features.some((feature) => feature.featureKey === "team" && feature.isEnabled)) return;
    const [profile] = await tenantDb(tenant)<{ id: string; name: string; photo: string | null; hasPhotoColumn: boolean }[]>`
      SELECT id, name, to_jsonb(tm)->>'photo_data_url' AS photo,
        to_jsonb(tm) ? 'photo_data_url' AS "hasPhotoColumn"
      FROM team_members tm
      WHERE tenant_id = ${tenant.id} AND identity_id = ${identity.id} AND is_active
      ORDER BY (role = ${membership.role}) DESC, id LIMIT 1
    `;
    return profile;
  });
  const permissionAndReview = staffPermissionContext(tenant, membership).then(async (permissions) => {
    const [review] = permissions.isManager ? await tenantDb(tenant)<{ pending: boolean }[]>`SELECT EXISTS (SELECT 1 FROM bookings WHERE tenant_id=${tenant.id} AND status='arrived' AND ends_at <= now()) AS pending` : [];
    return { permissions, review };
  });
  const [identity, features, { permissions, review }, terms, accountProfile] = await Promise.all([
    identityResult,
    featuresResult,
    permissionAndReview,
    getTenantTerminology(tenant),
    accountProfileResult,
  ]);
  const enabled = new Set(features.filter((feature) => feature.isEnabled).map((feature) => feature.featureKey));
  const { canSearchAppointments, canSearchClients } = workspaceSearchPermissions(permissions);
  const searchEnabled = enabled.has("booking-essentials") && (canSearchAppointments || canSearchClients);
  const searchLabel = canSearchAppointments && canSearchClients
    ? `Search bookings or ${terms.clients}`
    : canSearchAppointments ? "Search bookings" : `Search ${terms.clients}`;
  const clientsEnabled = enabled.has("clients"), teamEnabled = enabled.has("team"), calendarsEnabled = enabled.has("calendars"), resourcesEnabled = enabled.has("resources"), notificationsEnabled = enabled.has("email-notifications");
  const canReceiveAlerts = calendarsEnabled && membership.role !== "read-only" &&
    (permissions.isManager || Boolean(permissions.teamMemberId)) &&
    await canReceiveArrivalAlerts(tenantDb(tenant), tenant.id, identity.id);
  const arrivalPending = canReceiveAlerts && await providerArrivalAlertPending(tenantDb(tenant), tenant.id, identity.id);
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
    notifications: permissions.isManager || canReceiveAlerts,
    emails: notificationsEnabled && permissions.isManager,
    targets: permissions.isManager,
  };
  const toHref = (href: string) => resolvedTenantSlug ? tenantPath(resolvedTenantSlug, href) : href;
  const staffHref = canUse.team ? toHref("/app/team") + (accountProfile ? `?employee=${accountProfile.id}` : "") : undefined;
  const photoMemberId = accountProfile?.hasPhotoColumn &&
    canEditStaffPhoto(membership.role, permissions.teamMemberId, accountProfile.id) ? accountProfile.id : null;
  const primary = primaryLinks.filter((link) => canUse[link.id as keyof typeof canUse]).map((link) => ({ ...link, href: toHref(link.href), label: link.id === "clients" ? titleTerminology(terms.clients) : link.label }));
  const appLinks: TenantAppLink[] = [
    canUse.bookings ? { id: "bookings", href: toHref("/app/bookings"), label: "Bookings", description: "All appointments", group: "Operations" } : null,
    canUse.sales ? { id: "sales", href: toHref("/app/sales"), label: "Sales", description: "Checkout and payment status", group: "Commerce" } : null,
    canUse.products ? { id: "products", href: toHref("/app/products"), label: "Products", description: "Retail catalogue", group: "Commerce" } : null,
    canUse.giftCards ? { id: "giftCards", href: toHref("/app/gift-cards"), label: "Gift cards", description: "Balances and owners", group: "Commerce" } : null,
    canUse.packages ? { id: "packages", href: toHref("/app/packages"), label: "Packages", description: "Client visit balances", group: "Commerce" } : null,
    canUse.calendars ? { id: "calendars", href: toHref("/app/calendars"), label: "Calendar", description: "Schedule and availability", group: "Operations" } : null,
    canUse.waitlist ? { id: "waitlist", href: toHref("/app/waitlist"), label: "Waitlist", description: "Fill open times", group: "Operations" } : null,
    canUse.clients ? { id: "clients", href: toHref("/app/customers"), label: titleTerminology(terms.clients), description: `${titleTerminology(terms.client)} history`, group: "Operations" } : null,
    canUse.team ? { id: "team", href: toHref("/app/team"), label: titleTerminology(terms.staffPlural), description: "Hours and eligibility", group: "Setup" } : null,
    canUse.serviceSettings ? { id: "onlineBooking", href: toHref("/app/online-booking"), label: "Online booking", description: "Public page and catalogue", group: "Setup" } : null,
    canUse.serviceSettings ? { id: "services", href: toHref("/app/services"), label: "Services", description: "Prices and duration", group: "Setup" } : null,
    canUse.serviceSettings ? { id: "locations", href: toHref("/app/locations"), label: "Locations", description: "Where you operate", group: "Setup" } : null,
    canUse.resources ? { id: "resources", href: toHref("/app/resources"), label: "Resources", description: "Rooms and equipment", group: "Setup" } : null,
    canUse.notifications ? { id: "notifications", href: toHref("/app/notifications"), label: "Notifications", description: permissions.isManager ? "Appointments to review" : "Waiting room alerts", group: "Activity & insights" } : null,
    canUse.emails ? { id: "emails", href: toHref("/app/emails"), label: "Emails", description: "Email delivery history", group: "Activity & insights" } : null,
    canUse.targets ? { id: "targets", href: toHref("/app/targets"), label: "Targets", description: `Monthly ${terms.staff} plans`, group: "Activity & insights" } : null,
    canUse.reports ? { id: "reports", href: toHref("/app/reports"), label: "Reports", description: "Business performance", group: "Activity & insights" } : null,
  ].filter(Boolean) as TenantAppLink[];

  return <><DrawerToggleSemantics /><DrawerHeaderSubmitActions /><header className="tenant-dashboard-nav" aria-label="Tenant dashboard navigation">
    <div className="tenant-dashboard-nav__workspace"><span className="tenant-dashboard-nav__brand"><img className="tenant-dashboard-nav__logo tenant-dashboard-nav__logo--light" src="/brand/waybook-logo.svg" alt="Waybook" /><img className="tenant-dashboard-nav__logo tenant-dashboard-nav__logo--dark" src="/brand/waybook-logo-white.svg" alt="" aria-hidden="true" /></span><strong>{tenantName}</strong></div>
    <nav aria-label="Primary navigation">{primary.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}><link.Icon aria-hidden="true" />{link.label}</Link>)}</nav>
    <TenantAppMenu links={appLinks} active={active} />
    <div className="tenant-nav-account-actions">
      <TenantNavTools searchLabel={searchLabel} searchHref={searchEnabled ? toHref("/app/search") : undefined}
        notificationsHref={canUse.notifications ? toHref("/app/notifications") : undefined} notificationsPending={review?.pending ?? false}
        arrivalAlertsHref={canReceiveAlerts ? toHref("/api/app/arrival-alerts") : undefined} arrivalAlertPending={arrivalPending} />
      <TenantUserMenu
        key={`${tenant.id}:${identity.id}`}
        photo={accountProfile?.photo ?? null}
        photoMemberId={photoMemberId}
        onSavePhoto={saveStaffPhoto}
        displayName={membership.role === "owner" ? accountProfile?.name ?? identity.displayName : identity.displayName}
        email={identity.email}
        role={identity.isPlatformAdmin ? "Platform administrator" : membership.role === "owner" ? "Owner" : membership.role === "manager" ? "Manager" : titleTerminology(terms.staffMember)}
        staffHref={staffHref}
        settingsHref={toHref("/app/settings")}
        onSignOut={logout}
      />
    </div>
  </header></>;
}
