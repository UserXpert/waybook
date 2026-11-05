"use client";

import { usePathname, useRouter } from "next/navigation";

type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };

export function CalendarSelectors({ members, services, employeeId, serviceId, week }: { members: Member[]; services: Service[]; employeeId: string; serviceId?: string; week: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (employee: string, service: string) => {
    const params = new URLSearchParams({ employee, week });
    if (service) params.set("service", service);
    router.push(`${pathname}?${params.toString()}`);
  };
  return <div className="calendar-selectors">
    <label>Employee<select value={employeeId} onChange={(event) => go(event.target.value, "")}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    <label>Service<select value={serviceId ?? ""} onChange={(event) => go(employeeId, event.target.value)} disabled={services.length === 0}><option value="">{services.length === 0 ? "No service assigned" : "Choose a service"}</option>{services.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.durationMinutes} min</option>)}</select></label>
  </div>;
}
