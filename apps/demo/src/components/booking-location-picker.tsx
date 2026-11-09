"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

type Location = { id: string; name: string; locationType: string };
export function BookingLocationPicker({ locations, value, onChange, onSearch, compact = false }: { locations: Location[]; value: string; onChange: (id: string) => void; onSearch?: (query: string) => void; compact?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedName, setSelectedName] = useState(() => locations.find(location => location.id === value)?.name ?? "");
  useEffect(() => { if (!value) setSelectedName(""); }, [value]);
  const filtered = locations.filter(location => location.name.toLowerCase().includes(query.toLowerCase()));
  const choose = (location: Location) => { onChange(location.id); setSelectedName(location.name); setQuery(""); onSearch?.(""); setOpen(false); };
  return <div className={`booking-location-picker${compact ? " booking-location-picker--compact" : ""}`}><label htmlFor={id} className={compact ? "booking-location-picker__sr-label" : undefined}>Location</label><div className="booking-location-picker__control"><input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined} autoComplete="off" value={open ? query : selectedName} placeholder={compact ? "Search locations" : "Search and select a location"} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActiveIndex(0); onSearch?.(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); setQuery(""); onSearch?.(""); } if (event.key === "ArrowDown" && filtered.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, filtered.length - 1)); } if (event.key === "ArrowUp" && filtered.length) { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); } if (event.key === "Enter" && open && filtered.length) { event.preventDefault(); choose(filtered[activeIndex] ?? filtered[0]); } }} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) { setOpen(false); setQuery(""); onSearch?.(""); } }} /><span aria-hidden="true"><ChevronDown size={16} strokeWidth={1.8} /></span>{open ? <div className="booking-location-picker__options" id={`${id}-options`} role="listbox">{filtered.length ? filtered.map((location, index) => <button id={`${id}-option-${index}`} key={location.id} role="option" type="button" aria-selected={value === location.id} onClick={() => choose(location)}>{location.name}{location.locationType === "mobile" ? " · Mobile" : ""}</button>) : <p>No matching locations.</p>}</div> : null}</div></div>;
}
