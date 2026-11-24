"use client";

import Link from "next/link";
import { Bell, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

export function TenantNavTools({ searchHref, searchLabel, notificationsHref, notificationsPending = false }: { searchHref?: string; searchLabel: string; notificationsHref?: string; notificationsPending?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);
  const closeSearch = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!searchHref || !value) return;
    router.push(`${searchHref}?q=${encodeURIComponent(value)}`);
    setOpen(false);
  };
  return <div className={`tenant-nav-tools${open ? " is-searching" : ""}`}>
    {searchHref && (open ? (
      <form className="tenant-nav-tools__search" role="search" onSubmit={submit} onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeSearch();
      }}>
        <Search aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
        <button type="button" aria-label="Close search" onClick={closeSearch}><X aria-hidden="true" /></button>
      </form>
    ) : (
      <button ref={triggerRef} type="button" aria-label={searchLabel} onClick={() => setOpen(true)}><Search aria-hidden="true" /></button>
    ))}
    {notificationsHref ? <Link href={notificationsHref} aria-label={notificationsPending ? "Notifications: appointments need review" : "Notifications"} className="tenant-nav-tools__notifications"><Bell aria-hidden="true" />{notificationsPending ? <span className="tenant-nav-tools__notification-dot" aria-hidden="true" /> : null}</Link> : <button type="button" aria-label="Notifications unavailable" disabled><Bell aria-hidden="true" /></button>}
  </div>;
}
