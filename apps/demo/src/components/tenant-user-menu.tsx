"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { applyStoredTenantAppearance } from "@/components/tenant-appearance-controls";
import { StaffPhotoCamera, useStaffPhotoUpload, type StaffPhotoAction } from "@/components/staff-photo-upload";

type TenantUserMenuProps = {
  photo: string | null;
  photoMemberId: string | null;
  onSavePhoto: StaffPhotoAction;
  displayName: string;
  email: string;
  role: string;
  staffHref?: string;
  settingsHref?: string;
  onSignOut: () => void;
};

export function TenantUserMenu({ photo, photoMemberId, onSavePhoto, displayName, email, role, staffHref, settingsHref, onSignOut }: TenantUserMenuProps) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const { input, uploadButton, error, pending, upload } = useStaffPhotoUpload(photoMemberId, onSavePhoto);
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => { applyStoredTenantAppearance(); };
    applyAppearance();
    systemTheme.addEventListener("change", applyAppearance);
    return () => systemTheme.removeEventListener("change", applyAppearance);
  }, []);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  const avatar = <i className="waybook-circle" aria-hidden>{photo ? <img src={photo} alt="" /> : initials}</i>;
  return <div ref={menu} className="tenant-user-menu">
    <button type="button" aria-label={`Account menu for ${displayName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {avatar}<ChevronDown aria-hidden="true" />
    </button>
    {open ? <section className="tenant-user-menu__popover" role="menu" aria-label="Account menu">
      <header>
        {photoMemberId ? <>
          <button ref={uploadButton} type="button" className="tenant-user-menu__avatar-upload" disabled={pending} aria-label={pending ? "Updating profile photo" : "Upload profile photo"} onClick={() => input.current?.click()}>{avatar}{photo ? null : <StaffPhotoCamera />}</button>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload(event.target.files?.[0])} />
        </> : <span className="tenant-user-menu__avatar-upload">{avatar}</span>}
        <div><strong>{displayName}</strong><span>{email}</span></div><small>{role}</small>
      </header>
      <div className="tenant-user-menu__items">
        {error ? <p role="alert">{error}</p> : null}
        {staffHref ? <Link role="menuitem" href={staffHref} onClick={() => setOpen(false)}><b aria-hidden><UserRound /></b><span>Edit profile<small>Personal information and staff settings</small></span></Link> : null}
        {settingsHref ? <Link role="menuitem" href={settingsHref} onClick={() => setOpen(false)}><b aria-hidden><Settings /></b><span>Settings<small>Workspace services and configuration</small></span></Link> : null}
      </div>
      <form action={onSignOut}><button type="submit" role="menuitem"><b aria-hidden><LogOut /></b> Sign out</button></form>
    </section> : null}
  </div>;
}
