"use client";

import { defaultTenantTerminology, titleTerminology, type TenantTerminology } from "@/lib/waybook/terminology-labels";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Client = { id: string; name: string; email: string; phone?: string | null };

export function ClientPicker({ name, label, required = false, initial, terminology = defaultTenantTerminology, purpose, canCreateClient = true, canSearchPhone = true }: { name: string; label?: string; required?: boolean; initial?: Client | null; terminology?: Pick<TenantTerminology, "client" | "clients">; purpose?: "waitlist"; canCreateClient?: boolean; canSearchPhone?: boolean }) {
  const fieldLabel = label ?? titleTerminology(terminology.client);
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Client[]>(initial ? [initial] : []);
  const [selected, setSelected] = useState<Client | null>(initial ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const createClientHref = `${pathname.split("/app/")[0]}/app/customers?create=1`;
  const lookupPath = `/api/app/clients?${purpose ? `purpose=${purpose}&` : ""}q=${encodeURIComponent(query)}&limit=20`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${tenantApiPrefix()}${lookupPath}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { items: Client[]; nextCursor: string | null };
        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setItems([]); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [lookupPath]);
  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(`${tenantApiPrefix()}${lookupPath}&cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) return;
      const data = await response.json() as { items: Client[]; nextCursor: string | null };
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(data.nextCursor);
    } finally { setIsLoadingMore(false); }
  };
  return <div className="client-picker">
    <label className="client-picker__fields">
      {fieldLabel}
      <input type="hidden" name={name} value={selected?.id ?? ""} required={required} />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
        placeholder={canSearchPhone ? "Search name, email, or phone" : "Search name or email"} aria-label={`${fieldLabel} search`} autoComplete="off" />
      <select value={selected?.id ?? ""} onChange={(event) => setSelected(items.find((item) => item.id === event.target.value) ?? null)}
        required={required} aria-label={fieldLabel}>
        <option value="">{required ? `Select a ${terminology.client}` : `Not linked to a ${terminology.client}`}</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}
      </select>
      {selected ? <small>Selected: {selected.name}{selected.email ? ` · ${selected.email}` : ""}</small> : null}
    </label>
    {nextCursor || canCreateClient ? <div className="client-picker__actions">
      {nextCursor ? <button type="button" onClick={() => void loadMore()} disabled={isLoadingMore}>
        {isLoadingMore ? "Loading…" : `Load more ${terminology.clients}`}
      </button> : null}
      {canCreateClient ? <a href={createClientHref}>Create a new {terminology.client}</a> : null}
    </div> : null}
  </div>;
}
