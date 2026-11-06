import Link from "next/link";
import { Pencil } from "lucide-react";
import { StaffHoursEditor } from "@/components/staff-hours-editor";
import { StaffAccessMenu } from "@/components/staff-access-menu";
import { StaffTimeOffForm } from "@/components/staff-time-off-form";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { defaultStaffCalendarColor, staffCalendarColors } from "@/lib/waybook/staff-calendar-colors";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext, staffWorkspacePermissionsAvailable } from "@/lib/waybook/staff-permissions";
import { staffLifecycleAvailable } from "@/lib/waybook/staff-lifecycle";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { addStaffTimeOff, deleteStaffTimeOff, saveStaffPermissions, saveTeamMember, updateStaffTimeOff } from "./actions";

type StaffRow = { id: string; name: string; email: string; role: string; isActive: boolean; identityId: string | null; archivedAt: string | null; phone: string | null; jobTitle: string | null; specialty: string | null; workLocation: string | null; staffCode: string | null; internalNotes: string | null; calendarColor: string };
type ServiceRow = { id: string; title: string };
type Location = { id: string; name: string };
type Assignment = { teamMemberId: string; serviceId: string };
type LocationAssignment = { teamMemberId: string; locationId: string };
type Rule = { rrule: string; startTime: string; endTime: string };
type Override = { id: string; localDate: string; startTime: string | null; endTime: string | null; isUnavailable: boolean; reason: string | null };
type StaffPermissions = { canUpdateAppointmentStatus: boolean; canManageOwnAppointments: boolean; canViewTeamCalendar: boolean; canManageTeamAppointments: boolean; canManageOwnTimeOff: boolean; canManageTeamTimeOff: boolean; canManageWaitlist: boolean; canViewClients: boolean; canManageClients: boolean; canAccessReports: boolean; canManageResources: boolean; canManageServiceSettings: boolean };
const tabs = ["details", "hours", "permissions", "services", "time-off"] as const;
type StaffTab = (typeof tabs)[number];

function displayOverride(override: Override) {
  if (!override.startTime || !override.endTime) return override.isUnavailable ? "Unavailable all day" : "Available hours";
  return (override.isUnavailable ? "Unavailable " : "Available ") + override.startTime + "–" + override.endTime;
}

function displayOverrideDate(localDate: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${localDate}T12:00:00Z`));
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ employee?: string; tab?: string; new?: string; editTimeOff?: string }> }) {
  const { employee, tab: requestedTab, new: createNew, editTimeOff } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "team");
  const canManage = ["owner", "manager"].includes(membership.role);
  const signedInPermissions = await staffPermissionContext(tenant, membership);
  if (!canManage && !signedInPermissions.teamMemberId) throw new Error("Your staff profile is unavailable for this workspace.");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const db = tenantDb(tenant);
  const archiveAvailable = await staffLifecycleAvailable(tenant);
  const [members, services, assignments, locations, locationAssignments] = await Promise.all([
    archiveAvailable
      ? db<StaffRow[]>`SELECT tm.id, tm.name, tm.email, tm.role, tm.is_active AS "isActive", tm.identity_id AS "identityId", tm.archived_at::text AS "archivedAt", tm.phone, tm.job_title AS "jobTitle", tm.specialty, tm.work_location AS "workLocation", tm.staff_code AS "staffCode", tm.internal_notes AS "internalNotes", tm.calendar_color AS "calendarColor" FROM team_members tm WHERE tm.tenant_id = ${tenant.id} ${canManage ? db`` : db`AND tm.id = ${signedInPermissions.teamMemberId}`} ORDER BY tm.archived_at NULLS FIRST, tm.is_active DESC, tm.name`
      : db<StaffRow[]>`SELECT tm.id, tm.name, tm.email, tm.role, tm.is_active AS "isActive", tm.identity_id AS "identityId", NULL::text AS "archivedAt", tm.phone, tm.job_title AS "jobTitle", tm.specialty, tm.work_location AS "workLocation", tm.staff_code AS "staffCode", tm.internal_notes AS "internalNotes", tm.calendar_color AS "calendarColor" FROM team_members tm WHERE tm.tenant_id = ${tenant.id} ${canManage ? db`` : db`AND tm.id = ${signedInPermissions.teamMemberId}`} ORDER BY tm.is_active DESC, tm.name`,
    db<ServiceRow[]>`SELECT id, title FROM services WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY title`,
    db<Assignment[]>`SELECT team_member_id AS "teamMemberId", service_id AS "serviceId" FROM service_team_members WHERE tenant_id = ${tenant.id}`,
    db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`,
    db<LocationAssignment[]>`SELECT team_member_id AS "teamMemberId", location_id AS "locationId" FROM team_member_locations WHERE tenant_id = ${tenant.id}`,
  ]);
  const selected = members.find((member) => member.id === employee) ?? members[0] ?? null;
  const tab: StaffTab = requestedTab === "permissions" && !canManage
    ? "details"
    : tabs.includes(requestedTab as StaffTab) ? requestedTab as StaffTab : "details";
  const [rules, overrides, permissionRows, workspacePermissionsAvailable] = selected ? await Promise.all([
    db<Rule[]>`SELECT rrule, start_time AS "startTime", end_time AS "endTime" FROM availability_rules WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} ORDER BY created_at ASC`,
    db<Override[]>`SELECT id, local_date::text AS "localDate", start_time AS "startTime", end_time AS "endTime", is_unavailable AS "isUnavailable", reason FROM availability_overrides WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} ORDER BY local_date DESC LIMIT 30`,
    db<StaffPermissions[]>`SELECT can_update_appointment_status AS "canUpdateAppointmentStatus", can_manage_own_appointments AS "canManageOwnAppointments", can_view_team_calendar AS "canViewTeamCalendar", can_manage_team_appointments AS "canManageTeamAppointments", can_manage_own_time_off AS "canManageOwnTimeOff", can_manage_team_time_off AS "canManageTeamTimeOff", can_manage_waitlist AS "canManageWaitlist" FROM staff_permissions WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} LIMIT 1`,
    staffWorkspacePermissionsAvailable(tenant),
  ]) : [[], [], [], false] as [Rule[], Override[], StaffPermissions[], boolean];
  const permissions = selected && workspacePermissionsAvailable
    ? await db<StaffPermissions[]>`SELECT can_update_appointment_status AS "canUpdateAppointmentStatus", can_manage_own_appointments AS "canManageOwnAppointments", can_view_team_calendar AS "canViewTeamCalendar", can_manage_team_appointments AS "canManageTeamAppointments", can_manage_own_time_off AS "canManageOwnTimeOff", can_manage_team_time_off AS "canManageTeamTimeOff", can_manage_waitlist AS "canManageWaitlist", can_view_clients AS "canViewClients", can_manage_clients AS "canManageClients", can_access_reports AS "canAccessReports", can_manage_resources AS "canManageResources", can_manage_service_settings AS "canManageServiceSettings" FROM staff_permissions WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} LIMIT 1`
    : permissionRows;
  const schedule = rules.flatMap((rule) => (rule.rrule.match(/BYDAY=([^;]+)/)?.[1].split(",") ?? []).map((day) => ({ day, startTime: rule.startTime, endTime: rule.endTime })));
  const selectedServiceIds = new Set(assignments.filter((entry) => entry.teamMemberId === selected?.id).map((entry) => entry.serviceId));
  const selectedLocationIds = new Set(locationAssignments.filter((entry) => entry.teamMemberId === selected?.id).map((entry) => entry.locationId));
  const editingOverride = overrides.find((override) => override.id === editTimeOff) ?? null;
  const basePath = tenantPath(tenantSlug, "/app/team");
  const staffPath = (memberId: string, targetTab = tab) => basePath + "?employee=" + memberId + "&tab=" + targetTab;

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="team" />
    <section className="staff-workspace">
      <aside className="staff-workspace__directory" aria-label="Staff directory">
        <div className="staff-workspace__directory-heading">
          <div><p>PEOPLE</p><h1>Staff</h1></div>
          {canManage ? <Link className="waybook-primary-link" href={basePath + "?new=1"}>Add staff</Link> : null}
        </div>
        <p className="staff-workspace__directory-copy">Select a person to manage their profile, schedule, services, and time off.</p>
        <nav>
          {members.map((member) => <Link key={member.id} href={staffPath(member.id)} aria-current={selected?.id === member.id ? "page" : undefined}>
            <span className="staff-workspace__avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
            <span><strong>{member.name}</strong><small>{member.jobTitle ?? member.role}</small></span>
            <i className={member.isActive ? "is-active" : ""}>{member.isActive ? "Active" : "Inactive"}</i>
          </Link>)}
        </nav>
      </aside>
      <section className="staff-workspace__content">
        {createNew === "1" ? <section className="staff-workspace__panel staff-workspace__new">
          <PanelHeading title="Create a staff profile" text="Save core details first, then add services and a weekly schedule." />
          {canManage ? <ProfileForm member={null} locations={locations} services={services} selectedLocationIds={new Set()} selectedServiceIds={new Set()} canAssignManager={membership.role === "owner"} /> : <p>Read-only access.</p>}
        </section> : null}
        {!createNew && selected ? <>
          <header className="staff-workspace__profile-header">
            <span className="staff-workspace__avatar is-large" aria-hidden="true">{selected.name.slice(0, 1)}</span>
            <div><p>STAFF PROFILE</p><h2>{selected.name}</h2><span>{selected.jobTitle ?? "Staff member"} · {selected.isActive ? "Active and bookable" : "Inactive"}</span></div>
            <StaffAccessMenu memberId={selected.id} name={selected.name} isActive={selected.isActive} hasLogin={Boolean(selected.identityId)} canManage={canManage} isOwner={membership.role === "owner"} isArchived={Boolean(selected.archivedAt)} archiveAvailable={archiveAvailable} />
          </header>
          <nav className="staff-workspace__tabs" aria-label="Staff profile sections">
            {([{ id: "details", label: "Details" }, { id: "hours", label: "Work hours" }, ...(canManage ? [{ id: "permissions" as const, label: "Permissions" }] : []), { id: "services", label: "Services & locations" }, { id: "time-off", label: "Time off" }] as const).map((item) => <Link key={item.id} href={staffPath(selected.id, item.id)} aria-current={tab === item.id ? "page" : undefined}>{item.label}</Link>)}
          </nav>
          {tab === "details" ? <section className="staff-workspace__panel">
            <PanelHeading title="Details" text="Contact and profile information used inside your workspace." />
            {canManage ? <ProfileForm member={selected} locations={locations} services={services} selectedLocationIds={selectedLocationIds} selectedServiceIds={selectedServiceIds} compact includeAssignments={false} canAssignManager={membership.role === "owner"} /> : <ProfileFacts member={selected} />}
          </section> : null}
          {tab === "hours" ? <section className="staff-workspace__panel staff-workspace__panel--wide">
            <PanelHeading title="Working hours" text="A clear weekly schedule for when this person can be offered to customers." />
            {canManage ? <StaffHoursEditor memberId={selected.id} initialSchedule={schedule} /> : <p>Read-only access.</p>}
          </section> : null}
          {tab === "permissions" && canManage ? <section className="staff-workspace__panel staff-workspace__panel--permissions">
            <PanelHeading title="Permissions" text="Set the calendar and waitlist tasks this staff member may perform when they sign in." />
            <StaffPermissionsForm memberId={selected.id} initial={permissions[0]} workspacePermissionsAvailable={workspacePermissionsAvailable} />
          </section> : null}
          {tab === "services" ? <section className="staff-workspace__panel">
            <PanelHeading title="Services & locations" text="Control where this person can be booked and what they can deliver." />
            {canManage ? <ProfileForm member={selected} locations={locations} services={services} selectedLocationIds={selectedLocationIds} selectedServiceIds={selectedServiceIds} assignmentsOnly canAssignManager={membership.role === "owner"} /> : <ProfileFacts member={selected} />}
          </section> : null}
          {tab === "time-off" ? <section className="staff-workspace__panel">
            <PanelHeading title="Time off" text="Block one day, a date range, or specific hours for leave, breaks, meetings, or other time off." />
            {canManage ? <>{editingOverride ? <div className="staff-timeoff-form__editing"><div><b>Editing time off</b><span>Update this one-day exception, then save or remove it.</span></div><Link href={staffPath(selected.id, "time-off")}>Cancel</Link></div> : null}<StaffTimeOffForm memberId={selected.id} timezone={tenant.timezone} action={editingOverride ? updateStaffTimeOff : addStaffTimeOff} deleteAction={editingOverride ? deleteStaffTimeOff : undefined} initial={editingOverride ? { id: editingOverride.id, localDate: editingOverride.localDate, startTime: editingOverride.startTime, endTime: editingOverride.endTime, reason: editingOverride.reason } : undefined} /></> : null}
            <div className="staff-exception-list">{overrides.map((override) => <Link className="staff-exception-list__row" key={override.id} href={staffPath(selected.id, "time-off") + "&editTimeOff=" + override.id}><div><strong>{displayOverrideDate(override.localDate)}</strong><span>{displayOverride(override)}</span><small>{override.reason ?? "No reason provided"}</small></div><Pencil aria-hidden="true" /></Link>)}{overrides.length === 0 ? <p>No time off recorded yet.</p> : null}</div>
          </section> : null}
        </> : null}
        {!createNew && !selected ? <section className="staff-workspace__empty"><h2>No staff yet</h2><p>Add the first person to begin setting availability.</p></section> : null}
      </section>
    </section>
  </main>;
}

function PanelHeading({ title, text }: { title: string; text: string }) {
  return <div className="staff-workspace__panel-heading"><div><h3>{title}</h3><p>{text}</p></div></div>;
}

function ProfileFacts({ member }: { member: StaffRow }) {
  return <dl className="staff-profile-facts"><div><dt>Email</dt><dd>{member.email}</dd></div><div><dt>Phone</dt><dd>{member.phone ?? "—"}</dd></div><div><dt>Role</dt><dd>{member.role}</dd></div><div><dt>Login</dt><dd>{member.identityId ? "Enabled" : "Not created"}</dd></div><div><dt>Specialty</dt><dd>{member.specialty ?? "—"}</dd></div></dl>;
}

const permissionSections = [{
  title: "Calendar",
  items: [
    ["canUpdateAppointmentStatus", "Can change appointment status", "Confirm, check in, complete, or mark no-shows. Cancellation remains a manager action."],
    ["canManageOwnAppointments", "Can book and change own appointments", "Create, move, and cancel appointments assigned to their own calendar."],
    ["canViewTeamCalendar", "Can view other people’s calendar", "View-only access to colleagues’ schedules."],
    ["canManageTeamAppointments", "Can book and change other people’s appointments", "Create, move, and cancel appointments assigned to other staff members."],
    ["canManageOwnTimeOff", "Can manage own time off", "Add, change, and remove time off on their own schedule."],
    ["canManageTeamTimeOff", "Can manage other people’s time off", "Add, change, and remove time off for other staff members."],
  ],
}, {
  title: "Operations",
  items: [["canManageWaitlist", "Can manage waitlist", "Add, change, and progress waitlist entries."]],
}, {
  title: "Clients",
  items: [
    ["canViewClients", "Can access clients", "View client records and contact details."],
    ["canManageClients", "Can create and change clients", "Add and update client records. Deleting, merging, and account balances are not available in Waybook yet."],
  ],
}, {
  title: "Reports",
  items: [["canAccessReports", "Can access business reports", "View business performance and booking health reports."]],
}, {
  title: "Resources",
  items: [["canManageResources", "Can manage resources", "Create and change rooms and equipment used for bookings."]],
}, {
  title: "Setup & management",
  items: [["canManageServiceSettings", "Can manage service settings", "Create and change services, locations, and their booking settings."]],
}] as const;

function StaffPermissionsForm({ memberId, initial, workspacePermissionsAvailable }: { memberId: string; initial: StaffPermissions | undefined; workspacePermissionsAvailable: boolean }) {
  return <form action={saveStaffPermissions} className="staff-permissions-form">
    <input type="hidden" name="memberId" value={memberId} />
    {permissionSections.filter((section) => workspacePermissionsAvailable || section.title === "Calendar" || section.title === "Operations").map((section) => <fieldset key={section.title}>
      <legend>{section.title}</legend>
      {section.items.map(([key, title, description]) => <label key={key} className="staff-permission-toggle">
        <input type="checkbox" role="switch" name={key} defaultChecked={initial?.[key] ?? false} />
        <span aria-hidden="true" />
        <span><b>{title}</b><small>{description}</small></span>
      </label>)}
    </fieldset>)}
    <button type="submit">Save permissions</button>
  </form>;
}

function ProfileForm({ member, locations, services, selectedLocationIds, selectedServiceIds, compact = false, assignmentsOnly = false, includeAssignments = true, canAssignManager }: { member: StaffRow | null; locations: Location[]; services: ServiceRow[]; selectedLocationIds: Set<string>; selectedServiceIds: Set<string>; compact?: boolean; assignmentsOnly?: boolean; includeAssignments?: boolean; canAssignManager: boolean }) {
  // A new bookable person starts enabled for the workspace's active services
  // and locations. Managers can narrow this deliberately on the same form.
  const effectiveLocationIds = member
    ? selectedLocationIds
    : new Set(locations.map((location) => location.id));
  const effectiveServiceIds = member
    ? selectedServiceIds
    : new Set(services.map((service) => service.id));
  return <form action={saveTeamMember} className="staff-profile-form">
    <input type="hidden" name="memberId" value={member?.id ?? ""} />
    {!assignmentsOnly ? <><div className="staff-profile-form__grid">
      <label>Name<input name="name" defaultValue={member?.name ?? ""} required /></label><label>Email<input name="email" type="email" defaultValue={member?.email ?? ""} required /></label>
      <label>Phone<input name="phone" type="tel" defaultValue={member?.phone ?? ""} /></label><label>Role<select name="role" defaultValue={member?.role ?? "staff"} disabled={!canAssignManager && member?.role === "manager"}>{!canAssignManager && member?.role === "manager" ? <option value="manager">Manager</option> : null}<option value="staff">Staff</option>{canAssignManager ? <option value="manager">Manager</option> : null}<option value="read-only">Read-only</option></select></label><fieldset className="staff-calendar-colour"><legend>Calendar colour</legend><div className="staff-calendar-colour__swatches">{staffCalendarColors.map((color) => <label key={color.value} title={color.label}><input type="radio" name="calendarColor" value={color.value} aria-label={color.label} defaultChecked={(member?.calendarColor ?? defaultStaffCalendarColor) === color.value} /><span style={{ backgroundColor: color.value }} aria-hidden="true" /></label>)}</div><small>Used for this person’s booking cards.</small></fieldset>
      {!compact ? <><label>Staff code<input name="staffCode" defaultValue={member?.staffCode ?? ""} /></label><label>Job title<input name="jobTitle" defaultValue={member?.jobTitle ?? ""} /></label><label>Specialty<input name="specialty" defaultValue={member?.specialty ?? ""} /></label><label>Work location<input name="workLocation" defaultValue={member?.workLocation ?? ""} /></label></> : null}
    </div><label>Internal notes<textarea name="internalNotes" rows={3} defaultValue={member?.internalNotes ?? ""} placeholder="Private operational notes — never customer-facing." /></label><label className="staff-status-toggle"><input type="checkbox" role="switch" name="isActive" defaultChecked={member?.isActive ?? true} /><span aria-hidden="true" /><b>Active and eligible for booking</b></label></> : null}
    {!includeAssignments ? <><>{Array.from(effectiveLocationIds).map((locationId) => <input key={locationId} type="hidden" name="locationIds" value={locationId} />)}</><>{Array.from(effectiveServiceIds).map((serviceId) => <input key={serviceId} type="hidden" name="serviceIds" value={serviceId} />)}</></> : null}
    {includeAssignments ? <><fieldset><legend>Locations this person can serve</legend>{locations.map((location) => <label className="staff-multi-toggle" key={location.id}><input type="checkbox" role="switch" name="locationIds" value={location.id} defaultChecked={effectiveLocationIds.has(location.id)} /><span aria-hidden="true" /><b>{location.name}</b></label>)}</fieldset>
    <fieldset><legend>Services this person can deliver</legend>{services.map((service) => <label className="staff-multi-toggle" key={service.id}><input type="checkbox" role="switch" name="serviceIds" value={service.id} defaultChecked={effectiveServiceIds.has(service.id)} /><span aria-hidden="true" /><b>{service.title}</b></label>)}</fieldset></> : null}
    <button type="submit">{member ? assignmentsOnly ? "Save services & locations" : "Save staff details" : "Create staff member"}</button>
  </form>;
}
