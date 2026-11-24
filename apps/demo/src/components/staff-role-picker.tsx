"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StaffRoleEditor } from "@/components/staff-role-editor";
import { cycleDialogTab } from "@/components/tenant-editor-dialog";
import type { StaffRoleOption } from "@/lib/waybook/staff-role-fields";

export function StaffRolePicker({ initialRole, customRoles, isOwner, staffLabel }: {
  initialRole: string;
  customRoles: StaffRoleOption[];
  isOwner: boolean;
  staffLabel: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState(initialRole);
  const [created, setCreated] = useState<StaffRoleOption[]>([]);
  const [open, setOpen] = useState(false);
  const available = [...customRoles, ...created.filter((role) => !customRoles.some(({ id }) => id === role.id))];
  const canChange = initialRole !== "owner" && (isOwner || (initialRole !== "manager" && !initialRole.startsWith("custom:")));

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  return <div className="staff-role-picker">
    <div className="staff-role-picker__heading">
      <label htmlFor={id}>Role</label>
      {isOwner ? <button type="button" onClick={() => setOpen(true)}>Add role</button> : null}
    </div>
    {!canChange ? <input type="hidden" name="role" value={choice} /> : null}
    <select id={id} name="role" value={choice} disabled={!canChange} onChange={(event) => setChoice(event.target.value)}>
      {initialRole === "owner" ? <option value="owner">Owner</option> : null}
      <option value="staff">{staffLabel}</option>
      {isOwner || initialRole === "manager" ? <option value="manager">Manager</option> : null}
      <option value="read-only">Read-only</option>
      {available.filter(({ id }) => isOwner || choice === `custom:${id}`).map(({ id, name }) => <option key={id} value={`custom:${id}`}>{name}</option>)}
    </select>
    {open ? createPortal(<dialog ref={dialog} className="staff-role-dialog" aria-labelledby={`${id}-title`} onKeyDown={cycleDialogTab} onClose={() => setOpen(false)}>
      <h2 id={`${id}-title`}>Add role</h2>
      <StaffRoleEditor onCancel={() => dialog.current?.close()} onSaved={(role) => {
        setCreated((roles) => [...roles, role]);
        if (canChange) setChoice(`custom:${role.id}`);
        dialog.current?.close();
      }} />
    </dialog>, document.body) : null}
  </div>;
}
