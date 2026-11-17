"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bell, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ClipboardList, Gift, ListPlus, Mail, MapPin, PackageOpen, PanelsTopLeft, ReceiptText, Search, Target, UsersRound, UserRound, X, Globe2 } from "lucide-react";

export type TenantAppLink = { id: string; href: string; label: string; description: string; group: "Operations" | "Commerce" | "Setup" | "Insights" };

const appIcons = {
  bookings: ClipboardList, sales: ReceiptText, products: PackageOpen, giftCards: Gift, packages: PackageOpen, calendars: CalendarDays, waitlist: ListPlus, clients: UsersRound,
  team: UserRound, services: BriefcaseBusiness, locations: MapPin, resources: PackageOpen,
  notifications: Bell, emails: Mail, reports: ChartNoAxesCombined, targets: Target, onlineBooking: Globe2,
} as const;

export function TenantAppMenu({ links, active }: { links: TenantAppLink[]; active: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [destination, setDestination] = useState("");
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(".tenant-app-menu__dialog");
      const controls = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')) : [];
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); trigger?.focus(); };
  }, [open]);
  const visibleLinks = useMemo(() => links.filter((link) => `${link.label} ${link.description}`.toLowerCase().includes(query.trim().toLowerCase())), [links, query]);
  const groups: TenantAppLink["group"][] = ["Operations", "Commerce", "Setup", "Insights"];

  return <div className="tenant-app-menu">
    <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); setOpen(true); }}><PanelsTopLeft aria-hidden="true" /> Apps</button>
    {pending ? <span className="tenant-app-menu__loading" role="status">Opening {destination}…</span> : null}
    {open ? createPortal(<div className="tenant-app-menu__layer" role="presentation"><button className="tenant-app-menu__scrim" aria-label="Close apps menu" onClick={() => setOpen(false)} /><section className="tenant-app-menu__dialog" role="dialog" aria-modal="true" aria-labelledby="tenant-app-menu-title"><header><div><p>WAYBOOK APPS</p><h2 id="tenant-app-menu-title">Apps & settings</h2></div><button type="button" aria-label="Close apps menu" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></header><label className="tenant-app-menu__search"><Search aria-hidden="true" /><input aria-label="Search apps and settings" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps and settings" /></label><div className="tenant-app-menu__groups">{groups.map((group) => { const groupLinks = visibleLinks.filter((link) => link.group === group); return groupLinks.length ? <section key={group}><h3>{group}</h3><div>{groupLinks.map((link) => { const Icon = appIcons[link.id as keyof typeof appIcons]; return <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setOpen(false); if (active === link.id) return; setDestination(link.label); startTransition(() => router.push(link.href)); }}><i aria-hidden="true"><Icon /></i><span>{link.label}</span></Link>; })}</div></section> : null; })}</div>{visibleLinks.length === 0 ? <p className="tenant-app-menu__empty">No enabled Waybook app matches “{query}”.</p> : null}</section></div>, document.body) : null}
  </div>;
}
