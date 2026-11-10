"use client";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Client = { id: string; name: string; email: string; phone: string | null };

export function ClientPicker({ name, label = "Client", required = false, initial }: { name: string; label?: string; required?: boolean; initial?: Client | null }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Client[]>(initial ? [initial] : []);
  const [selected, setSelected] = useState<Client | null>(initial ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const createClientHref = `${pathname.split("/app/")[0]}/app/customers?create=1`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${tenantApiPrefix()}/api/app/clients?q=${encodeURIComponent(query)}&limit=20`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { items: Client[]; nextCursor: string | null };
        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setItems([]); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);
  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(`${tenantApiPrefix()}/api/app/clients?q=${encodeURIComponent(query)}&limit=20&cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) return;
      const data = await response.json() as { items: Client[]; nextCursor: string | null };
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(data.nextCursor);
    } finally { setIsLoadingMore(false); }
  };
  return <div><label>{label}<input type="hidden" name={name} value={selected?.id ?? ""} required={required} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Search name, email, or phone" aria-label={`${label} search`} autoComplete="off" />{selected ? <small>Selected: {selected.name}{selected.email ? ` · ${selected.email}` : ""}</small> : null}<select value={selected?.id ?? ""} onChange={(event) => setSelected(items.find((item) => item.id === event.target.value) ?? null)} required={required} aria-label={label}><option value="">{required ? "Select a client" : "Not linked to a client"}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select>{nextCursor ? <button type="button" onClick={() => void loadMore()} disabled={isLoadingMore}>{isLoadingMore ? "Loading…" : "Load more clients"}</button> : null}</label><a href={createClientHref}>Create a new client</a></div>;
}
