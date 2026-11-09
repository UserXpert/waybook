"use client";

import { useEffect, useState } from "react";

type Item = { id: string; name: string };
type Result = { items: Array<{ id: string; name?: string; title?: string }>; nextCursor?: string | null };

/** Search-backed selection, submitted as ordinary form fields. */
export function AsyncMultiSelect({ name, label, endpoint, initial = [], single = false, staffByLocation = false }: { name: string; label: string; endpoint: string; initial?: Item[]; single?: boolean; staffByLocation?: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item[]>(initial);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<Item[]>([]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(url: string): Promise<Result> {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Search failed");
    return response.json();
  }
  const normalize = (result: Result) => result.items.map((item) => ({ id: item.id, name: item.name ?? item.title ?? "Unnamed" }));
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      load(`${endpoint}${endpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}&limit=20`)
        .then((data) => { if (!cancelled) { setItems(normalize(data)); setCursor(data.nextCursor ?? null); setError(""); } })
        .catch(() => { if (!cancelled) { setItems([]); setCursor(null); setError("Could not load results. Try searching again."); } });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [endpoint, query]);
  useEffect(() => {
    if (!staffByLocation) return;
    let cancelled = false;
    (async () => { let next: string | null = null; const all: Item[] = []; do { const data: Result = await load(`/api/app/locations?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ""}`); all.push(...normalize(data)); next = data.nextCursor ?? null; } while (next && !cancelled); if (!cancelled) setLocations(all); })().catch(() => { if (!cancelled) setError("Could not load locations."); });
    return () => { cancelled = true; };
  }, [staffByLocation]);
  async function more() {
    if (!cursor) return;
    try { const data = await load(`${endpoint}${endpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}&limit=20&cursor=${encodeURIComponent(cursor)}`); setItems((current) => [...current, ...normalize(data)]); setCursor(data.nextCursor ?? null); } catch { setError("Could not load more results."); }
  }
  async function bulk(add: boolean) {
    if (!location || busy) return;
    setBusy(true); setError("");
    try {
      let next: string | null = null; const all: Item[] = [];
      do { const data: Result = await load(`/api/app/staff?locationId=${encodeURIComponent(location)}&limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ""}`); all.push(...normalize(data)); next = data.nextCursor ?? null; } while (next);
      const ids = new Set(all.map((item) => item.id));
      setSelected((current) => add ? [...new Map([...current, ...all].map((item) => [item.id, item])).values()] : current.filter((item) => !ids.has(item.id)));
    } catch { setError("Could not update staff for this location. Try again."); } finally { setBusy(false); }
  }
  const available = items.filter((item) => !selected.some((entry) => entry.id === item.id));
  return <fieldset className="assignment-picker"><legend>{label}</legend>
    {selected.map((item) => <input key={item.id} type="hidden" name={name} value={item.id} />)}
    {selected.length ? <div className="assignment-picker__selected" aria-label="Selected items">{selected.map((item) => <span key={item.id}>{item.name}<button type="button" onClick={() => setSelected((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.name}`}>×</button></span>)}</div> : <p className="assignment-picker__empty">None selected</p>}
    <input value={query} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} autoComplete="off" />
    {open ? <div className="assignment-picker__results" aria-label="Search results">{available.map((item) => <button type="button" key={item.id} onClick={() => { setSelected((current) => single ? [item] : [...current, item]); setQuery(""); setOpen(false); }}>{item.name}<span aria-hidden="true">+</span></button>)}{!available.length ? <p>No matching unselected records.</p> : null}{cursor ? <button type="button" onClick={more}>Load more</button> : null}<button type="button" onClick={() => setOpen(false)}>Close results</button></div> : null}
    {staffByLocation ? <div className="assignment-picker__bulk"><label>Staff at location<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">Select a location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div><button type="button" disabled={!location || busy} onClick={() => bulk(true)}>Add all staff</button><button type="button" disabled={!location || busy} onClick={() => bulk(false)}>Remove all staff</button></div></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}
