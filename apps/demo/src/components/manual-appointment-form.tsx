"use client";

import { defaultTenantTerminology, titleTerminology, type TenantTerminology } from "@/lib/waybook/terminology-labels";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { createManualBooking, getManualBookingAvailability } from "@/app/app/calendars/actions";
import { SearchPicker } from "@/components/calendar-selectors";

type Location = { id: string; name: string };
type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number; priceCents: number };
type Client = { id: string; name: string; email: string; phone: string | null };
type Slot = { teamMemberId: string; startTime: string };
type Props = { initialLocation: Location; initialMember: Member; initialService: Service | null; fixedStaff?: boolean; defaultDate: string; defaultTime?: string; canLookupClients: boolean; waitlistEntryId?: string; waitlistUnavailable?: boolean; initialClient?: Client; customerName?: string; customerEmail?: string; customerPhone?: string | null; timezone: string; terminology?: TenantTerminology };

const servicePrice = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });

function clock(value: string, timezone: string) { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function dateAt(date: string, offset: number) { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + offset); return result.toISOString().slice(0, 10); }
function localDateKey(timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const value = (name: string) => parts.find((part) => part.type === name)?.value ?? ""; return `${value("year")}-${value("month")}-${value("day")}`; }
function dateLabel(value: string) { const date = new Date(`${value}T12:00:00Z`); return { weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date), day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date), full: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date) }; }

/** Selection lists are searched in bounded windows; availability and writes stay server-authoritative. */
export function ManualAppointmentForm({ initialLocation, initialMember, initialService, fixedStaff = false, defaultDate, defaultTime, canLookupClients, waitlistEntryId, waitlistUnavailable = false, initialClient, customerName, customerEmail, customerPhone, timezone, terminology = defaultTenantTerminology }: Props) {
  const [state, formAction, pending] = useActionState(createManualBooking, { error: null, success: null });
  const [location, setLocation] = useState(initialLocation);
  const [member, setMember] = useState<Member | null>(initialMember);
  const [service, setService] = useState<Service | null>(initialService);
  const [date, setDate] = useState(defaultDate);
  const [dateWindowStart, setDateWindowStart] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [client, setClient] = useState({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" });
  const [selectedClient, setSelectedClient] = useState(initialClient);
  const [showNewClient, setShowNewClient] = useState(false);
  const [checking, setChecking] = useState(true);
  const today = useMemo(() => localDateKey(timezone), [timezone]);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => dateAt(dateWindowStart, index)), [dateWindowStart]);
  const locationId = location.id;
  const teamMemberId = member?.id ?? "";
  const serviceId = service?.id ?? "";
  const timeSlots = slots.filter((slot) => slot.teamMemberId === teamMemberId);
  const locationSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/locations?q=${encodeURIComponent(query)}&limit=8`, []);
  const clientSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/clients?purpose=appointment&q=${encodeURIComponent(query)}&limit=8`, []);
  const serviceSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/services?${new URLSearchParams({ locationId, q: query, limit: "8" }).toString()}`, [locationId]);
  const staffSearchUrl = useCallback((query: string) => `${tenantApiPrefix()}/api/app/staff?${new URLSearchParams({ locationId, q: query, limit: "8" }).toString()}`, [locationId]);
  useEffect(() => { setLocation(initialLocation); setMember(initialMember); setService(initialService); const safeDate = defaultDate < today ? today : defaultDate; setDate(safeDate); setDateWindowStart(safeDate); setTime(defaultTime ?? ""); }, [defaultDate, defaultTime, initialLocation, initialMember, initialService, today]);
  useEffect(() => { setClient({ name: customerName ?? "", email: customerEmail ?? "", phone: customerPhone ?? "" }); }, [customerEmail, customerName, customerPhone]);
  useEffect(() => { let cancelled = false; if (!locationId || !serviceId) { setSlots([]); setChecking(false); return; } setChecking(true); getManualBookingAvailability({ locationId, serviceId, date }).then((result) => { if (!cancelled) setSlots(result.slots); }).catch(() => { if (!cancelled) setSlots([]); }).finally(() => { if (!cancelled) setChecking(false); }); return () => { cancelled = true; }; }, [date, locationId, serviceId]);
  useEffect(() => { if (!checking && !timeSlots.some((slot) => clock(slot.startTime, timezone) === time)) setTime(!waitlistEntryId && timeSlots[0] ? clock(timeSlots[0].startTime, timezone) : ""); }, [checking, time, timeSlots, timezone, waitlistEntryId]);
  const clientLabel = titleTerminology(terminology.client);
  const price = service ? servicePrice.format(service.priceCents / 100) : "";
  const hasClientFields = showNewClient || !canLookupClients || Boolean(waitlistEntryId);
  const clientReady = Boolean(selectedClient || (hasClientFields && client.name.trim() && client.email.includes("@")));

  const slotSelected = timeSlots.some((slot) => clock(slot.startTime, timezone) === time);
  const originalOpeningUnavailable = waitlistEntryId && defaultTime && !checking && !time && date === defaultDate;
  if (waitlistUnavailable && !state.success) return <p role="alert">This waitlist request is no longer available. Return to the waitlist to review it.</p>;

  return <form action={formAction} className="tenant-drawer-form manual-appointment">
    <input type="hidden" name="locationId" value={locationId} /><input type="hidden" name="teamMemberId" value={teamMemberId} /><input type="hidden" name="serviceId" value={serviceId} />
    {waitlistEntryId ? <input type="hidden" name="waitlistEntryId" value={waitlistEntryId} /> : null}
    <section className="manual-appointment__step" aria-label={clientLabel}>
      {selectedClient ? (
        <div className="manual-appointment__selection">
          <input type="hidden" name="customerId" value={selectedClient.id} />
          <div><strong>{selectedClient.name}</strong><span>{selectedClient.email}{selectedClient.phone ? ` · ${selectedClient.phone}` : ""}</span></div>
          <button type="button" className="waybook-action waybook-action--secondary" onClick={() => setSelectedClient(undefined)}>Change</button>
        </div>
      ) : canLookupClients && !waitlistEntryId && !showNewClient ? (
        <>
          <SearchPicker<Client>
            label={`Find a ${terminology.client}`}
            selectedLabel=""
            placeholder="Search by name, email, or phone"
            searchUrl={clientSearchUrl}
            resultsLabel={(item) => [item.name, item.email, item.phone].filter(Boolean).join(" · ")}
            onPick={setSelectedClient}
            createOption={{
              label: `Add ${terminology.client}`,
              onPick: (query) => {
                setClient({ name: query.includes("@") ? "" : query, email: query.includes("@") ? query : "", phone: "" });
                setShowNewClient(true);
              },
            }}
          />
          <button type="button" className="waybook-action waybook-action--secondary" onClick={() => setShowNewClient(true)}>Add {terminology.client}</button>
        </>
      ) : (
          <div className="manual-appointment__client-fields">
            {showNewClient ? <div className="manual-appointment__step-heading"><h3>New {terminology.client}</h3><button type="button" className="waybook-action waybook-action--secondary" onClick={() => setShowNewClient(false)}>Back to search</button></div> : null}
            <label>{clientLabel} name<input name="customerName" readOnly={Boolean(waitlistEntryId)} required value={client.name} onChange={(event) => setClient((current) => ({ ...current, name: event.target.value }))} /></label>
            <div className="tenant-drawer-form__grid">
              <label>Email<input name="customerEmail" type="email" readOnly={Boolean(waitlistEntryId)} required value={client.email} onChange={(event) => setClient((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Phone <small aria-hidden="true">optional</small><input name="customerPhone" type="tel" readOnly={Boolean(waitlistEntryId)} value={client.phone} onChange={(event) => setClient((current) => ({ ...current, phone: event.target.value }))} /></label>
            </div>
          </div>
      )}
    </section>
    <div className="tenant-drawer-form__grid manual-appointment__selectors">
      {waitlistEntryId ? <label>Location<input value={location.name} readOnly /></label> : <SearchPicker<Location> label="Location" selectedLabel={location.name} placeholder="Search locations" searchUrl={locationSearchUrl} resultsLabel={(item) => item.name} onPick={(item) => { setLocation(item); setService(null); if (!fixedStaff) setMember(null); }} />}
      {fixedStaff ? (
        <label>{titleTerminology(terminology.staffPlural)}<input value={initialMember.name} readOnly /></label>
      ) : (
        <SearchPicker<Member> label={titleTerminology(terminology.staffPlural)} selectedLabel={member?.name ?? ""} placeholder={locationId ? `Search ${terminology.staffPlural}` : "Choose a location first"} searchUrl={staffSearchUrl} resultsLabel={(item) => item.name} onPick={setMember} onClear={member ? () => setMember(null) : undefined} />
      )}
    </div>
    <div className="manual-appointment__selectors">{waitlistEntryId ? <label>Service<input value={service?.title ?? ""} readOnly /></label> : <SearchPicker<Service> label="Service" selectedLabel={service ? `${service.title} · ${service.durationMinutes} min` : ""} placeholder="Search services" searchUrl={serviceSearchUrl} resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min · ${servicePrice.format(item.priceCents / 100)}`} onPick={setService} onClear={service ? () => setService(null) : undefined} />}</div>
    <input type="hidden" name="appointmentDate" value={date} /><input type="hidden" name="appointmentTime" value={time} />
    <section className="appointment-reschedule-picker manual-appointment__slot-picker" aria-label="Appointment schedule"><div className="manual-appointment__slot-picker-heading"><strong>Date</strong><span>{checking ? "Checking availability…" : service ? "Choose an available time" : "Choose a service first"}</span></div><div className="appointment-reschedule-picker__navigation" aria-label="Choose another week"><button type="button" aria-label="Previous week" disabled={dateAt(dateWindowStart, -7) < today} onClick={() => setDateWindowStart((current) => dateAt(current, -7))}>←</button><span>{dateLabel(dates[0] ?? dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dates[0] ?? dateWindowStart}T12:00:00Z`))} – {dateLabel(dates.at(-1) ?? dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dates.at(-1) ?? dateWindowStart}T12:00:00Z`))}</span><button type="button" aria-label="Next week" onClick={() => setDateWindowStart((current) => dateAt(current, 7))}>→</button></div><div className="appointment-reschedule-picker__days" role="group" aria-label="Appointment date">{dates.map((value) => { const label = dateLabel(value); return <button type="button" key={value} className={`appointment-reschedule-picker__day${value === date ? " is-selected" : ""}`} aria-pressed={value === date} onClick={() => { if (waitlistEntryId && value !== date) setTime(""); setDate(value); }}><small>{label.weekday}</small><strong>{label.day}</strong><span className="sr-only">{label.full}</span></button>; })}</div><p className="manual-appointment__slot-picker-title">Available times</p><div className="appointment-reschedule-picker__slots" role="group" aria-label="Appointment time">{checking ? <span className="manual-appointment__slot-picker-empty">Checking availability…</span> : !service ? <span className="manual-appointment__slot-picker-empty">Choose a service to see available times.</span> : timeSlots.length ? timeSlots.map((slot) => { const value = clock(slot.startTime, timezone); return <button type="button" key={slot.startTime} className={`appointment-reschedule-picker__slot${value === time ? " is-selected" : ""}`} aria-pressed={value === time} onClick={() => setTime(value)}>{value}</button>; }) : <span className="manual-appointment__slot-picker-empty">No bookable times are available for this {terminology.staffMember} on this date.</span>}</div></section>
    {originalOpeningUnavailable && !state.success ? <p className="manual-appointment__message is-error" role="status">That opening is no longer available. Choose another time.</p> : null}
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <div className="manual-appointment__review">
      {service ? <div><strong>{price}</strong><span>{service.durationMinutes} min{time ? ` · ${dateLabel(date).full}, ${time}` : ""}</span></div> : null}
      <button type="submit" className="waybook-action" disabled={pending || checking || !locationId || !serviceId || !teamMemberId || !slotSelected || !clientReady || waitlistUnavailable}>{pending ? "Confirming…" : "Confirm appointment"}</button>
    </div>
  </form>;
}
