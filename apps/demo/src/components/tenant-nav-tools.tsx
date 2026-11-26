"use client";

import Link from "next/link";
import { Bell, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

export function TenantNavTools({
  searchHref, searchLabel, notificationsHref, notificationsPending = false, arrivalAlertsHref, arrivalAlertPending = false,
}: {
  searchHref?: string;
  searchLabel: string;
  notificationsHref?: string;
  notificationsPending?: boolean;
  arrivalAlertsHref?: string;
  arrivalAlertPending?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [polledArrivalPending, setPolledArrivalPending] = useState<boolean | null>(null);
  useEffect(() => {
    setPolledArrivalPending(null);
    if (!arrivalAlertsHref) return;
    let request: AbortController | undefined;
    async function check() {
      if (document.visibilityState !== "visible" || !arrivalAlertsHref) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(arrivalAlertsHref, { signal: controller.signal });
        if (!response.ok) return;
        const { pending } = await response.json();
        if (!controller.signal.aborted && typeof pending === "boolean") setPolledArrivalPending(pending);
      } catch {
        // Keep the last known indicator until the next check.
      }
    }
    void check();
    const interval = window.setInterval(check, 15_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      request?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [arrivalAlertsHref, arrivalAlertPending]);
  const hasArrivalAlert = arrivalAlertsHref && (polledArrivalPending ?? arrivalAlertPending);
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
  const bell = <span className="tenant-nav-tools__bell" aria-hidden="true">
    <Bell />
    {notificationsHref && (notificationsPending || hasArrivalAlert) ? <span className="tenant-nav-tools__notification-dot" /> : null}
  </span>;
  return <div className="tenant-nav-tools">
    {searchHref && (
      <button ref={triggerRef} type="button" aria-label={searchLabel} aria-expanded={open}
        onClick={() => { if (open) closeSearch(); else setOpen(true); }}><Search aria-hidden="true" /></button>
    )}
    {searchHref && open && (
      <form className="tenant-nav-tools__search" role="search" onSubmit={submit} onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeSearch();
      }}>
        <Search aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
        <button type="button" aria-label="Close search" onClick={closeSearch}><X aria-hidden="true" /></button>
      </form>
    )}
    {notificationsHref ? <Link href={notificationsHref}
      aria-label={hasArrivalAlert ? "Notifications: clients in the waiting room" : notificationsPending ? "Notifications: appointments need review" : "Notifications"}
      className="tenant-nav-tools__notifications">{bell}</Link> : <button type="button" aria-label="Notifications unavailable" disabled>{bell}</button>}
  </div>;
}
