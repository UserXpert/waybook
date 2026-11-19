"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ActiveFilters = {
  location?: { name: string; isExplicit: boolean };
  staff?: { name: string; id: string };
  service?: { name: string; id: string };
  rosterSearch?: string;
  excludesOffShift?: boolean;
  dayFallback: string;
};

/** Shows only choices a person actively made. The automatically chosen working
 * location remains context, rather than masquerading as a removable filter. */
export function CalendarActiveFilters({
  location,
  staff,
  service,
  rosterSearch,
  excludesOffShift,
  dayFallback,
}: ActiveFilters) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const remove = (name: "location" | "staff" | "service" | "roster" | "availability") => {
    const params = new URLSearchParams(searchParams.toString());
    if (name === "location") {
      // Staff and services are scoped to a location. Return to the safe default
      // location instead of carrying IDs that may not be authorised there.
      ["location", "employee", "service", "staff", "after", "before"].forEach((key) => params.delete(key));
      if (params.get("view") === "staff") params.set("view", "team");
      if (!params.get("day")) params.set("day", dayFallback);
    } else if (name === "staff") {
      params.delete("employee");
      if (params.get("view") === "staff") params.set("view", "team");
      if (!params.get("day")) params.set("day", dayFallback);
    } else if (name === "service") {
      params.delete("service");
    } else if (name === "roster") {
      ["staff", "after", "before"].forEach((key) => params.delete(key));
    } else {
      params.delete("showOffShift");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const chips = [
    location?.isExplicit ? { key: "location" as const, label: `Location: ${location.name}` } : null,
    staff ? { key: "staff" as const, label: `Staff: ${staff.name}` } : null,
    service ? { key: "service" as const, label: `Service: ${service.name}` } : null,
    rosterSearch ? { key: "roster" as const, label: `Roster: ${rosterSearch}` } : null,
    excludesOffShift ? { key: "availability" as const, label: "Availability: on shift" } : null,
  ].filter((chip): chip is { key: "location" | "staff" | "service" | "roster" | "availability"; label: string } => Boolean(chip));

  if (!chips.length) return null;
  return <div className="calendar-active-filters" aria-label="Applied calendar filters">
    {chips.map((chip) => <span className="calendar-active-filters__chip" key={chip.key}>
      <span>{chip.label}</span>
      <button type="button" aria-label={`Remove ${chip.label} filter`} onClick={() => remove(chip.key)}><X size={13} aria-hidden="true" /></button>
    </span>)}
  </div>;
}
