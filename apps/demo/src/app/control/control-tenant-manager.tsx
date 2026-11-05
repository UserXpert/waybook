import type { TenantFeatureState } from "@/lib/waybook/features";
import { setTenantFeature, setTenantLifecycle } from "./actions";

export type ControlTenantRow = { id: string; slug: string; routeSlug: string; name: string; plan: string; lifecycleStatus: string; migrationStatus: string; backupStatus: string; hostname: string; workspaceHref: string; timezone: string; bookingCount: number; staffCount: number; features: TenantFeatureState[] };

function Status({ children }: { children: string }) { return <span className="control-status">{children}</span>; }

function FeatureSwitch({ tenantId, feature }: { tenantId: string; feature: TenantFeatureState }) {
  if (feature.isBaseline) return <span className="control-required">Always on</span>;
  return <form action={setTenantFeature}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="featureKey" value={feature.featureKey} /><input type="hidden" name="enabled" value={String(!feature.isEnabled)} /><button className={`control-switch ${feature.isEnabled ? "is-on" : ""}`} type="submit" role="switch" aria-checked={feature.isEnabled} aria-label={`${feature.isEnabled ? "Disable" : "Enable"} ${feature.label}`}><span aria-hidden="true" /></button></form>;
}

function TenantDrawer({ tenant }: { tenant: ControlTenantRow }) {
  return <div className="control-drawer-layer" role="presentation"><a className="control-drawer-scrim" aria-label="Close tenant details" href="/control" /><aside className="control-drawer" aria-label={`${tenant.name} details`}>
    <header className="control-drawer-header"><div><p>Tenant profile</p><h2>{tenant.name}</h2><span>/{tenant.routeSlug}</span></div><a className="control-close" aria-label="Close tenant details" href="/control">×</a></header>
    <section className="control-summary-grid" aria-label="Tenant summary"><div><span>Plan</span><strong>{tenant.plan}</strong></div><div><span>Status</span><Status>{tenant.lifecycleStatus}</Status></div><div><span>This week</span><strong>{tenant.bookingCount} bookings</strong></div><div><span>Staff</span><strong>{tenant.staffCount} active</strong></div></section>
    <section className="control-drawer-section"><div className="control-section-heading"><div><h3>Operations</h3><p>Current tenant environment and access.</p></div></div><dl className="control-facts"><div><dt>Migration</dt><dd>{tenant.migrationStatus}</dd></div><div><dt>Backup</dt><dd>{tenant.backupStatus}</dd></div><div><dt>Timezone</dt><dd>{tenant.timezone}</dd></div></dl><a className="control-workspace-link" href={tenant.workspaceHref}>Open read-only tenant dashboard <span aria-hidden="true">→</span></a></section>
    <section className="control-drawer-section"><div className="control-section-heading"><div><h3>Feature access</h3><p>Changes take effect server-side and are audit logged.</p></div></div><div className="control-feature-list">{tenant.features.map((feature) => <div className="control-feature" key={feature.featureKey}><div><strong>{feature.label}</strong><p>{feature.description}</p></div><FeatureSwitch tenantId={tenant.id} feature={feature} /></div>)}</div></section>
    <section className="control-danger-zone"><div><h3>{tenant.lifecycleStatus === "active" ? "Suspend tenant" : "Reactivate tenant"}</h3><p>{tenant.lifecycleStatus === "active" ? "Suspension removes access without deleting data." : "Restore access to this tenant and its existing data."}</p></div><form action={setTenantLifecycle}><input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="lifecycle" value={tenant.lifecycleStatus === "active" ? "suspended" : "active"} /><button type="submit" className="control-lifecycle-button">{tenant.lifecycleStatus === "active" ? "Suspend" : "Reactivate"}</button></form></section>
  </aside></div>;
}

export function ControlTenantManager({ tenants, selectedTenantId }: { tenants: ControlTenantRow[]; selectedTenantId?: string }) {
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  return <><section className="control-tenant-list" aria-labelledby="tenant-list-title"><div className="control-list-heading"><div><p>All tenants</p><h2 id="tenant-list-title">Choose a tenant to manage</h2></div><span>{tenants.length} active workspaces</span></div><div className="control-tenant-rows">{tenants.map((tenant) => <a className="control-tenant-row" key={tenant.id} href={`/control?tenant=${encodeURIComponent(tenant.id)}`}><span className="control-tenant-name"><strong>{tenant.name}</strong><small>{tenant.slug}</small></span><span><small>Plan</small><b>{tenant.plan}</b></span><span><small>Status</small><Status>{tenant.lifecycleStatus}</Status></span><span><small>Bookings</small><b>{tenant.bookingCount}</b></span><span><small>Staff</small><b>{tenant.staffCount}</b></span><span className="control-row-arrow" aria-hidden="true">→</span></a>)}</div></section>{selectedTenant ? <TenantDrawer tenant={selectedTenant} /> : null}</>;
}
