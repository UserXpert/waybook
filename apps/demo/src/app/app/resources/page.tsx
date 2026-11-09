import Link from "next/link";
import { AsyncMultiSelect } from "@/components/async-multi-select";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { logout } from "../../actions";
import { saveResource } from "./actions";

type Resource = { id: string; name: string; resourceType: string; capacity: number; isActive: boolean; isMutuallyExclusive: boolean; locations: string | null; services: string | null };
type Choice = { id: string; name: string };
type ResourceBooking = { id: string; resourceId: string; startsAt: Date; endsAt: Date; customerName: string; serviceTitle: string; teamMemberId: string | null; locationId: string | null };
const addDays = (date: string, days: number) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<{ resource?: string; new?: string; day?: string }> }) {
  const { resource, new: createNew, day } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "resources");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const db = tenantDb(tenant);
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager || permissions.canManageResources;
  if (!canManage) throw new Error("You do not have permission to view resource settings.");
  const scheduleDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : tenantDateKey(new Date(), tenant.timezone);
  const [resources, resourceBookings] = await Promise.all([
    db.unsafe<Resource[]>("SELECT r.id,r.name,r.resource_type AS \"resourceType\",r.capacity,r.is_active AS \"isActive\",r.is_mutually_exclusive AS \"isMutuallyExclusive\",string_agg(DISTINCT l.name, ', ' ORDER BY l.name) AS locations,string_agg(DISTINCT s.title, ', ' ORDER BY s.title) AS services FROM resources r LEFT JOIN resource_locations rl ON rl.resource_id=r.id AND rl.tenant_id=r.tenant_id LEFT JOIN locations l ON l.id=rl.location_id AND l.tenant_id=r.tenant_id LEFT JOIN service_resources sr ON sr.resource_id=r.id AND sr.tenant_id=r.tenant_id LEFT JOIN services s ON s.id=sr.service_id AND s.tenant_id=r.tenant_id WHERE r.tenant_id=$1 GROUP BY r.id ORDER BY r.is_active DESC,r.name", [tenant.id]),
    db.unsafe<ResourceBooking[]>("SELECT b.id,bra.resource_id AS \"resourceId\",b.starts_at AS \"startsAt\",b.ends_at AS \"endsAt\",c.name AS \"customerName\",s.title AS \"serviceTitle\",b.team_member_id AS \"teamMemberId\",b.location_id AS \"locationId\" FROM booking_resource_assignments bra JOIN bookings b ON b.id=bra.booking_id AND b.tenant_id=bra.tenant_id JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE bra.tenant_id=$1 AND bra.released_at IS NULL AND b.status NOT IN ('cancelled','no_show') AND timezone($2,b.starts_at)::date=$3::date ORDER BY b.starts_at", [tenant.id, tenant.timezone, scheduleDay]),
  ]);
  const selected = resources.find((item) => item.id === resource) ?? null;
  const [selectedLocations, selectedServices] = selected ? await Promise.all([
    db.unsafe<Choice[]>("SELECT l.id,l.name FROM resource_locations rl JOIN locations l ON l.id=rl.location_id AND l.tenant_id=rl.tenant_id WHERE rl.tenant_id=$1 AND rl.resource_id=$2 ORDER BY l.name", [tenant.id, selected.id]),
    db.unsafe<Choice[]>("SELECT s.id,s.title AS name FROM service_resources sr JOIN services s ON s.id=sr.service_id AND s.tenant_id=sr.tenant_id WHERE sr.tenant_id=$1 AND sr.resource_id=$2 ORDER BY s.title", [tenant.id, selected.id]),
  ]) : [[], []] as [Choice[], Choice[]];
  const path = tenantPath(tenantSlug, "/app/resources");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const scheduleHref = (booking: ResourceBooking) => booking.teamMemberId ? `${tenantPath(tenantSlug, "/app/calendars")}?${new URLSearchParams({ employee: booking.teamMemberId, booking: booking.id, day: scheduleDay, week: weekStartForLocalDate(scheduleDay), ...(booking.locationId ? { location: booking.locationId } : {}) })}` : null;
  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="resources" />
    <header><div><p>RESOURCES · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>Rooms, bays, chairs, equipment, and other capacity your services require.</span></div><form action={logout}><button>Sign out</button></form></header>
    <section className="waybook-data-card resource-schedule"><div className="waybook-section-heading"><div><p>RESOURCE SCHEDULE</p><h2>Occupancy</h2><span>Confirmed and checked-in appointments using a room or resource on {scheduleDay}.</span></div><div className="resource-schedule__days"><Link href={`${path}?day=${addDays(scheduleDay, -1)}`}>←</Link><strong>{scheduleDay}</strong><Link href={`${path}?day=${addDays(scheduleDay, 1)}`}>→</Link></div></div><div className="waybook-table-wrap"><table><thead><tr><th>Resource</th><th>Appointments</th></tr></thead><tbody>{resources.filter((item) => item.isActive).map((item) => { const bookings = resourceBookings.filter((booking) => booking.resourceId === item.id); return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.isMutuallyExclusive ? "Exclusive" : "Shared"}</small></td><td>{bookings.length ? <ul className="resource-schedule__bookings">{bookings.map((booking) => { const href = scheduleHref(booking); const label = `${time.format(booking.startsAt)}–${time.format(booking.endsAt)} · ${booking.customerName} · ${booking.serviceTitle}`; return <li key={booking.id}>{href ? <Link href={href}>{label}</Link> : label}</li>; })}</ul> : "Available"}</td></tr>; })}{resources.filter((item) => item.isActive).length === 0 ? <tr><td colSpan={2}>No active resources are configured.</td></tr> : null}</tbody></table></div></section>
    <section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Resources</h2><p>Choose whether a room must be exclusive or can be shared by multiple staff at the same time.</p></div><Link className="waybook-primary-link" href={path + "?new=1"}>Add resource</Link></div><div className="waybook-service-list">{resources.map((item) => <Link key={item.id} className="waybook-service-card" href={path + "?resource=" + item.id}><div><strong>{item.name}</strong><span>{item.resourceType} · {item.isMutuallyExclusive ? "Exclusive" : "Shared"} · {item.isActive ? "Active" : "Inactive"}</span><small>{item.locations ?? "No location assigned"} · {item.services ?? "No services assigned"}</small></div><b aria-hidden="true">→</b></Link>)}{resources.length === 0 ? <p>No resources yet. Add a room, chair, bay, or equipment unit when a service needs more than staff availability.</p> : null}</div></section>
    {(selected || createNew === "1") ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close resource editor" href={path} /><aside className="tenant-drawer" aria-label={selected ? "Edit resource" : "Add resource"}><header><div><p>RESOURCES</p><h2>{selected ? "Edit resource" : "Add resource"}</h2><span>Assignments are tenant-scoped and auditable.</span></div><Link className="tenant-drawer-close" aria-label="Close resource editor" href={path}>×</Link></header><form action={saveResource} className="tenant-drawer-form"><input type="hidden" name="resourceId" value={selected?.id ?? ""} /><label>Resource name<input name="name" defaultValue={selected?.name ?? ""} placeholder="Treatment Room 1" required /></label><label>Type<input name="resourceType" defaultValue={selected?.resourceType ?? ""} placeholder="Room, chair, bay…" required /></label><input type="hidden" name="capacity" value="1" /><label className="tenant-drawer-check"><input type="checkbox" name="isMutuallyExclusive" defaultChecked={selected?.isMutuallyExclusive ?? true} /> Mutually exclusive — one staff member at a time</label><p className="tenant-drawer-note">Turn this off for a shared room where multiple staff can work at the same time.</p><label className="tenant-drawer-check"><input type="checkbox" name="isActive" defaultChecked={selected?.isActive ?? true} /> Active resource</label><AsyncMultiSelect name="locationIds" label="Locations where it is available" endpoint="/api/app/locations" initial={selectedLocations} /><AsyncMultiSelect name="serviceIds" label="Services that require it" endpoint="/api/app/services" initial={selectedServices} /><button type="submit">Save resource</button></form></aside></div> : null}
  </main>;
}
