"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Bell, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ClipboardList, ListPlus, MapPin, PackageOpen, PanelsTopLeft, Search, UsersRound, UserRound, X } from "lucide-react";

export type TenantAppLink = { id: string; href: string; label: string; description: string; group: "Operations" | "Manage" | "Tools" };

const appIcons = {
  bookings: ClipboardList, calendars: CalendarDays, waitlist: ListPlus, clients: UsersRound,
  team: UserRound, services: BriefcaseBusiness, locations: MapPin, resources: PackageOpen,
  notifications: Bell, reports: ChartNoAxesCombined,
} as const;

export function TenantAppMenu({ links, active }: { links: TenantAppLink[]; active: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const visibleLinks = useMemo(() => links.filter((link) => `${link.label} ${link.description}`.toLowerCase().includes(query.trim().toLowerCase())), [links, query]);
  const groups: TenantAppLink["group"][] = ["Operations", "Manage", "Tools"];

  return <div className="tenant-app-menu">
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><PanelsTopLeft aria-hidden="true" /> Apps</button>
    {open ? createPortal(<div className="tenant-app-menu__layer" role="presentation"><button className="tenant-app-menu__scrim" aria-label="Close apps menu" onClick={() => setOpen(false)} /><section className="tenant-app-menu__dialog" role="dialog" aria-modal="true" aria-labelledby="tenant-app-menu-title"><header><div><p>WAYBOOK APPS</p><h2 id="tenant-app-menu-title">Find a workspace</h2></div><button type="button" aria-label="Close apps menu" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></header><label className="tenant-app-menu__search"><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps and settings" /></label><div className="tenant-app-menu__groups">{groups.map((group) => { const groupLinks = visibleLinks.filter((link) => link.group === group); return groupLinks.length ? <section key={group}><h3>{group}</h3><div>{groupLinks.map((link) => { const Icon = appIcons[link.id as keyof typeof appIcons]; return <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined} onClick={() => setOpen(false)}><i aria-hidden="true"><Icon /></i><span><strong>{link.label}</strong><small>{link.description}</small></span></Link>; })}</div></section> : null; })}</div>{visibleLinks.length === 0 ? <p className="tenant-app-menu__empty">No enabled Waybook app matches “{query}”.</p> : null}</section></div>, document.body) : null}
  </div>;
}
