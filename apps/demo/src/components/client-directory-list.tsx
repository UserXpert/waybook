"use client";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";
import { titleTerminology } from "@/lib/waybook/terminology-labels";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

type Props = {
  initialClients: Client[];
  initialNextCursor: string | null;
  query: string;
  path: string;
  timeZone: string;
  clientLabel: string;
  clientsLabel: string;
};

const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

export function ClientDirectoryList({ initialClients, initialNextCursor, query, path, timeZone, clientLabel, clientsLabel }: Props) {
  const [clients, setClients] = useState(initialClients);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const inFlightRef = useRef(false);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" });

  useEffect(() => {
    setClients(initialClients);
    setNextCursor(initialNextCursor);
    setLoading(false);
    inFlightRef.current = false;
  }, [initialClients, initialNextCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      const params = new URLSearchParams({ q: query, cursor: nextCursor, limit: "50" });
      void fetch(`${tenantApiPrefix()}/api/app/clients?${params}`)
        .then((response) => response.ok ? response.json() as Promise<{ items: Client[]; nextCursor: string | null }> : null)
        .then((data) => {
          if (!data) return;
          setClients((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
          setNextCursor(data.nextCursor);
        })
        .catch(() => {
          // Keep the sentinel in place so a later scroll can retry a transient request failure.
        })
        .finally(() => {
          inFlightRef.current = false;
          setLoading(false);
        });
    }, { rootMargin: "320px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, query]);

  const clientHref = (id: string) => `${path}?${new URLSearchParams({ ...(query ? { q: query } : {}), customer: id })}`;

  return <div className="waybook-table-wrap">
    <table>
      <thead><tr><th>{titleTerminology(clientLabel)}</th><th>Contact</th><th>Next appointment</th><th>Visits</th><th>Booked value</th></tr></thead>
      <tbody>
        {clients.map((client) => <tr key={client.id} className="customer-table-row">
          <td><Link href={clientHref(client.id)}><strong>{client.name}</strong><small>{client.lastBookingAt ? `Last visit ${date.format(new Date(client.lastBookingAt))}` : `New ${clientLabel}`}</small></Link></td>
          <td><Link href={clientHref(client.id)} tabIndex={-1}>{client.email}{client.phone ? <small>{client.phone}</small> : null}</Link></td>
          <td><Link href={clientHref(client.id)} tabIndex={-1}>{client.nextBookingAt ? date.format(new Date(client.nextBookingAt)) : "—"}</Link></td>
          <td><Link href={clientHref(client.id)} tabIndex={-1}>{client.bookingCount}</Link></td>
          <td><Link href={clientHref(client.id)} tabIndex={-1}>{money(client.bookedValueCents)}</Link></td>
        </tr>)}
        {clients.length === 0 ? <tr><td colSpan={5}>No {clientsLabel} match this search.</td></tr> : null}
        {nextCursor ? <tr ref={sentinelRef} className="client-directory-list__sentinel"><td colSpan={5}>{loading ? `Loading ${clientsLabel}…` : ""}</td></tr> : null}
      </tbody>
    </table>
  </div>;
}
