import Link from "next/link";
import { logout } from "@/app/actions";
import { isFeatureEnabled } from "@/lib/waybook/features";

type TenantDashboardNavProps = {
  tenantId: string;
  tenantName: string;
  active: "overview" | "bookings" | "services" | "clients" | "team" | "calendars";
};

const mainLinks = [
  { id: "overview", href: "/app", label: "Overview" },
  { id: "bookings", href: "/app/bookings", label: "Bookings" },
] as const;

export async function TenantDashboardNav({ tenantId, tenantName, active }: TenantDashboardNavProps) {
  const [clientsEnabled, teamEnabled, calendarsEnabled] = await Promise.all([
    isFeatureEnabled(tenantId, "clients"),
    isFeatureEnabled(tenantId, "team"),
    isFeatureEnabled(tenantId, "calendars"),
  ]);
  const optionalLinks = [
    { id: "services", href: "/app/services", label: "Services" },
    clientsEnabled ? { id: "clients", href: "/app/customers", label: "Clients" } : null,
    teamEnabled ? { id: "team", href: "/app/team", label: "Staff" } : null,
    calendarsEnabled ? { id: "calendars", href: "/app/calendars", label: "Calendars" } : null,
  ].filter(Boolean) as { id: TenantDashboardNavProps["active"]; href: string; label: string }[];

  return <aside className="tenant-dashboard-nav" aria-label="Tenant dashboard navigation">
    <div className="tenant-dashboard-nav__workspace"><span>WORKSPACE</span><strong>{tenantName}</strong></div>
    <nav>
      {mainLinks.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>)}
      {optionalLinks.length > 0 ? <span className="tenant-dashboard-nav__label">Manage</span> : null}
      {optionalLinks.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>)}
    </nav>
    <form action={logout} className="tenant-dashboard-nav__signout"><button type="submit">Sign out</button></form>
  </aside>;
}
