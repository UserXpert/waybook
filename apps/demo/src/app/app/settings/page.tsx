import Link from "next/link";
import { ArrowUpRight, CalendarDays, Mail, MapPin, Package, UsersRound, Wrench } from "lucide-react";
import { notFound } from "next/navigation";
import { TenantAppearanceControls } from "@/components/tenant-appearance-controls";
import { TenantBusinessProfileForm } from "@/components/tenant-business-profile-form";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { TenantTerminologyForm } from "@/components/tenant-terminology-form";
import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { parseBookingPage, publicBookingImageUrl } from "@/lib/waybook/booking-page-media";
import { parseBusinessProfile } from "@/lib/waybook/business-profile";
import { tenantDb } from "@/lib/waybook/database";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { stripeSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { sandboxMerchantStatus } from "@/lib/waybook/stripe-sandbox";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { getTenantTerminologySettings } from "@/lib/waybook/tenant-terminology";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { terminologyLabels, titleTerminology } from "@/lib/waybook/terminology-labels";
import { StaffRolesPanel } from "./roles/panel";
import { startStripeSandboxOnboarding } from "./payment-actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; role?: string; new?: string; stripe?: string }> }) {
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
  const showingRoles = params.tab === "roles";
  const showingBusiness = params.tab === "business";
  const showingPayments = params.tab === "payments";
  const sandbox = membership.role === "owner" ? stripeSandboxConfig(process.env) : null;
  if (showingRoles && !canManageRoles) notFound();
  if (showingPayments && !sandbox) notFound();
  const settingsHref = tenantPath(slug, "/app/settings");
  const rolesHref = `${settingsHref}?tab=roles`;
  const businessHref = `${settingsHref}?tab=business`;
  const paymentsHref = `${settingsHref}?tab=payments`;
  const merchantStatus = showingPayments && sandbox ? await sandboxMerchantStatus(tenant.id, sandbox) : null;
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
          <Link href={settingsHref} aria-current={!showingRoles && !showingBusiness && !showingPayments ? "page" : undefined}>Appearance</Link>
          {canViewBusiness ? <Link href={businessHref} aria-current={showingBusiness ? "page" : undefined}>Business setup</Link> : null}
          {sandbox ? <Link href={paymentsHref} aria-current={showingPayments ? "page" : undefined}>Payments</Link> : null}
          {canManageRoles ? <Link href={rolesHref} aria-current={showingRoles ? "page" : undefined}>Roles &amp; permissions</Link> : null}
        </nav>
        <div className="workspace-settings__content">
          {merchantStatus ? <section className="workspace-settings__panel" aria-labelledby="stripe-sandbox-title">
            <h2 id="stripe-sandbox-title">Stripe sandbox</h2>
            {params.stripe === "unavailable" ? <p role="alert">Stripe setup could not open. Try again in a moment.</p> : null}
            {params.stripe === "resume" && merchantStatus === "pending" ? <p role="status">Continue setup to open a fresh Stripe link.</p> : null}
            <p>{{
              unconnected: "Set up a Danish sandbox merchant to test card payments.",
              pending: "Stripe setup is incomplete or awaiting verification.",
              ready: "Stripe has verified your sandbox account for card payments.",
              restricted: "Stripe has restricted card payments on this sandbox account.",
              disconnected: "Stripe could not find this sandbox account. Review the account in Stripe.",
              unresolved: "An earlier setup attempt needs to be reconciled before you can continue.",
              unavailable: "Stripe status is temporarily unavailable. Try refreshing the status.",
            }[merchantStatus]}</p>
            {merchantStatus === "unconnected" || merchantStatus === "pending" ? <form action={startStripeSandboxOnboarding}>
              <StripeOnboardingButton label={merchantStatus === "unconnected" ? "Set up Stripe sandbox" : "Continue Stripe setup"} />
            </form> : <Link href={paymentsHref} className="waybook-action waybook-action--secondary">Refresh status</Link>}
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
