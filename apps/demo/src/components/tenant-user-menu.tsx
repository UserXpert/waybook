"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LogOut, Target, UsersRound } from "lucide-react";
import { applyStoredTenantAppearance, TenantAppearanceControls } from "@/components/tenant-appearance-controls";

type TenantUserMenuProps = {
  displayName: string;
  email: string;
  tenantName: string;
  role: string;
  staffHref?: string;
  targetsHref?: string;
  onSignOut: () => void;
};

export function TenantUserMenu({ displayName, email, tenantName, role, staffHref, targetsHref, onSignOut }: TenantUserMenuProps) {
  const [open, setOpen] = useState(false);
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  useEffect(() => { applyStoredTenantAppearance(); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  return <div className="tenant-user-menu">
    <button type="button" aria-label={`Account menu for ${displayName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <i aria-hidden>{initials}</i><span><strong>{displayName}</strong><small>{tenantName}</small></span><ChevronDown aria-hidden="true" />
    </button>
    {open ? createPortal(<div className="tenant-user-menu__layer" role="presentation"><button className="tenant-user-menu__scrim" aria-label="Close account menu" onClick={() => setOpen(false)} /><section className="tenant-user-menu__popover" role="menu" aria-label="Account menu">
      <header><i aria-hidden>{initials}</i><div><strong>{displayName}</strong><span>{email}</span><small>{role}</small></div></header>
      <div className="tenant-user-menu__items">
        {staffHref ? <Link role="menuitem" href={staffHref} onClick={() => setOpen(false)}><b aria-hidden><UsersRound /></b><span>Staff workspace<small>Hours, eligibility and time off</small></span></Link> : null}
        {targetsHref ? <Link role="menuitem" href={targetsHref} onClick={() => setOpen(false)}><b aria-hidden><Target /></b><span>Monthly targets<small>Staff booked-value plans</small></span></Link> : null}
      </div>
      <TenantAppearanceControls />
      <form action={onSignOut}><button type="submit" role="menuitem"><b aria-hidden><LogOut /></b> Sign out</button></form>
    </section></div>, document.body) : null}
  </div>;
}
