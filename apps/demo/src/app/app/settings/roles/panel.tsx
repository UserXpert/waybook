import Link from "next/link";
import { ChevronRight, LockKeyhole, Plus } from "lucide-react";
import { StaffRoleEditor } from "@/components/staff-role-editor";
import { tenantDb, type TenantRecord } from "@/lib/waybook/database";
import type { StaffRole } from "@/lib/waybook/staff-role-fields";

const builtIns = [
  { id: "owner", name: "Owner", description: "Full access to this workspace.", details: ["Manage workspace settings and reusable roles.", "Assign manager and custom roles.", "Manage bookings, staff and business operations."] },
  { id: "manager", name: "Manager", description: "Manage staff and day-to-day operations.", details: ["Manage bookings, clients, resources, and business settings.", "Manage staff profiles and eligible individual permissions.", "Role creation and custom role assignment are reserved for owners."] },
  { id: "staff", name: "Staff", description: "Access depends on the permissions granted to each staff member.", details: ["The Permissions tab on each Staff profile controls their individual access.", "Access can be granted for calendars, clients, reports, and other workspace tasks."] },
  { id: "read-only", name: "Read-only", description: "View access depends on the permissions granted to each staff member.", details: ["View-only permissions can include the team calendar, client records, and reports.", "The workspace blocks changes to bookings, client records, and other protected operations."] },
] as const;

function RoleLink({ href, name, selected, assignedCount }: { href: string; name: string; selected: boolean; assignedCount?: number }) {
  return <li><Link href={href} aria-label={name} aria-description={assignedCount === undefined ? undefined : `${assignedCount} assigned`} aria-current={selected ? "page" : undefined}>
    <span><strong>{name}</strong>{assignedCount !== undefined ? <small>{assignedCount} assigned</small> : null}</span>
    <ChevronRight aria-hidden="true" size={16} />
  </Link></li>;
}

export async function StaffRolesPanel({ tenant, rolesHref, roleKey, creating }: { tenant: TenantRecord; rolesHref: string; roleKey?: string; creating: boolean }) {
  const roles = await tenantDb(tenant)<StaffRole[]>`SELECT sr.id, sr.name, sr.permissions,
    (SELECT count(*)::int FROM team_members tm WHERE tm.tenant_id = sr.tenant_id AND tm.staff_role_id = sr.id) AS "assignedCount"
    FROM staff_roles sr WHERE sr.tenant_id = ${tenant.id} ORDER BY lower(sr.name), sr.id`;
  const selected = creating ? undefined : roles.find(({ id }) => id === roleKey);
  const builtIn = creating || selected ? undefined : builtIns.find(({ id }) => id === roleKey) ?? builtIns[0];
  const detailHref = (id: string) => `${rolesHref}&role=${id}#role-details`;

  return <section className="workspace-settings__panel staff-role-settings" aria-labelledby="workspace-roles-title">
    <header className="staff-role-settings__heading">
      <h2 id="workspace-roles-title">Roles &amp; permissions</h2>
      <Link className="waybook-primary-link" href={`${rolesHref}&new=1#role-details`}><Plus size={16} aria-hidden="true" />Add role</Link>
    </header>
    <div className="staff-role-settings__layout">
      <nav className="staff-role-settings__navigation" aria-label="Workspace roles">
        <h3>Built-in roles</h3>
        <ul className="staff-role-settings__list">{builtIns.map(({ id, name }) => <RoleLink key={id} href={detailHref(id)} name={name} selected={builtIn?.id === id} />)}</ul>
        <h3>Custom roles</h3>
        {roles.length ? <ul className="staff-role-settings__list">{roles.map(({ id, name, assignedCount }) => <RoleLink key={id} href={detailHref(id)} name={name} assignedCount={assignedCount} selected={selected?.id === id} />)}</ul> : <p>No custom roles yet.</p>}
      </nav>
      <section className="staff-role-settings__details" id="role-details" aria-labelledby="role-details-title">
        <h3 id="role-details-title">{creating ? "Add role" : selected ? `Edit ${selected.name}` : builtIn?.name}</h3>
        {builtIn ? <>
          <p className="staff-role-settings__fixed"><LockKeyhole aria-hidden="true" size={15} />Built-in role</p>
          <p>{builtIn.description}</p>
          <ul className="staff-role-settings__summary">{builtIn.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
        </> : <>
          {selected ? <p>{selected.assignedCount} {selected.assignedCount === 1 ? "staff member assigned" : "staff members assigned"}</p> : null}
          <StaffRoleEditor key={selected?.id ?? "new"} role={selected} settingsHref={rolesHref} />
        </>}
      </section>
    </div>
  </section>;
}
