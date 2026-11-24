import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffRoleEditor } from "@/components/staff-role-editor";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import type { StaffRole } from "@/lib/waybook/staff-role-fields";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

const builtIns = [
  ["Owner", "Full workspace access, including roles and staff access."],
  ["Manager", "Workspace operations and staff management."],
  ["Staff", "Access based on the individual staff member’s permissions."],
  ["Read-only", "View access based on the individual staff member’s permissions."],
] as const;

export default async function StaffRolesPage({ searchParams }: { searchParams: Promise<{ role?: string; new?: string }> }) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") notFound();
  await requireFeature(tenant.id, "team");
  const [params, slug, roles] = await Promise.all([
    searchParams,
    currentTenantRouteSlug(tenant.slug),
    tenantDb(tenant)<StaffRole[]>`SELECT sr.id, sr.name, sr.permissions,
      (SELECT count(*)::int FROM team_members tm WHERE tm.tenant_id = sr.tenant_id AND tm.staff_role_id = sr.id) AS "assignedCount"
      FROM staff_roles sr WHERE sr.tenant_id = ${tenant.id} ORDER BY lower(sr.name), sr.id`,
  ]);
  const selected = roles.find(({ id }) => id === params.role);
  const settings = tenantPath(slug, "/app/settings");
  const rolesHref = `${settings}/roles`;

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={slug} tenantName={tenant.name} active="settings" />
    <div className="workspace-settings staff-role-settings">
      <header className="workspace-settings__heading">
        <Link href={settings}>Settings</Link>
        <h1>Roles &amp; permissions</h1>
      </header>
      <div className="workspace-settings__content">
        <section className="workspace-settings__panel">
          <div className="staff-role-settings__heading"><h2>Workspace roles</h2><Link className="waybook-primary-link" href={`${rolesHref}?new=1`}>Add role</Link></div>
          <ul className="staff-role-settings__list">
            {builtIns.map(([name, description]) => <li key={name}><strong>{name}</strong><small>{description}</small></li>)}
            {roles.map(({ id, name, assignedCount }) => <li key={id}>
              <Link href={`${rolesHref}?role=${id}`} aria-current={selected?.id === id ? "page" : undefined}>{name}</Link>
              <small>{assignedCount} assigned</small>
            </li>)}
          </ul>
        </section>
        {selected || params.new === "1" ? <section className="workspace-settings__panel">
          <h2>{selected ? `Edit ${selected.name}` : "Add role"}</h2>
          <StaffRoleEditor key={selected?.id ?? "new"} role={selected} settingsHref={rolesHref} />
        </section> : null}
      </div>
    </div>
  </main>;
}
