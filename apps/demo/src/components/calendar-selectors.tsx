"use client";

import { defaultTenantTerminology, titleTerminology, type TenantTerminology } from "@/lib/waybook/terminology-labels";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };
type Location = { id: string; name: string };
type SearchResult<T> = { items: T[] };

export type SearchPickerProps<T extends { id: string }> = {
  label: string;
  hideLabel?: boolean;
  name?: string;
  selectedLabel: string;
  selectedDetail?: string;
  placeholder: string;
  searchUrl: (query: string) => string;
  resultsLabel: (item: T) => string;
  resultsDetail?: (item: T) => string;
  onPick: (item: T) => void;
  onClear?: () => void;
  hintId?: string;
  minimumQueryLength?: number;
  browseOnFocus?: boolean;
  autoFocus?: boolean;
  createOption?: { label: string; onPick: (query: string) => void };
};

/** A bounded async picker that searches after two characters by default. */
export function SearchPicker<T extends { id: string }>({
  label,
  hideLabel,
  name,
  selectedLabel,
  selectedDetail,
  placeholder,
  searchUrl,
  resultsLabel,
  resultsDetail,
  onPick,
  onClear,
  hintId,
  createOption,
  minimumQueryLength = 2,
  browseOnFocus = false,
  autoFocus = browseOnFocus,
}: SearchPickerProps<T>) {
  const listId = useId();
  const detailId = selectedDetail ? `${listId}-selected-detail` : undefined;
  const [query, setQuery] = useState(selectedLabel);
  const [result, setResult] = useState<{ url: string; items: T[] | null } | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const [navigation, setNavigation] = useState<{ url: string; index: number } | null>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const normalizedQuery = query.trim();
  const isSearching = isFocused && (browseOnFocus && !selectedLabel || hasTyped && normalizedQuery.length >= minimumQueryLength);
  const activeUrl = isSearching ? searchUrl(normalizedQuery) : null;
  const matchingResult = result?.url === activeUrl ? result : null;
  const results = matchingResult?.items ?? [];
  const activeIndex = navigation?.url === activeUrl && navigation.index < results.length ? navigation.index : -1;
  const activeOption = activeIndex >= 0 ? results[activeIndex] : undefined;
  const canCreate = matchingResult?.items != null && createOption;

  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  useEffect(() => {
    setQuery(selectedLabel);
    setResult(null);
    setHasTyped(false);
  }, [selectedLabel]);

  useEffect(() => {
    if (!activeUrl) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(activeUrl, { signal: controller.signal });
        const data = response.ok ? await response.json() as SearchResult<T> : null;
        if (!controller.signal.aborted) setResult({ url: activeUrl, items: data?.items ?? null });
      } catch {
        if (!controller.signal.aborted) setResult({ url: activeUrl, items: null });
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeUrl]);

  const choose = (item: T) => {
    setIsFocused(false);
    setQuery(selectedLabel);
    setResult(null);
    setNavigation(null);
    onPick(item);
  };
  useEffect(() => {
    if (activeOption) document.getElementById(`${listId}-option-${activeOption.id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeOption, listId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (browseOnFocus && (event.key === "ArrowDown" || event.key === "ArrowUp") && (isSearching || !selectedLabel)) {
      event.preventDefault();
      if (!isSearching) setIsFocused(true);
      if (activeUrl && results.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        const index = activeIndex < 0 ? (step > 0 ? 0 : results.length - 1)
          : (activeIndex + step + results.length) % results.length;
        setNavigation({ url: activeUrl, index });
      }
    }
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      event.stopPropagation();
      setIsFocused(false);
      setHasTyped(false);
      setNavigation(null);
      setQuery(selectedLabel);
      setResult(null);
    }
    if (event.key === "Enter" && isSearching) {
      event.preventDefault();
      if (activeOption ?? results[0]) choose(activeOption ?? results[0]);
      else if (canCreate) canCreate.onPick(normalizedQuery);
    }
  };

  return (
    <div className={`calendar-search-picker${browseOnFocus ? " calendar-search-picker--browse" : ""}${selectedDetail ? " calendar-search-picker--with-detail" : ""}`}>
      <label htmlFor={listId} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      {selectedDetail ? <span id={detailId} className="calendar-search-picker__selected-detail">{selectedDetail}</span> : null}
      <input
        id={listId}
        name={name}
        value={query}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${listId}-results`}
        aria-expanded={isSearching}
        aria-activedescendant={activeOption ? `${listId}-option-${activeOption.id}` : undefined}
        aria-describedby={[hintId, detailId].filter(Boolean).join(" ") || undefined}
        autoComplete="off"
        autoFocus={autoFocus && !selectedLabel}
        onFocus={(event) => {
          window.clearTimeout(blurTimer.current);
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onClick={browseOnFocus && !selectedLabel ? () => setIsFocused(true) : undefined}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setIsFocused(false), 120);
        }}
        onChange={(event) => {
          setHasTyped(true);
          setIsFocused(true);
          setNavigation(null);
          setQuery(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      {onClear ? <button type="button" className="calendar-search-picker__clear waybook-icon-button" aria-label={`Clear ${label}`} onClick={onClear}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8" /></svg></button> : null}
      {isSearching ? (
        <div className="calendar-search-picker__results" id={`${listId}-results`} role="listbox" aria-label={`${label} results`}>
          {!matchingResult ? <p role="status">Searching…</p> : matchingResult.items === null ? <p role="status">Search unavailable. Change the search to try again.</p> : results.length ? results.map((item) => (
            <button key={item.id} id={`${listId}-option-${item.id}`} type="button" role="option"
              aria-selected={activeOption?.id === item.id} tabIndex={browseOnFocus ? -1 : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
              {resultsDetail ? <span className="calendar-search-picker__option-detail">
                <span>{resultsLabel(item)}</span>
                <span>{resultsDetail(item)}</span>
              </span> : resultsLabel(item)}
            </button>
          )) : <p>No matches found.</p>}
          {canCreate ? <button type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => canCreate.onPick(normalizedQuery)}>
            {canCreate.label} “{normalizedQuery}”
          </button> : null}
        </div>
      ) : null}
    </div>
  );
}

export async function findEligibleProvider(locationId: string, serviceId: string, candidate: Member) {
  const query = new URLSearchParams({ locationId, serviceId, q: candidate.name, limit: "50" });
  try {
    const response = await fetch(`${tenantApiPrefix()}/api/app/staff?${query}`);
    if (!response.ok) return undefined;
    const { items } = await response.json() as SearchResult<Member>;
    return items.find((item) => item.id === candidate.id);
  } catch {
    // Staff can still choose a provider explicitly.
    return undefined;
  }
}

/** Calendar filters use compact async search instead of serialising large
 * location, staff, or service directories into native dropdowns. */
export function CalendarSelectors({ location, members, services, week, teamMode = false, fixedView, terminology = defaultTenantTerminology }: { location: Location; members: Member[]; services: Service[]; week: string; teamMode?: boolean; fixedView?: "month"; terminology?: TenantTerminology }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedEmployeeId = searchParams.get("employee") ?? "";
  const selectedServiceId = searchParams.get("service") ?? "";
  const selectedDay = searchParams.get("day") ?? "";
  const selectedMonthDay = searchParams.get("monthDay") ?? "";
  const rosterSearch = searchParams.get("staff") ?? "";
  const selectedEmployee = members.find((item) => item.id === selectedEmployeeId);
  const selectedService = services.find((item) => item.id === selectedServiceId);
  const locationSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/locations?q=${encodeURIComponent(query)}&limit=8`, []);
  const staffSearchUrl = useCallback((query: string) => {
    const params = new URLSearchParams({ locationId: location.id, q: query, limit: "8" });
    if (selectedServiceId) params.set("serviceId", selectedServiceId);
    return `${tenantApiPrefix()}/api/app/staff?${params.toString()}`;
  }, [location.id, selectedServiceId]);
  const serviceSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/services?${new URLSearchParams({ locationId: location.id, q: query, limit: "8" }).toString()}`, [location.id]);
  const go = (nextLocationId: string, nextEmployeeId: string, nextServiceId: string, nextRosterSearch = "") => {
    const params = new URLSearchParams({ location: nextLocationId, employee: nextEmployeeId, week });
    if (selectedDay) params.set("day", selectedDay);
    if (nextServiceId) params.set("service", nextServiceId);
    if (nextRosterSearch) params.set("staff", nextRosterSearch);
    if (selectedMonthDay) params.set("monthDay", selectedMonthDay);
    params.set("view", fixedView ?? (nextEmployeeId ? "staff" : "team"));
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
        label={titleTerminology(terminology.staffPlural)}
        selectedLabel={teamMode ? rosterSearch : (selectedEmployee?.name ?? "")}
        placeholder={`Search ${terminology.staffPlural}`}
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
