import Link from "next/link";
import { AsyncMultiSelect } from "@/components/async-multi-select";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { logout } from "../../actions";
import { saveService } from "./actions";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number; recommendedRebookDays: number | null; isActive: boolean; employees: string | null };
type Choice = { id: string; name: string };
const price = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ service?: string; new?: string }> }) {
  const { service, new: createNew } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager || permissions.canManageServiceSettings;
  if (!canManage) throw new Error("You do not have permission to view service settings.");
  const db = tenantDb(tenant);
  const services = await db<Service[]>`SELECT s.id,s.title,s.description,s.duration_minutes AS "durationMinutes",s.price_cents AS "priceCents",s.recommended_rebook_days AS "recommendedRebookDays",s.is_active AS "isActive",string_agg(tm.name,', ' ORDER BY tm.name) AS employees FROM services s LEFT JOIN service_team_members stm ON stm.service_id=s.id AND stm.tenant_id=s.tenant_id LEFT JOIN team_members tm ON tm.id=stm.team_member_id AND tm.tenant_id=stm.tenant_id WHERE s.tenant_id=${tenant.id} GROUP BY s.id ORDER BY s.is_active DESC,s.title`;
  const selected = services.find((item) => item.id === service) ?? null;
  const [selectedMembers, selectedLocations] = selected ? await Promise.all([
    db.unsafe<Choice[]>("SELECT tm.id,tm.name FROM service_team_members stm JOIN team_members tm ON tm.id=stm.team_member_id AND tm.tenant_id=stm.tenant_id WHERE stm.tenant_id=$1 AND stm.service_id=$2 ORDER BY tm.name", [tenant.id, selected.id]),
    db.unsafe<Choice[]>("SELECT l.id,l.name FROM service_locations sl JOIN locations l ON l.id=sl.location_id AND l.tenant_id=sl.tenant_id WHERE sl.tenant_id=$1 AND sl.service_id=$2 ORDER BY l.name", [tenant.id, selected.id]),
  ]) : [[], []] as [Choice[], Choice[]];
  const path = tenantPath(tenantSlug, "/app/services");
  const open = Boolean(selected || createNew === "1");
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="services" /><header><div><p>SERVICES · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>What customers can book and who can deliver it.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Services</h2><p>Every service is tenant-scoped and controls its duration, price, locations, eligible staff, and optional return cadence.</p></div><Link className="waybook-primary-link" href={`${path}?new=1`}>Add service</Link></div><div className="waybook-service-list">{services.map((item) => <Link key={item.id} className="waybook-service-card" href={`${path}?service=${item.id}`}><div><strong>{item.title}</strong><span>{item.durationMinutes} min · {price(item.priceCents)} · {item.isActive ? "Active" : "Inactive"}</span><small>{item.employees ?? "No staff assigned"}{item.recommendedRebookDays ? ` · Return every ${item.recommendedRebookDays} days` : ""}</small></div><b aria-hidden="true">→</b></Link>)}{services.length === 0 ? <p>No services yet. Add the first one to begin accepting bookings.</p> : null}</div></section>{open ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close service editor" href={path} /><aside className="tenant-drawer" aria-label={selected ? "Edit service" : "Add service"}><header><div><p>SERVICES</p><h2>{selected ? "Edit service" : "Add service"}</h2><span>Changes are used by live availability and booking confirmation.</span></div><Link className="tenant-drawer-close" aria-label="Close service editor" href={path}>×</Link></header><form action={saveService} className="tenant-drawer-form"><input type="hidden" name="serviceId" value={selected?.id ?? ""} /><label>Service name<input name="title" defaultValue={selected?.title ?? ""} required /></label><label>Description<textarea name="description" defaultValue={selected?.description ?? ""} rows={3} /></label><div className="tenant-drawer-form__grid"><label>Duration (minutes)<input name="durationMinutes" type="number" min="5" step="5" defaultValue={selected?.durationMinutes ?? 60} required /></label><label>Price (DKK)<input name="priceDkk" type="number" min="0" step="1" defaultValue={(selected?.priceCents ?? 0) / 100} required /></label><label>Recommended return (days)<input name="recommendedRebookDays" type="number" min="1" max="730" step="1" defaultValue={selected?.recommendedRebookDays ?? ""} placeholder="Optional" /></label></div><label className="tenant-drawer-check"><input type="checkbox" name="isActive" defaultChecked={selected?.isActive ?? true} /> Available for booking</label><AsyncMultiSelect name="locationIds" label="Locations where this service can be booked" endpoint="/api/app/locations" initial={selectedLocations} /><AsyncMultiSelect name="memberIds" label="Staff who can deliver this service" endpoint="/api/app/staff" initial={selectedMembers} staffByLocation /><button type="submit">Save service</button></form></aside></div> : null}</main>;
}
