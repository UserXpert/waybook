import { notFound } from "next/navigation";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { StaffRolePicker } from "@/components/staff-role-picker";
import { staffPermissionSections, type StaffRoleOption } from "@/lib/waybook/staff-role-fields";
import { canConfigureStaffPermission } from "@/lib/waybook/read-only-permissions";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { canEditStaffPhoto } from "@/lib/waybook/staff-photo-permissions";
import { StaffPhotoUpload } from "@/components/staff-photo-upload";
import { StaffHoursEditor } from "@/components/staff-hours-editor";
import { StaffAccessMenu } from "@/components/staff-access-menu";
import { StaffDetailsForm } from "@/components/staff-details-form";
import { StaffTimeOffForm } from "@/components/staff-time-off-form";
import { AsyncMultiSelect } from "@/components/async-multi-select";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { currentIdentity } from "@/lib/waybook/auth";
import { googleSignInAvailable } from "@/lib/waybook/google-auth";
import { controlDb, tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { staffCalendarColors } from "@/lib/waybook/staff-calendar-colors";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { canManageTimeOff, staffPermissionContext, staffWorkspacePermissionsAvailable } from "@/lib/waybook/staff-permissions";
import { staffLifecycleAvailable } from "@/lib/waybook/staff-lifecycle";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { addStaffTimeOff, deleteStaffTimeOff, saveStaffPermissions, saveStaffPhoto, saveOwnerProfileDetails, saveTeamMember, updateStaffTimeOff } from "./actions";

type StaffRow = { id: string; name: string; email: string; role: string; staffRoleId: string | null; staffRoleName: string | null; isActive: boolean; identityId: string | null; archivedAt: string | null; phone: string | null; jobTitle: string | null; specialty: string | null; workLocation: string | null; staffCode: string | null; calendarColor: string; photoDataUrl: string | null };
type Selection = { id: string; name: string };
type Rule = { rrule: string; startTime: string; endTime: string };
type Override = { id: string; localDate: string; startTime: string | null; endTime: string | null; isUnavailable: boolean };
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

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ employee?: string; tab?: string; new?: string; editTimeOff?: string; q?: string; after?: string }> }) {
  const { employee, tab: requestedTab, new: createNew, editTimeOff, q, after } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "team");
  const canManage = ["owner", "manager"].includes(membership.role);
  const [signedInPermissions, terms] = await Promise.all([staffPermissionContext(tenant, membership), getTenantTerminology(tenant)]);
  if (!canManage && !signedInPermissions.teamMemberId) notFound();
  const canSelectTeamTimeOff = !canManage && signedInPermissions.canManageTeamTimeOff
    && requestedTab === "time-off" && !createNew;
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const db = tenantDb(tenant);
  const archiveAvailable = await staffLifecycleAvailable(tenant);
  const [photoColumn] = await db<{ available: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'team_members' AND column_name = 'photo_data_url') AS available`;
  const photosAvailable = photoColumn?.available ?? false;
  const search = (q ?? "").trim().slice(0, 100);
  const rawCursor = (after ?? "").trim();
  const staffIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const cursor = staffIdPattern.test(rawCursor) ? rawCursor : null;
  const archiveSelect = archiveAvailable ? "tm.archived_at::text AS \"archivedAt\"" : "NULL::text AS \"archivedAt\"";
  const directoryKey = (alias: "tm" | "boundary") => [
    ...(archiveAvailable ? [`${alias}.archived_at IS NOT NULL`, `COALESCE(${alias}.archived_at, '-infinity'::timestamptz)`] : []),
    `NOT ${alias}.is_active`, `${alias}.name`, `${alias}.id`,
  ].join(", ");
  const photoSelect = photosAvailable ? 'tm.photo_data_url' : 'NULL::text';
  const staffColumns = `SELECT tm.id,tm.name,tm.email,tm.role,tm.staff_role_id AS \"staffRoleId\",sr.name AS \"staffRoleName\",tm.is_active AS \"isActive\",tm.identity_id AS \"identityId\",${archiveSelect},tm.phone,tm.job_title AS \"jobTitle\",tm.specialty,tm.work_location AS \"workLocation\",tm.staff_code AS \"staffCode\",tm.calendar_color AS \"calendarColor\",${photoSelect} AS \"photoDataUrl\" FROM team_members tm LEFT JOIN staff_roles sr ON sr.tenant_id = tm.tenant_id AND sr.id = tm.staff_role_id`;
  const staffDirectorySql = staffColumns + ` WHERE tm.tenant_id=$1 AND ($2::uuid IS NULL OR tm.id=$2::uuid)
    AND ($3='' OR tm.name ILIKE $4 OR ($7::boolean AND tm.email ILIKE $4))
    AND COALESCE((${directoryKey("tm")}) > (
      SELECT ${directoryKey("boundary")} FROM team_members boundary WHERE boundary.tenant_id=$1 AND boundary.id=$5::uuid
    ), TRUE)
    AND (NOT $6::boolean OR tm.is_active)
    ORDER BY ${directoryKey("tm")} LIMIT 51`;
  const memberRows = await db.unsafe<StaffRow[]>(staffDirectorySql, [
    tenant.id, canManage || canSelectTeamTimeOff ? null : signedInPermissions.teamMemberId, search, `%${search}%`, cursor, canSelectTeamTimeOff, !canSelectTeamTimeOff,
  ]);
  const hasMoreMembers = memberRows.length > 50;
  const members = memberRows.slice(0, 50);
  const selectedFromDirectory = members.find((member) => member.id === employee);
  const selectedOutsideDirectory = !selectedFromDirectory && employee && staffIdPattern.test(employee) && (canManage || canSelectTeamTimeOff)
    ? (await db.unsafe<StaffRow[]>(staffColumns + " WHERE tm.tenant_id=$1 AND tm.id=$2::uuid AND (NOT $3::boolean OR tm.is_active)", [tenant.id, employee, canSelectTeamTimeOff])).at(0)
    : undefined;
  const preferredDefault = canSelectTeamTimeOff && employee ? members.find((member) => member.id === signedInPermissions.teamMemberId) : members.at(0);
  const selected = selectedFromDirectory ?? selectedOutsideDirectory ?? preferredDefault;
  const timeOffOnly = canSelectTeamTimeOff && selected?.id !== signedInPermissions.teamMemberId;
  const canEditTimeOff = Boolean(selected && canManageTimeOff(signedInPermissions, selected.id));
  const [selectedServices, selectedLocations] = selected ? await Promise.all([
    db<Selection[]>`SELECT s.id,s.title AS name FROM service_team_members stm JOIN services s ON s.id=stm.service_id AND s.tenant_id=stm.tenant_id WHERE stm.tenant_id=${tenant.id} AND stm.team_member_id=${selected.id} ORDER BY s.title`,
    db<Selection[]>`SELECT l.id,l.name FROM team_member_locations tml JOIN locations l ON l.id=tml.location_id AND l.tenant_id=tml.tenant_id WHERE tml.tenant_id=${tenant.id} AND tml.team_member_id=${selected.id} ORDER BY l.name`,
  ]) : [[], []] as [Selection[], Selection[]];
  const tab: StaffTab = requestedTab === "permissions" && !canManage
    ? "details"
    : tabs.includes(requestedTab as StaffTab) ? requestedTab as StaffTab : "details";
  const creatingStaff = createNew === "1";
  const showProfileOptions = canManage && (creatingStaff || (!createNew && selected && tab === "details"));
  const [colourAvailability] = showProfileOptions
    ? await db<{ nextAvailable: string; occupied: string[] }[]>`
        SELECT staff_next_calendar_color(${tenant.id}) AS "nextAvailable",
          ARRAY(SELECT calendar_color FROM team_members
            WHERE tenant_id = ${tenant.id} AND id IS DISTINCT FROM ${creatingStaff ? null : selected?.id ?? null}::uuid
            AND calendar_color = ANY(${staffCalendarColors.map(({ value }) => value)})) AS occupied
      `
    : [];
  const calendarColours = colourAvailability ? {
    ...colourAvailability, selected: creatingStaff ? colourAvailability.nextAvailable : selected?.calendarColor ?? colourAvailability.nextAvailable,
  } : undefined;
  const customRoles = showProfileOptions
    ? await db<StaffRoleOption[]>`SELECT id, name FROM staff_roles WHERE tenant_id = ${tenant.id} ORDER BY lower(name), id`
    : [];
  const [rules, overrides, permissionRows, workspacePermissionsAvailable] = selected ? await Promise.all([
    db<Rule[]>`SELECT rrule, start_time AS "startTime", end_time AS "endTime" FROM availability_rules WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} ORDER BY created_at ASC`,
    db<Override[]>`SELECT id, local_date::text AS "localDate", start_time AS "startTime", end_time AS "endTime", is_unavailable AS "isUnavailable" FROM availability_overrides WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} ORDER BY local_date DESC LIMIT 30`,
    db<StaffPermissions[]>`SELECT can_update_appointment_status AS "canUpdateAppointmentStatus", can_manage_own_appointments AS "canManageOwnAppointments", can_view_team_calendar AS "canViewTeamCalendar", can_manage_team_appointments AS "canManageTeamAppointments", can_manage_own_time_off AS "canManageOwnTimeOff", can_manage_team_time_off AS "canManageTeamTimeOff", can_manage_waitlist AS "canManageWaitlist" FROM staff_permissions WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} LIMIT 1`,
    staffWorkspacePermissionsAvailable(tenant),
  ]) : [[], [], [], false] as [Rule[], Override[], StaffPermissions[], boolean];
  const permissions = selected && workspacePermissionsAvailable
    ? await db<StaffPermissions[]>`SELECT can_update_appointment_status AS "canUpdateAppointmentStatus", can_manage_own_appointments AS "canManageOwnAppointments", can_view_team_calendar AS "canViewTeamCalendar", can_manage_team_appointments AS "canManageTeamAppointments", can_manage_own_time_off AS "canManageOwnTimeOff", can_manage_team_time_off AS "canManageTeamTimeOff", can_manage_waitlist AS "canManageWaitlist", can_view_clients AS "canViewClients", can_manage_clients AS "canManageClients", can_access_reports AS "canAccessReports", can_manage_resources AS "canManageResources", can_manage_service_settings AS "canManageServiceSettings" FROM staff_permissions WHERE tenant_id = ${tenant.id} AND team_member_id = ${selected.id} LIMIT 1`
    : permissionRows;
  const schedule = rules.flatMap((rule) => (rule.rrule.match(/BYDAY=([^;]+)/)?.[1].split(",") ?? []).map((day) => ({ day, startTime: rule.startTime, endTime: rule.endTime })));
  const editingOverride = canEditTimeOff ? overrides.find((override) => override.id === editTimeOff) ?? null : null;
  const basePath = tenantPath(tenantSlug, "/app/team");
  const staffPath = (memberId: string, targetTab = tab) => basePath + "?employee=" + memberId + "&tab=" + targetTab;
  const moreStaffHref = basePath + "?" + new URLSearchParams({ ...(search ? { q: search } : {}), ...(canSelectTeamTimeOff ? { tab: "time-off" } : {}), after: members.at(-1)?.id ?? "" }).toString();

  const [passwordAccess] = selected?.identityId && membership.role === "owner" ? await controlDb<{ available: boolean }[]>`
    SELECT i.password_hash <> '' AND NOT i.is_platform_admin
      AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.identity_id = i.id AND m.tenant_id <> ${tenant.id}) AS available
    FROM identities i WHERE i.id = ${selected.identityId}
  ` : [];

  const isOwnOwnerProfile = selected?.role === "owner" && membership.role === "owner"
    && selected.identityId === (await currentIdentity())?.id;
  const canEditSelectedPermissions = selected?.role !== "owner" &&
    (selected?.role !== "manager" || membership.role === "owner");
  const canInviteWithGoogle = Boolean(selected?.isActive && !selected.archivedAt && membership.role === "owner"
    && (selected.role !== "owner" || isOwnOwnerProfile)
    && await googleSignInAvailable());

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="team" />
    <section className="staff-workspace">
      <aside className="staff-workspace__directory" aria-label={`${titleTerminology(terms.staff)} directory`}>
        <div className="staff-workspace__directory-heading">
          <div><p>PEOPLE</p><h1>{titleTerminology(terms.staffPlural)}</h1></div>
          {canManage ? <Link className="waybook-primary-link" href={basePath + "?new=1"}>Add {terms.staff}</Link> : null}
        </div>
        <p className="staff-workspace__directory-copy">{canSelectTeamTimeOff ? "Select a person to manage their time off." : canManage ? "Select a person to manage their profile, schedule, services, and time off." : "View your profile and schedule."}</p>
        {canManage || canSelectTeamTimeOff ? <form method="get" className="waybook-list-filter">{canSelectTeamTimeOff ? <input type="hidden" name="tab" value="time-off" /> : null}<label>Search {terms.staffPlural}<input name="q" type="search" defaultValue={search} placeholder={canSelectTeamTimeOff ? "Name" : "Name or email"} /></label><button type="submit">Search</button></form> : null}
        <nav>
          {members.map((member) => <Link key={member.id} href={staffPath(member.id)} aria-current={selected?.id === member.id ? "page" : undefined}>
            <span className="staff-workspace__avatar" aria-hidden="true">{member.photoDataUrl && (!canSelectTeamTimeOff || member.id === signedInPermissions.teamMemberId) ? <img src={member.photoDataUrl} alt="" /> : member.name.slice(0, 1)}</span>
            <span><strong>{member.name}</strong>{!canSelectTeamTimeOff || member.id === signedInPermissions.teamMemberId ? <small>{member.jobTitle ?? member.staffRoleName ?? (member.role === "staff" ? terms.staff : member.role)}</small> : null}</span>
            <i className={member.isActive ? "is-active" : ""}>{member.isActive ? "Active" : "Inactive"}</i>
          </Link>)}
        </nav>
        {hasMoreMembers ? <Link className="waybook-secondary-link" href={moreStaffHref}>Load more {terms.staffPlural}</Link> : null}
      </aside>
      <section className="staff-workspace__content">
        {createNew === "1" ? <section className="staff-workspace__panel staff-workspace__new">
          <PanelHeading title={`Create a ${terms.staff} profile`} text="Save core details first, then add services and a weekly schedule." />
          {canManage ? <ProfileForm terms={terms} calendarColours={calendarColours} customRoles={customRoles} member={null} selectedLocations={[]} selectedServices={[]} canAssignManager={membership.role === "owner"} /> : <p>Read-only access.</p>}
        </section> : null}
        {!createNew && selected ? <>
          <header key={selected.id} className="staff-workspace__profile-header">
            {photosAvailable && canEditStaffPhoto(membership.role, signedInPermissions.teamMemberId, selected.id) ? <StaffPhotoUpload memberId={selected.id} name={selected.name} photoDataUrl={selected.photoDataUrl} action={saveStaffPhoto} /> : <span className="staff-workspace__avatar is-large" aria-hidden="true">{selected.photoDataUrl && !timeOffOnly ? <img src={selected.photoDataUrl} alt="" /> : selected.name.slice(0, 1)}</span>}
            <div className="staff-workspace__profile-title"><p>{timeOffOnly ? "STAFF TIME OFF" : `${terms.staff.toUpperCase()} PROFILE`}</p><h2>{selected.name}</h2>{!timeOffOnly ? <span>{selected.jobTitle ?? titleTerminology(terms.staffMember)} · {selected.isActive ? "Active and bookable" : "Inactive"}</span> : null}</div>
            {canManage ? <StaffAccessMenu memberId={selected.id} name={selected.name} isActive={selected.isActive} hasLogin={Boolean(selected.identityId)} canManage={canManage} isOwner={membership.role === "owner"} isArchived={Boolean(selected.archivedAt)} archiveAvailable={archiveAvailable} canInviteWithGoogle={canInviteWithGoogle} canManagePassword={!selected.identityId || passwordAccess?.available === true} /> : null}
          </header>
          <nav className="staff-workspace__tabs" aria-label={`${titleTerminology(terms.staff)} profile sections`}>
            {timeOffOnly && signedInPermissions.teamMemberId ? <Link href={staffPath(signedInPermissions.teamMemberId, "details")}>Your profile</Link> : null}
            {([{ id: "details", label: "Details" }, { id: "hours", label: "Work hours" }, ...(canManage ? [{ id: "permissions" as const, label: "Permissions" }] : []), { id: "services", label: "Services & locations" }, { id: "time-off", label: "Time off" }] as const)
              .filter((item) => !timeOffOnly || item.id === "time-off")
              .map((item) => <Link key={item.id} href={staffPath(selected.id, item.id)} aria-current={tab === item.id ? "page" : undefined}>{item.label}</Link>)}
          </nav>
          {tab === "details" ? <section className="staff-workspace__panel">
            <PanelHeading title="Details" text="Contact and profile information used inside your workspace." />
            {(canManage && canEditSelectedPermissions) || (isOwnOwnerProfile && selected.isActive)
              ? <ProfileForm terms={terms} calendarColours={calendarColours} customRoles={customRoles} key={selected.id} member={selected} selectedLocations={selectedLocations} selectedServices={selectedServices} includeAssignments={false} canAssignManager={membership.role === "owner"} ownOwner={isOwnOwnerProfile} />
              : <ProfileFacts terms={terms} member={selected} />}
          </section> : null}
          {tab === "hours" ? <section className="staff-workspace__panel staff-workspace__panel--wide">
            <PanelHeading title="Working hours" text="A clear weekly schedule for when this person can be offered to customers." />
            {canManage ? <StaffHoursEditor key={selected.id} memberId={selected.id} initialSchedule={schedule} /> : <p>Read-only access.</p>}
          </section> : null}
          {tab === "permissions" && canManage ? <section className="staff-workspace__panel staff-workspace__panel--permissions">
            <PanelHeading title="Permissions" text={selected.role === "owner" ? "Workspace owners have full access." : selected.staffRoleId ? "Shared role permissions apply to this profile." : canEditSelectedPermissions ? "Choose what this person can do in the workspace." : "Only a workspace owner can change manager permissions."} />
            {canEditSelectedPermissions && !selected.staffRoleId ? <StaffPermissionsForm key={selected.id} memberId={selected.id} role={selected.role} initial={permissions[0]} workspacePermissionsAvailable={workspacePermissionsAvailable} /> : null}
            {selected.staffRoleId ? <p>
              Access follows the {selected.staffRoleName} role. {membership.role === "owner" ? <Link href={tenantPath(tenantSlug, `/app/settings?tab=roles&role=${selected.staffRoleId}`)}>Manage role permissions</Link> : null}
            </p> : null}
          </section> : null}
          {tab === "services" ? <section className="staff-workspace__panel">
            <PanelHeading title="Services & locations" text="Control where this person can be booked and what they can deliver." />
            {canManage ? <ProfileForm terms={terms} key={selected.id} member={selected} selectedLocations={selectedLocations} selectedServices={selectedServices} assignmentsOnly canAssignManager={membership.role === "owner"} /> : <ProfileFacts terms={terms} member={selected} />}
          </section> : null}
          {tab === "time-off" ? <section className="staff-workspace__panel">
            <PanelHeading title="Time off" text="Block one day, a date range, or specific hours for leave, breaks, meetings, or other time off." />
            {canEditTimeOff ? <>{editingOverride ? <div className="staff-timeoff-form__editing"><div><b>Editing time off</b><span>Update this one-day exception, then save or remove it.</span></div><Link href={staffPath(selected.id, "time-off")}>Cancel</Link></div> : null}<StaffTimeOffForm key={`${selected.id}:${editingOverride?.id ?? "new"}`} memberId={selected.id} timezone={tenant.timezone} action={editingOverride ? updateStaffTimeOff : addStaffTimeOff} deleteAction={editingOverride ? deleteStaffTimeOff : undefined} initial={editingOverride ? { id: editingOverride.id, localDate: editingOverride.localDate, startTime: editingOverride.startTime, endTime: editingOverride.endTime } : undefined} /></> : null}
            <div className="staff-exception-list">{overrides.map((override) => {
              const summary = <div><strong>{displayOverrideDate(override.localDate)}</strong><span>{displayOverride(override)}</span></div>;
              return canEditTimeOff
                ? <Link className="staff-exception-list__row" key={override.id} href={staffPath(selected.id, "time-off") + "&editTimeOff=" + override.id}>{summary}<Pencil aria-hidden="true" /></Link>
                : <div className="staff-exception-list__row" key={override.id}>{summary}</div>;
            })}{overrides.length === 0 ? <p>No time off recorded yet.</p> : null}</div>
          </section> : null}
        </> : null}
        {!createNew && !selected ? <section className="staff-workspace__empty"><h2>{search ? `No matching ${terms.staffPlural}` : `No ${terms.staffPlural} yet`}</h2><p>{search ? "Try a different name or email." : "Add the first person to begin setting availability."}</p></section> : null}
      </section>
    </section>
  </main>;
}

function PanelHeading({ title, text }: { title: string; text: string }) {
  return <div className="staff-workspace__panel-heading"><div><h3>{title}</h3><p>{text}</p></div></div>;
}

function ProfileFacts({ terms, member }: { terms: Awaited<ReturnType<typeof getTenantTerminology>>; member: StaffRow }) {
  return <dl className="staff-profile-facts"><div><dt>Email</dt><dd>{member.email}</dd></div><div><dt>Phone</dt><dd>{member.phone ?? "—"}</dd></div><div><dt>Role</dt><dd>{member.staffRoleName ?? (member.role === "staff" ? terms.staff : member.role)}</dd></div><div><dt>Login</dt><dd>{member.identityId ? "Enabled" : "Not created"}</dd></div><div><dt>Specialty</dt><dd>{member.specialty ?? "—"}</dd></div></dl>;
}

function StaffPermissionsForm({ memberId, role, initial, workspacePermissionsAvailable }: { memberId: string; role: string; initial: StaffPermissions | undefined; workspacePermissionsAvailable: boolean }) {
  const sections = staffPermissionSections.flatMap(({ title, items }) => {
    if (!workspacePermissionsAvailable && title !== "Calendar" && title !== "Operations") return [];
    const applicable = items.filter(([key]) => canConfigureStaffPermission(role, key));
    return applicable.length ? [{ title, items: applicable }] : [];
  });
  return <form action={saveStaffPermissions} className="staff-permissions-form">
    <input type="hidden" name="memberId" value={memberId} />
    {sections.map((section) => <fieldset key={section.title}>
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

function CalendarColourField({ selected, occupied, nextAvailable }: { selected: string; occupied: string[]; nextAvailable: string }) {
  const options: { value: string; label: string }[] = [...staffCalendarColors];
  if (!options.some(({ value }) => value === selected)) {
    options.push({ value: selected, label: `Additional colour (${selected})` });
  }
  if (nextAvailable !== selected && !options.some(({ value }) => value !== selected && !occupied.includes(value))) {
    options.push({ value: nextAvailable, label: `Additional colour (${nextAvailable})` });
  }

  return <fieldset className="staff-calendar-colour">
    <legend>Calendar colour</legend>
    <div className="staff-calendar-colour__swatches">
      {options.map(({ value, label }) => {
        const taken = occupied.includes(value);
        const name = taken ? `${label} (in use)` : label;
        return <label key={value} title={name}>
          <input type="radio" name="calendarColor" value={value} aria-label={name} disabled={taken} defaultChecked={selected === value} />
          <span style={{ backgroundColor: value }} aria-hidden="true" />
        </label>;
      })}
    </div>
    <small>Used for this person’s booking cards.</small>
  </fieldset>;
}

function ProfileForm({ terms, calendarColours, customRoles = [], member, selectedLocations, selectedServices, assignmentsOnly = false, includeAssignments = true, canAssignManager, ownOwner = false }: { terms: Awaited<ReturnType<typeof getTenantTerminology>>; calendarColours?: { selected: string; occupied: string[]; nextAvailable: string }; customRoles?: StaffRoleOption[]; member: StaffRow | null; selectedLocations: Selection[]; selectedServices: Selection[]; assignmentsOnly?: boolean; includeAssignments?: boolean; canAssignManager: boolean; ownOwner?: boolean }) {
  const saveLabel = member ? assignmentsOnly ? "Save services & locations" : `Save ${terms.staff} details` : `Create ${terms.staffMember}`;
  const fields = <>
    <input type="hidden" name="memberId" value={member?.id ?? ""} />
    {assignmentsOnly ? <input type="hidden" name="editMode" value="assignments" /> : <><div className="staff-profile-form__grid">
      <label>Name<input name="name" defaultValue={member?.name ?? ""} maxLength={160} required /></label>
      <label>Email<input name="email" type="email" defaultValue={member?.email ?? ""} maxLength={254} required /></label>
      <label>Phone<input name="phone" type="tel" defaultValue={member?.phone ?? ""} maxLength={80} /></label>
      <StaffRolePicker
        initialRole={member?.staffRoleId ? `custom:${member.staffRoleId}` : member?.role ?? "staff"}
        customRoles={customRoles}
        isOwner={canAssignManager}
        staffLabel={titleTerminology(terms.staff)}
      />
      {calendarColours ? <CalendarColourField {...calendarColours} /> : null}
      <label>{titleTerminology(terms.staff)} code<input name="staffCode" defaultValue={member?.staffCode ?? ""} maxLength={80} /></label><label>Job title<input name="jobTitle" defaultValue={member?.jobTitle ?? ""} maxLength={120} /></label><label>Specialty<input name="specialty" defaultValue={member?.specialty ?? ""} maxLength={160} /></label><label>Work location<input name="workLocation" defaultValue={member?.workLocation ?? ""} maxLength={160} /></label>
    </div><label className="staff-status-toggle"><input type="checkbox" role="switch" name="isActive" defaultChecked={member?.isActive ?? true} disabled={ownOwner} /><span aria-hidden="true" /><b>Active and eligible for booking</b></label></>}
    {includeAssignments ? member ? <><AsyncMultiSelect name="locationIds" label="Locations this person can serve" endpoint="/api/app/locations" initial={selectedLocations} /><AsyncMultiSelect name="serviceIds" label="Services this person can deliver" endpoint="/api/app/services" initial={selectedServices} /></> : <><input type="hidden" name="defaultAssignments" value="all" /><p className="staff-profile-form__assignment-note">New {terms.staffPlural} start bookable for all active locations and services. You can narrow this after creation.</p></> : null}
  </>;
  return <StaffDetailsForm saveLabel={saveLabel} save={ownOwner ? saveOwnerProfileDetails : saveTeamMember}>{fields}</StaffDetailsForm>;
}
