"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { createManualBooking, getManualBookingAvailability } from "@/app/app/calendars/actions";
import { SearchPicker } from "@/components/calendar-selectors";

type Location = { id: string; name: string };
type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number };
type Slot = { teamMemberId: string; startTime: string };
type Props = { initialLocation: Location; initialMember: Member; initialService: Service; defaultDate: string; defaultTime?: string; customerName?: string; customerEmail?: string; customerPhone?: string | null; timezone: string };

function clock(value: string, timezone: string) { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function dateAt(date: string, offset: number) { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + offset); return result.toISOString().slice(0, 10); }
function localDateKey(timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const value = (name: string) => parts.find((part) => part.type === name)?.value ?? ""; return `${value("year")}-${value("month")}-${value("day")}`; }
function dateLabel(value: string) { const date = new Date(`${value}T12:00:00Z`); return { weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date), day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date), full: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date) }; }

/** Selection lists are searched in bounded windows; availability and writes stay server-authoritative. */
export function ManualAppointmentForm({ initialLocation, initialMember, initialService, defaultDate, defaultTime, customerName, customerEmail, customerPhone, timezone }: Props) {
  const [state, formAction, pending] = useActionState(createManualBooking, { error: null, success: null });
  const [location, setLocation] = useState(initialLocation);
  const [member, setMember] = useState<Member | null>(initialMember);
  const [service, setService] = useState<Service | null>(initialService);
  const [date, setDate] = useState(defaultDate);
  const [dateWindowStart, setDateWindowStart] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [client, setClient] = useState({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" });
  const [checking, setChecking] = useState(true);
  const today = useMemo(() => localDateKey(timezone), [timezone]);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => dateAt(dateWindowStart, index)), [dateWindowStart]);
  const locationId = location.id;
  const teamMemberId = member?.id ?? "";
  const serviceId = service?.id ?? "";
  const timeSlots = slots.filter((slot) => slot.teamMemberId === teamMemberId);
  const locationSearchUrl = useCallback((query: string) => `/api/app/locations?q=${encodeURIComponent(query)}&limit=8`, []);
  const serviceSearchUrl = useCallback((query: string) => `/api/app/services?${new URLSearchParams({ locationId, q: query, limit: "8" }).toString()}`, [locationId]);
  const staffSearchUrl = useCallback((query: string) => `/api/app/staff?${new URLSearchParams({ locationId, q: query, limit: "8" }).toString()}`, [locationId]);
  useEffect(() => { setLocation(initialLocation); setMember(initialMember); setService(initialService); const safeDate = defaultDate < today ? today : defaultDate; setDate(safeDate); setDateWindowStart(safeDate); setTime(defaultTime ?? ""); }, [defaultDate, defaultTime, initialLocation, initialMember, initialService, today]);
  useEffect(() => { setClient({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" }); }, [customerEmail, customerName, customerPhone]);
  useEffect(() => { let cancelled = false; if (!locationId || !serviceId) { setSlots([]); setChecking(false); return; } setChecking(true); getManualBookingAvailability({ locationId, serviceId, date }).then((result) => { if (!cancelled) setSlots(result.slots); }).catch(() => { if (!cancelled) setSlots([]); }).finally(() => { if (!cancelled) setChecking(false); }); return () => { cancelled = true; }; }, [date, locationId, serviceId]);
  useEffect(() => { if (!checking && !timeSlots.some((slot) => clock(slot.startTime, timezone) === time)) setTime(timeSlots[0] ? clock(timeSlots[0].startTime, timezone) : ""); }, [checking, time, timeSlots, timezone]);
  return <form action={formAction} className="tenant-drawer-form">
    <input type="hidden" name="locationId" value={locationId} /><input type="hidden" name="teamMemberId" value={teamMemberId} /><input type="hidden" name="serviceId" value={serviceId} />
    <p>Choose the appointment details. Availability is checked live and once more before confirmation.</p>
    <div className="tenant-drawer-form__grid manual-appointment__selectors"><SearchPicker<Location> label="Location" selectedLabel={location.name} placeholder="Search locations" searchUrl={locationSearchUrl} resultsLabel={(item) => item.name} onPick={(item) => { setLocation(item); setService(null); setMember(null); }} /><SearchPicker<Member> label="Staff" selectedLabel={member?.name ?? ""} placeholder={locationId ? "Search staff" : "Choose a location first"} searchUrl={staffSearchUrl} resultsLabel={(item) => item.name} onPick={setMember} onClear={member ? () => setMember(null) : undefined} /></div>
    <div className="manual-appointment__selectors"><SearchPicker<Service> label="Service" selectedLabel={service ? `${service.title} · ${service.durationMinutes} min` : ""} placeholder="Search services" searchUrl={serviceSearchUrl} resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min`} onPick={setService} onClear={service ? () => setService(null) : undefined} /></div>
    <label>Client name<input name="customerName" required value={client.name} onChange={(event) => setClient((current) => ({ ...current, name: event.target.value }))} /></label><label>Email<input name="customerEmail" type="email" required value={client.email} onChange={(event) => setClient((current) => ({ ...current, email: event.target.value }))} /></label><label>Phone<input name="customerPhone" type="tel" value={client.phone} onChange={(event) => setClient((current) => ({ ...current, phone: event.target.value }))} /></label>
    <input type="hidden" name="appointmentDate" value={date} /><input type="hidden" name="appointmentTime" value={time} />
    <section className="appointment-reschedule-picker manual-appointment__slot-picker" aria-label="Appointment schedule"><div className="manual-appointment__slot-picker-heading"><strong>Date</strong><span>{checking ? "Checking availability…" : "Choose an available time"}</span></div><div className="appointment-reschedule-picker__navigation" aria-label="Choose another week"><button type="button" aria-label="Previous week" disabled={dateAt(dateWindowStart, -7) < today} onClick={() => setDateWindowStart((current) => dateAt(current, -7))}>←</button><span>{dateLabel(dates[0] ?? dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dates[0] ?? dateWindowStart}T12:00:00Z`))} – {dateLabel(dates.at(-1) ?? dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dates.at(-1) ?? dateWindowStart}T12:00:00Z`))}</span><button type="button" aria-label="Next week" onClick={() => setDateWindowStart((current) => dateAt(current, 7))}>→</button></div><div className="appointment-reschedule-picker__days" role="group" aria-label="Appointment date">{dates.map((value) => { const label = dateLabel(value); return <button type="button" key={value} className={`appointment-reschedule-picker__day${value === date ? " is-selected" : ""}`} aria-pressed={value === date} onClick={() => setDate(value)}><small>{label.weekday}</small><strong>{label.day}</strong><span className="sr-only">{label.full}</span></button>; })}</div><p className="manual-appointment__slot-picker-title">Available times</p><div className="appointment-reschedule-picker__slots" role="group" aria-label="Appointment time">{checking ? <span className="manual-appointment__slot-picker-empty">Checking availability…</span> : timeSlots.length ? timeSlots.map((slot) => { const value = clock(slot.startTime, timezone); return <button type="button" key={slot.startTime} className={`appointment-reschedule-picker__slot${value === time ? " is-selected" : ""}`} aria-pressed={value === time} onClick={() => setTime(value)}>{value}</button>; }) : <span className="manual-appointment__slot-picker-empty">No bookable times are available for this staff member on this date.</span>}</div></section>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || checking || !locationId || !serviceId || !teamMemberId || !time}>{pending ? "Confirming…" : "Confirm appointment"}</button>
  </form>;
}
