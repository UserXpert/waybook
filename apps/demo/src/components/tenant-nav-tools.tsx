"use client";

import Link from "next/link";
import { Bell, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

export function TenantNavTools({ searchHref, notificationsHref }: { searchHref: string; notificationsHref?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const showSearch = () => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    router.push(`${searchHref}?q=${encodeURIComponent(value)}`);
    setOpen(false);
  };
  return <div className={`tenant-nav-tools${open ? " is-searching" : ""}`}>
    {open ? <form className="tenant-nav-tools__search" role="search" onSubmit={submit}><Search aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bookings or clients" aria-label="Search bookings or clients" /><button type="button" aria-label="Close search" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></form> : <button type="button" aria-label="Search bookings or clients" onClick={showSearch}><Search aria-hidden="true" /></button>}
    {notificationsHref ? <Link href={notificationsHref} aria-label="Notifications"><Bell aria-hidden="true" /></Link> : <button type="button" aria-label="Notifications unavailable" disabled><Bell aria-hidden="true" /></button>}
  </div>;
}
