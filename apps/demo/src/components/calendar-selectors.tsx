"use client";

import { type KeyboardEvent, useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };
type Location = { id: string; name: string };
type SearchResult<T> = { items: T[] };

export type SearchPickerProps<T extends { id: string }> = {
  label: string;
  selectedLabel: string;
  placeholder: string;
  searchUrl: (query: string) => string;
  resultsLabel: (item: T) => string;
  onPick: (item: T) => void;
  onClear?: () => void;
  hintId?: string;
};

/** A bounded, keyboard-friendly async picker. It never renders a tenant-wide
 * directory: result rows appear only after an intentional two-character search. */
export function SearchPicker<T extends { id: string }>({
  label,
  selectedLabel,
  placeholder,
  searchUrl,
  resultsLabel,
  onPick,
  onClear,
  hintId,
}: SearchPickerProps<T>) {
  const listId = useId();
  const [query, setQuery] = useState(selectedLabel);
  const [results, setResults] = useState<T[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const normalizedQuery = query.trim();
  const isSearching = isFocused && hasTyped && normalizedQuery.length >= 2;

  useEffect(() => {
    setQuery(selectedLabel);
    setResults([]);
    setHasTyped(false);
  }, [selectedLabel]);

  useEffect(() => {
    if (!isSearching) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(searchUrl(normalizedQuery), { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as SearchResult<T>;
        setResults(data.items);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isSearching, normalizedQuery, searchUrl]);

  const choose = (item: T) => {
    setIsFocused(false);
    setResults([]);
    onPick(item);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsFocused(false);
      setResults([]);
      event.currentTarget.blur();
    }
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      choose(results[0]);
    }
  };

  return (
    <div className="calendar-search-picker">
      <label htmlFor={listId}>{label}</label>
      <input
        id={listId}
        value={query}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${listId}-results`}
        aria-expanded={isSearching}
        aria-describedby={hintId}
        autoComplete="off"
        onFocus={(event) => {
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
        onChange={(event) => {
          setHasTyped(true);
          setQuery(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      {onClear ? <button type="button" className="calendar-search-picker__clear waybook-icon-button" aria-label={`Clear ${label}`} onClick={onClear}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8" /></svg></button> : null}
      {isSearching ? (
        <div className="calendar-search-picker__results" id={`${listId}-results`} role="listbox" aria-label={`${label} results`}>
          {results.length ? results.map((item) => (
            <button key={item.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
              {resultsLabel(item)}
            </button>
          )) : <p>No matches found.</p>}
        </div>
      ) : null}
    </div>
  );
}

/** Calendar filters use compact async search instead of serialising large
 * location, staff, or service directories into native dropdowns. */
export function CalendarSelectors({ location, members, services, week, teamMode = false }: { location: Location; members: Member[]; services: Service[]; week: string; teamMode?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedEmployeeId = searchParams.get("employee") ?? "";
  const selectedServiceId = searchParams.get("service") ?? "";
  const selectedDay = searchParams.get("day") ?? "";
  const rosterSearch = searchParams.get("staff") ?? "";
  const selectedEmployee = members.find((item) => item.id === selectedEmployeeId);
  const selectedService = services.find((item) => item.id === selectedServiceId);
  const locationSearchUrl = useCallback((query: string) => `/api/app/locations?q=${encodeURIComponent(query)}&limit=8`, []);
  const staffSearchUrl = useCallback((query: string) => {
    const params = new URLSearchParams({ locationId: location.id, q: query, limit: "8" });
    if (selectedServiceId) params.set("serviceId", selectedServiceId);
    return `/api/app/staff?${params.toString()}`;
  }, [location.id, selectedServiceId]);
  const serviceSearchUrl = useCallback((query: string) => `/api/app/services?${new URLSearchParams({ locationId: location.id, q: query, limit: "8" }).toString()}`, [location.id]);
  const go = (nextLocationId: string, nextEmployeeId: string, nextServiceId: string, nextRosterSearch = "") => {
    const params = new URLSearchParams({ location: nextLocationId, employee: nextEmployeeId, week });
    if (selectedDay) params.set("day", selectedDay);
    if (nextServiceId) params.set("service", nextServiceId);
    if (nextRosterSearch) params.set("staff", nextRosterSearch);
    params.set("view", nextEmployeeId ? "staff" : "team");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="calendar-selectors">
      <SearchPicker<Location>
        label="Location"
        selectedLabel={location.name}
        placeholder="Search locations"
        searchUrl={locationSearchUrl}
        resultsLabel={(item) => item.name}
        onPick={(item) => go(item.id, "", "")}
      />
      <SearchPicker<Member>
        label="Staff"
        selectedLabel={teamMode ? rosterSearch : (selectedEmployee?.name ?? "")}
        placeholder="Search staff"
        searchUrl={staffSearchUrl}
        resultsLabel={(item) => item.name}
        onPick={(item) => teamMode ? go(location.id, "", selectedServiceId, item.name) : go(location.id, item.id, "")}
        onClear={teamMode ? (rosterSearch ? () => go(location.id, "", selectedServiceId) : undefined) : (selectedEmployee ? () => go(location.id, "", selectedServiceId) : undefined)}
      />
      <SearchPicker<Service>
        label="Service"
        selectedLabel={selectedService ? `${selectedService.title} · ${selectedService.durationMinutes} min` : ""}
        placeholder="Search services"
        searchUrl={serviceSearchUrl}
        resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min`}
        onPick={(item) => go(location.id, teamMode ? "" : selectedEmployeeId, item.id, teamMode ? rosterSearch : "")}
        onClear={selectedService ? () => go(location.id, teamMode ? "" : selectedEmployeeId, "", teamMode ? rosterSearch : "") : undefined}
      />
    </div>
  );
}
