"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createManualBooking, getManualBookingAvailability } from "@/app/app/calendars/actions";

type Location = { id: string; name: string };
type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };
type Assignment = { locationId: string; teamMemberId: string; serviceId: string };
type Resource = { id: string; name: string; resourceType: string; capacity: number };
type Slot = { teamMemberId: string; startTime: string; resourceId: string | null };
type Props = { locations: Location[]; members: Member[]; services: Service[]; assignments: Assignment[]; locationId: string; teamMemberId: string; serviceId: string; defaultDate: string; defaultTime?: string; customerName?: string; customerEmail?: string; customerPhone?: string | null; timezone: string };

function clock(value: string, timezone: string) { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function dateAt(date: string, offset: number) { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + offset); return result.toISOString().slice(0, 10); }
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date),
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date),
    full: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date),
  };
}

export function ManualAppointmentForm({ locations, members, services, assignments, locationId: initialLocationId, teamMemberId: initialTeamMemberId, serviceId: initialServiceId, defaultDate, defaultTime, customerName, customerEmail, customerPhone, timezone }: Props) {
  const [state, formAction, pending] = useActionState(createManualBooking, { error: null, success: null });
  const [locationId, setLocationId] = useState(initialLocationId);
  const [teamMemberId, setTeamMemberId] = useState(initialTeamMemberId);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [client, setClient] = useState({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" });
  const [checking, setChecking] = useState(true);
  const eligibleMembers = useMemo(() => members.filter((member) => assignments.some((item) => item.locationId === locationId && item.serviceId === serviceId && item.teamMemberId === member.id)), [assignments, locationId, members, serviceId]);
  const eligibleServices = useMemo(() => services.filter((service) => assignments.some((item) => item.locationId === locationId && item.teamMemberId === teamMemberId && item.serviceId === service.id)), [assignments, locationId, services, teamMemberId]);
  const timeSlots = slots.filter((slot) => slot.teamMemberId === teamMemberId);
  const selectedSlot = timeSlots.find((slot) => clock(slot.startTime, timezone) === time);
  const selectedResource = resources.find((resource) => resource.id === selectedSlot?.resourceId) ?? null;
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => dateAt(defaultDate, index)), [defaultDate]);
  // Opening the drawer from a calendar cell can replace its props without
  // remounting this client form. Keep its controls tied to that requested
  // cell, then let the availability response validate the requested start.
  useEffect(() => {
    setLocationId(initialLocationId);
    setTeamMemberId(initialTeamMemberId);
    setServiceId(initialServiceId);
    setDate(defaultDate);
    setTime(defaultTime ?? "");
  }, [defaultDate, defaultTime, initialLocationId, initialServiceId, initialTeamMemberId]);
  // Server action errors re-render this component. Keep the operator's client
  // details in React state so a rejected booking can be corrected and retried.
  useEffect(() => {
    setClient({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" });
  }, [customerEmail, customerName, customerPhone, defaultDate, defaultTime, initialLocationId, initialServiceId, initialTeamMemberId]);
  useEffect(() => { let cancelled = false; setChecking(true); getManualBookingAvailability({ locationId, serviceId, date }).then((result) => { if (!cancelled) { setSlots(result.slots); setResources(result.resources); setResourceId((current) => result.resources.some((resource) => resource.id === current) ? current : ""); } }).catch(() => { if (!cancelled) { setSlots([]); setResources([]); } }).finally(() => { if (!cancelled) setChecking(false); }); return () => { cancelled = true; }; }, [date, locationId, serviceId]);
  useEffect(() => {
    if (checking) return;
    if (!timeSlots.some((slot) => clock(slot.startTime, timezone) === time)) {
      setTime(timeSlots[0] ? clock(timeSlots[0].startTime, timezone) : "");
    }
  }, [checking, time, timeSlots, timezone]);
  // A slot carries the exact resource the availability engine reserved for it.
  // Binding the form to that resource prevents a visible slot being rejected
  // because a different, occupied room/equipment item was manually selected.
  useEffect(() => {
    setResourceId(selectedSlot?.resourceId ?? "");
  }, [selectedSlot?.resourceId]);
  const chooseLocation = (next: string) => { const candidate = assignments.find((item) => item.locationId === next && item.teamMemberId === teamMemberId && item.serviceId === serviceId) ?? assignments.find((item) => item.locationId === next); if (candidate) { setLocationId(next); setTeamMemberId(candidate.teamMemberId); setServiceId(candidate.serviceId); } };
  const chooseMember = (next: string) => { const candidate = assignments.find((item) => item.locationId === locationId && item.teamMemberId === next && item.serviceId === serviceId) ?? assignments.find((item) => item.locationId === locationId && item.teamMemberId === next); if (candidate) { setTeamMemberId(next); setServiceId(candidate.serviceId); } };
  const chooseService = (next: string) => { const candidate = assignments.find((item) => item.locationId === locationId && item.teamMemberId === teamMemberId && item.serviceId === next) ?? assignments.find((item) => item.locationId === locationId && item.serviceId === next); if (candidate) { setServiceId(next); setTeamMemberId(candidate.teamMemberId); } };
  return <form action={formAction} className="tenant-drawer-form">
    <input type="hidden" name="locationId" value={locationId} /><input type="hidden" name="teamMemberId" value={teamMemberId} /><input type="hidden" name="serviceId" value={serviceId} />
    <p>Choose the appointment details. Availability is checked live and once more before confirmation.</p>
    <div className="tenant-drawer-form__grid"><label>Location<select value={locationId} onChange={(event) => chooseLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Staff<select value={teamMemberId} onChange={(event) => chooseMember(event.target.value)}>{eligibleMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
    <label>Service<select value={serviceId} onChange={(event) => chooseService(event.target.value)}>{eligibleServices.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.durationMinutes} min</option>)}</select></label>
    <label>Client name<input name="customerName" required value={client.name} onChange={(event) => setClient((current) => ({ ...current, name: event.target.value }))} /></label><label>Email<input name="customerEmail" type="email" required value={client.email} onChange={(event) => setClient((current) => ({ ...current, email: event.target.value }))} /></label><label>Phone<input name="customerPhone" type="tel" value={client.phone} onChange={(event) => setClient((current) => ({ ...current, phone: event.target.value }))} /></label>
    {resources.length ? <><input type="hidden" name="resourceId" value={resourceId} /><label>Required resource<select value={resourceId} disabled aria-describedby="resource-help"><option value="">Choose an available time</option>{selectedResource ? <option value={selectedResource.id}>{selectedResource.name} · {selectedResource.resourceType}{selectedResource.capacity > 1 ? ` · capacity ${selectedResource.capacity}` : ""}</option> : null}</select><small id="resource-help">Assigned from the live availability for the selected time.</small></label></> : null}
    <input type="hidden" name="appointmentDate" value={date} /><input type="hidden" name="appointmentTime" value={time} />
    <section className="appointment-reschedule-picker manual-appointment__slot-picker" aria-label="Appointment schedule">
      <div className="manual-appointment__slot-picker-heading"><strong>Date</strong><span>{checking ? "Checking availability…" : "Choose an available time"}</span></div>
      <div className="appointment-reschedule-picker__days" role="group" aria-label="Appointment date">
        {dates.map((value) => { const label = dateLabel(value); return <button type="button" key={value} className={`appointment-reschedule-picker__day${value === date ? " is-selected" : ""}`} aria-pressed={value === date} onClick={() => setDate(value)}><small>{label.weekday}</small><strong>{label.day}</strong><span className="sr-only">{label.full}</span></button>; })}
      </div>
      <p className="manual-appointment__slot-picker-title">Available times</p>
      <div className="appointment-reschedule-picker__slots" role="group" aria-label="Appointment time">
        {checking ? <span className="manual-appointment__slot-picker-empty">Checking availability…</span> : timeSlots.length ? timeSlots.map((slot) => { const value = clock(slot.startTime, timezone); return <button type="button" key={slot.startTime} className={`appointment-reschedule-picker__slot${value === time ? " is-selected" : ""}`} aria-pressed={value === time} onClick={() => setTime(value)}>{value}</button>; }) : <span className="manual-appointment__slot-picker-empty">No bookable times are available for this staff member on this date.</span>}
      </div>
    </section>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || checking || !time || (resources.length > 0 && !resourceId)}>{pending ? "Confirming…" : "Confirm appointment"}</button>
  </form>;
}
