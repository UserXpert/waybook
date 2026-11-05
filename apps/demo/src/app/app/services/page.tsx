import Link from "next/link";
import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { logout } from "../../actions";
import { saveService } from "./actions";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; priceCents: number; isActive: boolean; employees: string | null };
type Member = { id: string; name: string; email: string };
type Assignment = { serviceId: string; teamMemberId: string };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ service?: string; new?: string }> }) {
  const { service, new: createNew } = await searchParams;
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const [membership] = await controlDb<{ tenantId: string; role: string }[]>`SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2`;
  if (!membership) throw new Error("Tenant membership is required.");
  const tenant = await findTenantById(membership.tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  await requireFeature(tenant.id, "booking-essentials");
  const db = tenantDb(tenant);
  const [services, members, assignments] = await Promise.all([
    db<Service[]>`SELECT s.id, s.title, s.description, s.duration_minutes AS "durationMinutes", s.buffer_before_minutes AS "bufferBeforeMinutes", s.buffer_after_minutes AS "bufferAfterMinutes", s.price_cents AS "priceCents", s.is_active AS "isActive", string_agg(tm.name, ', ' ORDER BY tm.name) AS employees FROM services s LEFT JOIN service_team_members stm ON stm.service_id = s.id AND stm.tenant_id = s.tenant_id LEFT JOIN team_members tm ON tm.id = stm.team_member_id AND tm.tenant_id = stm.tenant_id WHERE s.tenant_id = ${tenant.id} GROUP BY s.id ORDER BY s.is_active DESC, s.title`,
    db<Member[]>`SELECT id, name, email FROM team_members WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY name`,
    db<Assignment[]>`SELECT service_id AS "serviceId", team_member_id AS "teamMemberId" FROM service_team_members WHERE tenant_id = ${tenant.id}`,
  ]);
  const selected = services.find((item) => item.id === service) ?? null;
  const selectedMemberIds = new Set(assignments.filter((assignment) => assignment.serviceId === selected?.id).map((assignment) => assignment.teamMemberId));
  const canManage = ["owner", "manager"].includes(membership.role);
  const panelOpen = Boolean(selected || createNew === "1");
  const panelTitle = selected ? "Edit service" : "Add service";
  const formatPrice = (priceCents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(priceCents / 100);
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantName={tenant.name} active="services" /><header><div><p>SERVICES · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>What customers can book and who can deliver it.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Services</h2><p>Every service is tenant-scoped and controls its own duration, buffers, price, and eligible staff.</p></div>{canManage ? <Link className="waybook-primary-link" href="/app/services?new=1">Add service</Link> : null}</div><div className="waybook-service-list">{services.map((item) => <Link key={item.id} className="waybook-service-card" href={`/app/services?service=${item.id}`}><div><strong>{item.title}</strong><span>{item.durationMinutes} min · {formatPrice(item.priceCents)} · {item.isActive ? "Active" : "Inactive"}</span><small>{item.employees ?? "No staff assigned"}</small></div><b aria-hidden="true">→</b></Link>)}{services.length === 0 ? <p>No services yet. Add the first one to begin accepting bookings.</p> : null}</div></section>{panelOpen ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close service editor" href="/app/services" /><aside className="tenant-drawer" aria-label={panelTitle}><header><div><p>SERVICES</p><h2>{panelTitle}</h2><span>Changes are used by live availability and booking confirmation.</span></div><Link className="tenant-drawer-close" aria-label="Close service editor" href="/app/services">×</Link></header>{canManage ? <form action={saveService} className="tenant-drawer-form"><input type="hidden" name="serviceId" value={selected?.id ?? ""} /><label>Service name<input name="title" defaultValue={selected?.title ?? ""} required /></label><label>Description<textarea name="description" defaultValue={selected?.description ?? ""} rows={3} /></label><div className="tenant-drawer-form__grid"><label>Duration (minutes)<input name="durationMinutes" type="number" min="5" step="5" defaultValue={selected?.durationMinutes ?? 60} required /></label><label>Price (DKK)<input name="priceDkk" type="number" min="0" step="1" defaultValue={(selected?.priceCents ?? 0) / 100} required /></label><label>Buffer before<input name="bufferBeforeMinutes" type="number" min="0" step="5" defaultValue={selected?.bufferBeforeMinutes ?? 0} required /></label><label>Buffer after<input name="bufferAfterMinutes" type="number" min="0" step="5" defaultValue={selected?.bufferAfterMinutes ?? 0} required /></label></div><label className="tenant-drawer-check"><input type="checkbox" name="isActive" defaultChecked={selected?.isActive ?? true} /> Available for booking</label><fieldset><legend>Staff who can deliver this service</legend>{members.map((member) => <label key={member.id}><input type="checkbox" name="memberIds" value={member.id} defaultChecked={selectedMemberIds.has(member.id)} /> {member.name}<small>{member.email}</small></label>)}{members.length === 0 ? <p>Add staff in Staff before assigning them to this service.</p> : null}</fieldset><button type="submit">Save service</button></form> : <p className="tenant-drawer-note">Read-only access: service records cannot be changed with your role.</p>}</aside></div> : null}</main>;
}
