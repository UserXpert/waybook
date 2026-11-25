"use client";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";
import { titleTerminology } from "@/lib/waybook/terminology-labels";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Client = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  bookingCount: number;
  bookedValueCents: number;
  lastBookingAt: string | null;
  nextBookingAt: string | null;
};

type ClientPage = { items: Client[]; nextCursor: string | null };

type Props = {
  initialClients: Client[];
  initialNextCursor: string | null;
  query: string;
  path: string;
  timeZone: string;
  clientLabel: string;
  clientsLabel: string;
  recordOpen: boolean;
  searchInputId: string;
};

const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

async function loadClients(query: string, cursor: string, signal: AbortSignal): Promise<ClientPage> {
  const params = new URLSearchParams({ q: query, cursor, limit: "50" });
  const response = await fetch(`${tenantApiPrefix()}/api/app/clients?${params}`, { signal });
  if (!response.ok) throw new Error("Could not load clients.");
  return response.json();
}

export function ClientDirectoryList({ initialClients, initialNextCursor, query, path, timeZone, clientLabel, clientsLabel, recordOpen, searchInputId }: Props) {
  const [clients, setClients] = useState(initialClients);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const directoryRef = useRef<HTMLDivElement>(null);
  const focusedBeforeRefresh = useRef<Element | null>(null);
  const recordWasOpen = useRef(recordOpen);
  const requestRef = useRef<AbortController | null>(null);
  const loadedPages = useRef(0);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" });

  useLayoutEffect(() => {
    const recordClosed = recordWasOpen.current && !recordOpen;
    const focusedRowRemoved = focusedBeforeRefresh.current?.isConnected === false;
    if ((recordClosed || focusedRowRemoved) && document.activeElement === document.body && !document.querySelector("dialog:modal")) {
      document.getElementById(searchInputId)?.focus();
    }
    recordWasOpen.current = recordOpen;
    focusedBeforeRefresh.current = null;
  }, [clients, recordOpen, searchInputId]);

  useEffect(() => {
    function replaceRows(rows: Client[]) {
      const focused = document.activeElement;
      focusedBeforeRefresh.current = directoryRef.current?.contains(focused) ? focused : null;
      setClients(rows);
    }

    requestRef.current?.abort();
    requestRef.current = null;
    if (!loadedPages.current || !initialNextCursor) {
      replaceRows(initialClients);
      setNextCursor(initialNextCursor);
      setLoading(false);
      loadedPages.current = 0;
      return;
    }

    // Drawer navigation also refreshes the first page. Keep the existing rows
    // mounted while rebuilding the loaded window so the opener keeps its focus.
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    async function refresh() {
      const refreshed = new Map(initialClients.map((client) => [client.id, client]));
      let cursor = initialNextCursor;
      let pages = 0;
      while (cursor && pages < loadedPages.current) {
        const data = await loadClients(query, cursor, controller.signal);
        for (const client of data.items) refreshed.set(client.id, client);
        cursor = data.nextCursor;
        pages++;
      }
      if (controller.signal.aborted) return;
      loadedPages.current = pages;
      replaceRows([...refreshed.values()]);
      setNextCursor(cursor);
    }
    void refresh().catch(() => {
      // Keep the current window visible when refresh is temporarily unavailable.
    }).finally(() => {
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      setLoading(false);
    });
    return () => controller.abort();
  }, [initialClients, initialNextCursor, query]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      void loadClients(query, nextCursor, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          loadedPages.current++;
          setClients((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
          setNextCursor(data.nextCursor);
        })
        .catch(() => {
          // Keep the sentinel in place so a later scroll can retry a transient request failure.
        })
        .finally(() => {
          if (requestRef.current !== controller) return;
          requestRef.current = null;
          setLoading(false);
        });
    }, { rootMargin: "320px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, query]);

  const clientHref = (id: string) => `${path}?${new URLSearchParams({ ...(query ? { q: query } : {}), customer: id })}`;

  return <div className="waybook-table-wrap" ref={directoryRef}>
    <table>
      <thead><tr><th>{titleTerminology(clientLabel)}</th><th>Contact</th><th>Next appointment</th><th>Visits</th><th>Booked value</th></tr></thead>
      <tbody>
        {clients.map((client) => <tr key={client.id} className="customer-table-row">
          <td><Link href={clientHref(client.id)} scroll={false}><strong>{client.name}</strong><small>{client.lastBookingAt ? `Last visit ${date.format(new Date(client.lastBookingAt))}` : `New ${clientLabel}`}</small></Link></td>
          <td><Link href={clientHref(client.id)} scroll={false} tabIndex={-1}>{client.email}{client.phone ? <small>{client.phone}</small> : null}</Link></td>
          <td><Link href={clientHref(client.id)} scroll={false} tabIndex={-1}>{client.nextBookingAt ? date.format(new Date(client.nextBookingAt)) : "—"}</Link></td>
          <td><Link href={clientHref(client.id)} scroll={false} tabIndex={-1}>{client.bookingCount}</Link></td>
          <td><Link href={clientHref(client.id)} scroll={false} tabIndex={-1}>{money(client.bookedValueCents)}</Link></td>
        </tr>)}
        {clients.length === 0 ? <tr><td colSpan={5}>No {clientsLabel} match this search.</td></tr> : null}
        {nextCursor ? <tr ref={sentinelRef} className="client-directory-list__sentinel"><td colSpan={5}>{loading ? `Loading ${clientsLabel}…` : ""}</td></tr> : null}
      </tbody>
    </table>
  </div>;
}
