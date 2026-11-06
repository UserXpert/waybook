import Link from "next/link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { logout } from "../../actions";
import { saveService } from "./actions";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number; recommendedRebookDays: number | null; isActive: boolean; employees: string | null };
type Member = { id: string; name: string; email: string };
type Location = { id: string; name: string };
type Assignment = { serviceId: string; teamMemberId: string };
type LocationAssignment = { serviceId: string; locationId: string };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ service?: string; new?: string }> }) {
  const { service, new: createNew } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager || permissions.canManageServiceSettings;
  if (!canManage) throw new Error("You do not have permission to view service settings.");
  const db = tenantDb(tenant);
  const services = await db<Service[]>`SELECT s.id, s.title, s.description, s.duration_minutes AS "durationMinutes", s.price_cents AS "priceCents", s.recommended_rebook_days AS "recommendedRebookDays", s.is_active AS "isActive", string_agg(tm.name, ', ' ORDER BY tm.name) AS employees FROM services s LEFT JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id LEFT JOIN team_members tm ON tm.id = stm.team_member_id AND tm.tenant_id = stm.tenant_id WHERE s.tenant_id = ${tenant.id} GROUP BY s.id ORDER BY s.is_active DESC, s.title`;
  const members = await db<Member[]>`SELECT id, name, email FROM team_members WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY name`;
  const assignments = await db<Assignment[]>`SELECT service_id AS "serviceId", team_member_id AS "teamMemberId" FROM service_team_members WHERE tenant_id = ${tenant.id}`;
  const locations = await db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`;
  const locationAssignments = await db<LocationAssignment[]>`SELECT service_id AS "serviceId", location_id AS "locationId" FROM service_locations WHERE tenant_id = ${tenant.id}`;
  const selected = services.find((item) => item.id === service) ?? null;
  const selectedMemberIds = new Set(assignments.filter((assignment) => assignment.serviceId === selected?.id).map((assignment) => assignment.teamMemberId));
  const selectedLocationIds = new Set(locationAssignments.filter((assignment) => assignment.serviceId === selected?.id).map((assignment) => assignment.locationId));
  const panelOpen = Boolean(selected || createNew === "1");
  const panelTitle = selected ? "Edit service" : "Add service";
  const formatPrice = (priceCents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(priceCents / 100);
  const servicesPath = tenantPath(tenantSlug, "/app/services");
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="services" /><header><div><p>SERVICES · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>What customers can book and who can deliver it.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Services</h2><p>Every service is tenant-scoped and controls its duration, price, locations, eligible staff, and optional return cadence.</p></div>{canManage ? <Link className="waybook-primary-link" href={`${servicesPath}?new=1`}>Add service</Link> : null}</div><div className="waybook-service-list">{services.map((item) => <Link key={item.id} className="waybook-service-card" href={`${servicesPath}?service=${item.id}`}><div><strong>{item.title}</strong><span>{item.durationMinutes} min · {formatPrice(item.priceCents)} · {item.isActive ? "Active" : "Inactive"}</span><small>{item.employees ?? "No staff assigned"}{item.recommendedRebookDays ? ' · Return every ' + item.recommendedRebookDays + ' days' : ''}</small></div><b aria-hidden="true">→</b></Link>)}{services.length === 0 ? <p>No services yet. Add the first one to begin accepting bookings.</p> : null}</div></section>{panelOpen ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close service editor" href={servicesPath} /><aside className="tenant-drawer" aria-label={panelTitle}><header><div><p>SERVICES</p><h2>{panelTitle}</h2><span>Changes are used by live availability and booking confirmation.</span></div><Link className="tenant-drawer-close" aria-label="Close service editor" href={servicesPath}>×</Link></header>{canManage ? <form action={saveService} className="tenant-drawer-form"><input type="hidden" name="serviceId" value={selected?.id ?? ""} /><label>Service name<input name="title" defaultValue={selected?.title ?? ""} required /></label><label>Description<textarea name="description" defaultValue={selected?.description ?? ""} rows={3} /></label><div className="tenant-drawer-form__grid"><label>Duration (minutes)<input name="durationMinutes" type="number" min="5" step="5" defaultValue={selected?.durationMinutes ?? 60} required /></label><label>Price (DKK)<input name="priceDkk" type="number" min="0" step="1" defaultValue={(selected?.priceCents ?? 0) / 100} required /></label><label>Recommended return (days)<input name="recommendedRebookDays" type="number" min="1" max="730" step="1" defaultValue={selected?.recommendedRebookDays ?? ''} placeholder="Optional" /></label></div><label className="tenant-drawer-check"><input type="checkbox" name="isActive" defaultChecked={selected?.isActive ?? true} /> Available for booking</label><fieldset><legend>Locations where this service can be booked</legend>{locations.map((location) => <label key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={selectedLocationIds.has(location.id)} /> {location.name}</label>)}{locations.length === 0 ? <p>Add a location before making this service bookable.</p> : null}</fieldset><fieldset><legend>Staff who can deliver this service</legend>{members.map((member) => <label key={member.id}><input type="checkbox" name="memberIds" value={member.id} defaultChecked={selectedMemberIds.has(member.id)} /> {member.name}<small>{member.email}</small></label>)}{members.length === 0 ? <p>Add staff in Staff before assigning them to this service.</p> : null}</fieldset><button type="submit">Save service</button></form> : <p className="tenant-drawer-note">Read-only access: service records cannot be changed with your role.</p>}</aside></div> : null}</main>;
}
