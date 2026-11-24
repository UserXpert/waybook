"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { saveStaffRole } from "@/app/app/settings/roles/actions";
import { staffPermissionSections, type StaffRole, type StaffRoleOption } from "@/lib/waybook/staff-role-fields";

export function StaffRoleEditor({ role, onSaved, onCancel, settingsHref }: {
  role?: StaffRole;
  onSaved?: (role: StaffRoleOption) => void;
  onCancel?: () => void;
  settingsHref?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState(role?.permissions ?? {});
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof saveStaffRole>>, data: FormData) => {
    const result = await saveStaffRole(previous, data);
    if (result.role) {
      onSaved?.(result.role);
      if (!role && settingsHref) router.replace(`${settingsHref}?role=${result.role.id}`);
    }
    if (result.deleted && settingsHref) router.replace(settingsHref);
    return result;
  }, {});
  const roleId = role?.id ?? state.role?.id;
  const assignedCount = role?.assignedCount ?? 0;
  if (state.deleted) return <p role="status">Role deleted.</p>;

  return <form action={action} className="staff-role-editor">
    {roleId ? <input type="hidden" name="roleId" value={roleId} /> : null}
    <label>Role name<input name="name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {assignedCount ? <p>Saving changes updates access for {assignedCount} assigned staff {assignedCount === 1 ? "member" : "members"}.</p> : null}
    <div className="staff-role-editor__permissions">
      {staffPermissionSections.map(({ title, items }) => <fieldset key={title}>
        <legend>{title}</legend>
        {items.map(([key, label, description]) => <label key={key} className="staff-role-editor__permission">
          <input type="checkbox" name={key} checked={permissions[key] === true} onChange={(event) => {
            const checked = event.target.checked;
            setPermissions((current) => ({ ...current, [key]: checked }));
          }} />
          <span>{label}<small>{description}</small></span>
        </label>)}
      </fieldset>)}
    </div>
    {state.error ? <p role="alert">{state.error}</p> : state.role ? <p role="status">Role saved.</p> : null}
    <div className="staff-role-editor__actions">
      {onCancel ? <button type="button" onClick={onCancel} disabled={pending}>Cancel</button> : null}
      {role && !assignedCount ? <button type="submit" name="intent" value="delete" formNoValidate disabled={pending} onClick={(event) => {
        if (!window.confirm(`Delete the role ${role.name}?`)) event.preventDefault();
      }}>Delete role</button> : null}
      <button className="waybook-primary-link" type="submit" disabled={pending}>{pending ? "Saving…" : roleId ? "Save role" : "Create role"}</button>
    </div>
  </form>;
}
