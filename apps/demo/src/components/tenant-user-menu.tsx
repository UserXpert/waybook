"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { applyStoredTenantAppearance } from "@/components/tenant-appearance-controls";

type TenantUserMenuProps = {
  profilePhotoKey: string;
  displayName: string;
  email: string;
  tenantName: string;
  role: string;
  staffHref?: string;
  settingsHref?: string;
  onSignOut: () => void;
};

export function TenantUserMenu({ profilePhotoKey, displayName, email, tenantName, role, staffHref, settingsHref, onSignOut }: TenantUserMenuProps) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  useEffect(() => { applyStoredTenantAppearance(); }, []);
  useEffect(() => {
    try {
      setPhoto(localStorage.getItem(profilePhotoKey));
    } catch {
      setPhoto(null);
    }
  }, [profilePhotoKey]);
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

  const choosePhoto = (file?: File) => {
    if (!file || !file.type.startsWith("image/") || file.size > 2_000_000) return;
    setPhotoError("");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      try {
        localStorage.setItem(profilePhotoKey, reader.result);
        setPhoto(reader.result);
      } catch {
        setPhotoError("Could not save the photo in this browser. Try a smaller image or check your browser storage settings.");
      }
    };
    reader.readAsDataURL(file);
  };
  const avatar = <i aria-hidden>{photo ? <img src={photo} alt="" /> : initials}</i>;
  return <div ref={menu} className="tenant-user-menu">
    <button type="button" aria-label={`Account menu for ${displayName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {avatar}<ChevronDown aria-hidden="true" />
    </button>
    {open ? <section className="tenant-user-menu__popover" role="menu" aria-label="Account menu">
      <header><button type="button" className={`tenant-user-menu__avatar-upload${photo ? " is-photo" : ""}`} aria-label="Upload profile photo" onClick={() => photoInput.current?.click()}>{avatar}{!photo ? <Camera aria-hidden="true" /> : null}</button><input ref={photoInput} className="sr-only" type="file" accept="image/*" onChange={(event) => choosePhoto(event.target.files?.[0])} /><div><strong>{displayName}</strong><span>{email}</span></div><small>{role}</small></header>
      <div className="tenant-user-menu__items">
        {photoError ? <p role="alert">{photoError}</p> : null}
        {staffHref ? <Link role="menuitem" href={staffHref} onClick={() => setOpen(false)}><b aria-hidden><UserRound /></b><span>Edit profile<small>Personal information and staff settings</small></span></Link> : null}
        {settingsHref ? <Link role="menuitem" href={settingsHref} onClick={() => setOpen(false)}><b aria-hidden><Settings /></b><span>Settings<small>Workspace services and configuration</small></span></Link> : null}
      </div>
      <form action={onSignOut}><button type="submit" role="menuitem"><b aria-hidden><LogOut /></b> Sign out</button></form>
    </section> : null}
  </div>;
}
