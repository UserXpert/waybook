"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };
type Location = { id: string; name: string };

export function CalendarSelectors({ locations, locationId, members, services, employeeId, serviceId, week }: { locations: Location[]; locationId?: string; members: Member[]; services: Service[]; employeeId?: string; serviceId?: string; week: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The server resolves a concrete default location when the URL is empty.
  // Reflect that same value in the control; an "All locations" label cannot
  // truthfully represent a board backed by one location's availability.
  const selectedLocationId = searchParams.get("location") ?? locationId ?? "";
  const selectedEmployeeId = searchParams.get("employee") ?? "";
  const selectedServiceId = searchParams.get("service") ?? "";
  const selectedDay = searchParams.get("day") ?? "";
  const go = (location: string, employee: string, service: string) => {
    const params = new URLSearchParams({ location, employee, week });
    if (selectedDay) params.set("day", selectedDay);
    if (service) params.set("service", service);
    if (employee) params.set("view", "staff");
    else params.set("view", "team");
    router.push(`${pathname}?${params.toString()}`);
  };
  return <div className="calendar-selectors">
    <label>Location<select value={selectedLocationId} onChange={(event) => go(event.target.value, "", "")}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    <label>Employee<select value={selectedEmployeeId} onChange={(event) => go(selectedLocationId, event.target.value, "")}><option value="">All staff · Day view</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · Week view</option>)}</select></label>
    <label>Service<select value={selectedServiceId} onChange={(event) => go(selectedLocationId, selectedEmployeeId, event.target.value)} disabled={services.length === 0}><option value="">{services.length === 0 ? "No services available" : "All services"}</option>{services.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.durationMinutes} min</option>)}</select></label>
  </div>;
}
