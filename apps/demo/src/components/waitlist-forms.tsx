"use client";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useFormStatus } from "react-dom";
import { useActionState, useEffect, useId, useState } from "react";
import { addWaitlistEntry, saveWaitlistStatus } from "@/app/app/waitlist/actions";
import { ClientPicker } from "@/components/client-picker";
import { OperationalTimeRange } from "@/components/operational-time-range";
import { showSuccessToast } from "@/lib/waybook/toast";
import type { TenantTerminology } from "@/lib/waybook/terminology-labels";

type Location = { id: string; name: string };
type Staff = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };

function WaitlistTimeRange() {
  const hintId = useId();
  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  return <div className="waitlist-time-range">
    <input type="hidden" name="preferredStartTime" value={enabled ? startTime : ""} />
    <input type="hidden" name="preferredEndTime" value={enabled ? endTime : ""} />
    <button type="button" className="waitlist-time-range__toggle" role="switch" aria-label="Set a preferred time" aria-describedby={hintId} aria-checked={enabled} onClick={() => setEnabled((current) => !current)}><span aria-hidden="true" /><span className="waitlist-time-range__copy"><b>Set a preferred time</b><small id={hintId}>Keep this off if any time that day works.</small></span></button>
    {enabled ? <OperationalTimeRange compact label="Preferred appointment window" startTime={startTime} endTime={endTime} onStartTimeChange={setStartTime} onEndTimeChange={setEndTime} /> : null}
  </div>;
}

export function WaitlistForm({ terminology, canCreateClient, canSearchPhone }: { terminology: TenantTerminology; canCreateClient: boolean; canSearchPhone: boolean }) {
  const [state, action, pending] = useActionState(addWaitlistEntry, { error: null, success: null });
  const [locationId, setLocationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [staffQuery, setStaffQuery] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    if (state.success) showSuccessToast(state.success);
  }, [state]);
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { fetch(`${tenantApiPrefix()}/api/app/locations?purpose=waitlist&q=${encodeURIComponent(locationQuery)}&limit=20`).then((response) => response.ok ? response.json() : { items: [] }).then((data: { items: Location[] }) => { if (!cancelled) setLocations(data.items); }).catch(() => { if (!cancelled) setLocations([]); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [locationQuery]);
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { const params = new URLSearchParams({ q: serviceQuery, limit: "20" }); if (locationId) params.set("locationId", locationId); fetch(`${tenantApiPrefix()}/api/app/services?${params.toString()}`).then((response) => response.ok ? response.json() : { items: [] }).then((data: { items: Service[] }) => { if (!cancelled) setServices(data.items); }).catch(() => { if (!cancelled) setServices([]); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [locationId, serviceQuery]);
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { if (!locationId || !serviceId) { setStaff([]); return; } const params = new URLSearchParams({ purpose: "waitlist", locationId, serviceId, q: staffQuery, limit: "20" }); fetch(`${tenantApiPrefix()}/api/app/staff?${params.toString()}`).then((response) => response.ok ? response.json() : { items: [] }).then((data: { items: Staff[] }) => { if (!cancelled) setStaff(data.items); }).catch(() => { if (!cancelled) setStaff([]); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [locationId, serviceId, staffQuery]);
  return <form action={action} className="tenant-drawer-form waitlist-form">
    <ClientPicker name="customerId" terminology={terminology} purpose="waitlist" canCreateClient={canCreateClient} canSearchPhone={canSearchPhone} required />
    <fieldset className="waitlist-form__request"><legend>Appointment request</legend>
    <div className="tenant-drawer-form__grid"><label>Location<input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search location" aria-label="Search waitlist locations" autoComplete="off" /><select name="locationId" required value={locationId} onChange={(event) => { setLocationId(event.target.value); setServiceId(""); }}><option value="" disabled>Choose a location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Service<input value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder="Search service" aria-label="Search waitlist services" autoComplete="off" /><select name="serviceId" required value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="" disabled>Choose a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.durationMinutes} min</option>)}</select></label></div>
    <label>Preferred {terminology.staffPlural} <input value={staffQuery} onChange={(event) => setStaffQuery(event.target.value)} placeholder={locationId && serviceId ? `Search eligible ${terminology.staffPlural}` : "Choose location and service first"} aria-label={`Search eligible waitlist ${terminology.staffPlural}`} autoComplete="off" disabled={!locationId || !serviceId} /><select name="preferredTeamMemberId" defaultValue="" disabled={!locationId || !serviceId}><option value="">No preference</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    </fieldset>
    <fieldset className="waitlist-form__window"><legend>Preferred appointment window <small>Optional</small></legend><label className="waitlist-form__date">Date<input name="preferredLocalDate" type="date" /></label><WaitlistTimeRange /></fieldset>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add to waitlist'}</button>
  </form>;
}

function SaveStatusButton({ changed }: { changed: boolean }) {
  const { pending } = useFormStatus();
  return <button className="waybook-action waybook-action--secondary" type="submit" disabled={!changed || pending}>
    {pending ? "Saving…" : "Save"}
  </button>;
}

export function WaitlistStatusForm({ entryId, status }: { entryId: string; status: string }) {
  const [selection, setSelection] = useState(status);

  return <form action={saveWaitlistStatus} className="waitlist-status-form">
    <input type="hidden" name="entryId" value={entryId} />
    <select name="status" aria-label="Status" value={selection} onChange={(event) => setSelection(event.target.value)}>
      <option value="waiting">Waiting</option>
      <option value="offered">Offer sent</option>
      <option value="booked">Booked</option>
      <option value="cancelled">Cancelled</option>
    </select>
    <SaveStatusButton changed={selection !== status} />
  </form>;
}
