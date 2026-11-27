"use client";

import { defaultTenantTerminology, titleTerminology, type TenantTerminology } from "@/lib/waybook/terminology-labels";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import Link from "next/link";
import { X } from "lucide-react";
import { createManualBooking, getManualBookingAvailability } from "@/app/app/calendars/actions";
import { AppointmentServiceStartSelect } from "@/components/appointment-service-start-select";
import { findEligibleProvider, SearchPicker } from "@/components/calendar-selectors";

type Location = { id: string; name: string };
type Member = { id: string; name: string };
type Service = { id: string; title: string; durationMinutes: number; priceCents: number };
type Client = { id: string; name: string; email: string; phone: string | null };
type Slot = { teamMemberId: string; startTime: string };
type ServiceDraft = { id: string; service: Service | null; member: Member | null; time: string; providerPending?: boolean; editingDetails?: boolean };
type Props = { initialLocation: Location; initialMember: Member; initialService: Service | null; fixedStaff?: boolean; fromCalendarSlot?: boolean; defaultDate: string; defaultTime?: string; canLookupClients: boolean; waitlistEntryId?: string; waitlistUnavailable?: boolean; initialClient?: Client; customerName?: string; customerEmail?: string; customerPhone?: string | null; timezone: string; calendarPath: string; terminology?: TenantTerminology };

const servicePrice = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });

function clock(value: string, timezone: string) { return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function dateAt(date: string, offset: number) { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + offset); return result.toISOString().slice(0, 10); }
function localDateKey(timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const value = (name: string) => parts.find((part) => part.type === name)?.value ?? ""; return `${value("year")}-${value("month")}-${value("day")}`; }
function dateLabel(value: string) { const date = new Date(`${value}T12:00:00Z`); return { weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date), day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(date), full: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date) }; }

/** Selection lists are searched in bounded windows; availability and writes stay server-authoritative. */
export function ManualAppointmentForm({ initialLocation, initialMember, initialService, fixedStaff = false, fromCalendarSlot = false, defaultDate, defaultTime, canLookupClients, waitlistEntryId, waitlistUnavailable = false, initialClient, customerName, customerEmail, customerPhone, timezone, calendarPath, terminology = defaultTenantTerminology }: Props) {
  const [state, formAction, pending] = useActionState(createManualBooking, { error: null, success: null });
  const [location, setLocation] = useState(initialLocation);
  const [member, setMember] = useState<Member | null>(initialMember);
  const [service, setService] = useState<Service | null>(initialService);
  const [additionalServices, setAdditionalServices] = useState<ServiceDraft[]>([]);
  const [editingSchedule, setEditingSchedule] = useState(false);
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
  useEffect(() => { if (!fromCalendarSlot && !checking && !timeSlots.some((slot) => clock(slot.startTime, timezone) === time)) setTime(!waitlistEntryId && timeSlots[0] ? clock(timeSlots[0].startTime, timezone) : ""); }, [checking, fromCalendarSlot, time, timeSlots, timezone, waitlistEntryId]);
  const clientLabel = titleTerminology(terminology.client);
  const totalCents = (service?.priceCents ?? 0) + additionalServices.reduce((sum, row) => sum + (row.service?.priceCents ?? 0), 0);
  const durationMinutes = (service?.durationMinutes ?? 0) + additionalServices.reduce((sum, row) => sum + (row.service?.durationMinutes ?? 0), 0);
  const linkedReady = additionalServices.every((row) => row.service && row.member);
  const editAdditionalService = (id: string, update: Partial<ServiceDraft>) => setAdditionalServices(
    (current) => current.map((row) => row.id === id ? { ...row, ...update } : row),
  );
  async function pickAdditionalService(row: ServiceDraft, index: number, item: Service) {
    if (row.service?.id === item.id) return;
    const previousProvider = index === 0 ? member : additionalServices[index - 1]?.member;
    const candidate = fixedStaff ? null : previousProvider;
    editAdditionalService(row.id, { service: item, member: fixedStaff ? initialMember : null, providerPending: Boolean(candidate) });
    if (!candidate) return;
    const eligible = await findEligibleProvider(locationId, item.id, candidate);
    setAdditionalServices((current) => current.map((entry) =>
      entry.id === row.id && entry.service?.id === item.id && entry.providerPending
        ? { ...entry, providerPending: false, member: entry.member ?? eligible ?? null } : entry,
    ));
  }
  const selectedSlot = timeSlots.find((slot) => clock(slot.startTime, timezone) === time);
  let precedingEnd = selectedSlot && service ? new Date(new Date(selectedSlot.startTime).getTime() + service.durationMinutes * 60_000) : null;
  const suggestedStarts = additionalServices.map((row) => {
    const defaultStart = precedingEnd;
    const start = row.time ? fromZonedTime(`${date}T${row.time}`, timezone) : defaultStart;
    precedingEnd = start && row.service ? new Date(start.getTime() + row.service.durationMinutes * 60_000) : null;
    return { instant: defaultStart?.toISOString(), time: defaultStart ? clock(defaultStart.toISOString(), timezone) : "" };
  });
  const hasClientFields = showNewClient || !canLookupClients || Boolean(waitlistEntryId);
  const clientReady = Boolean(selectedClient || (hasClientFields && client.name.trim() && client.email.includes("@")));

  const slotSelected = Boolean(selectedSlot);
  const compactDraft = !waitlistEntryId;
  const showSchedule = !compactDraft || editingSchedule;
  const slotUnavailable = fromCalendarSlot && !checking && Boolean(time && service) && !slotSelected;
  const originalOpeningUnavailable = waitlistEntryId && defaultTime && !checking && !time && date === defaultDate;
  if (waitlistUnavailable && !state.success) return <p role="alert">This waitlist request is no longer available. Return to the waitlist to review it.</p>;

  return <form action={formAction} className="tenant-drawer-form manual-appointment">
    <div className="manual-appointment__fields">
      <input type="hidden" name="locationId" value={locationId} /><input type="hidden" name="teamMemberId" value={teamMemberId} /><input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="additionalServices" value={JSON.stringify(additionalServices.map((row) => ({ serviceId: row.service?.id ?? "", teamMemberId: row.member?.id ?? "", time: row.time })))} />
      {waitlistEntryId ? <input type="hidden" name="waitlistEntryId" value={waitlistEntryId} /> : null}
      {compactDraft ? <section className="manual-appointment__slot-summary" aria-label="Selected calendar slot">
        <div>
          <strong>{dateLabel(date).full}{time ? ` at ${time}` : ""}</strong>
          <span>{[member?.name, location.name].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" className="waybook-action waybook-action--secondary" aria-expanded={editingSchedule}
          onClick={() => setEditingSchedule((editing) => !editing)}>{editingSchedule ? "Hide slot options" : time ? "Change slot" : "Choose slot"}</button>
      </section> : null}
      {slotUnavailable && !state.success ? <p className="manual-appointment__message is-error" role="status">
        The selected time is unavailable for this service and provider. Change the slot or choose another service.
      </p> : null}
      <section className="manual-appointment__step" aria-label={clientLabel}>
        {selectedClient ? (
          <div className="manual-appointment__selection">
            <input type="hidden" name="customerId" value={selectedClient.id} />
            <div><strong>{selectedClient.name}</strong><span>{selectedClient.email}{selectedClient.phone ? ` · ${selectedClient.phone}` : ""}</span></div>
            <button type="button" className="waybook-action waybook-action--secondary" autoFocus={!initialClient} onClick={() => setSelectedClient(undefined)}>Change</button>
          </div>
        ) : canLookupClients && !waitlistEntryId && !showNewClient ? (
          <>
            <SearchPicker<Client>
              label={`Find a ${terminology.client}`} name="appointmentClientSearch" minimumQueryLength={1} autoFocus
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
              <label>{clientLabel} name<input name="customerName" autoFocus={showNewClient && (!client.name || Boolean(client.email))} readOnly={Boolean(waitlistEntryId)} required value={client.name} onChange={(event) => setClient((current) => ({ ...current, name: event.target.value }))} /></label>
              <div className="tenant-drawer-form__grid">
                <label>Email<input name="customerEmail" type="email" autoFocus={showNewClient && Boolean(client.name) && !client.email} readOnly={Boolean(waitlistEntryId)} required value={client.email} onChange={(event) => setClient((current) => ({ ...current, email: event.target.value }))} /></label>
                <label>Phone <small aria-hidden="true">optional</small><input name="customerPhone" type="tel" readOnly={Boolean(waitlistEntryId)} value={client.phone} onChange={(event) => setClient((current) => ({ ...current, phone: event.target.value }))} /></label>
              </div>
            </div>
        )}
      </section>
      {showSchedule ? <div className="tenant-drawer-form__grid manual-appointment__selectors">
        {waitlistEntryId ? <label>Location<input value={location.name} readOnly /></label> : <SearchPicker<Location> label="Location" selectedLabel={location.name} placeholder="Search locations" searchUrl={locationSearchUrl} resultsLabel={(item) => item.name} onPick={(item) => { if (item.id === locationId) return; setLocation(item); setService(null); setAdditionalServices([]); if (!fixedStaff) setMember(null); }} />}
        {fixedStaff ? (
          <label>{titleTerminology(terminology.staffPlural)}<input value={initialMember.name} readOnly /></label>
        ) : (
          <SearchPicker<Member> label={titleTerminology(terminology.staffPlural)} selectedLabel={member?.name ?? ""} placeholder={locationId ? `Search ${terminology.staffPlural}` : "Choose a location first"} searchUrl={staffSearchUrl} resultsLabel={(item) => item.name} onPick={setMember} onClear={member ? () => setMember(null) : undefined} />
        )}
      </div> : null}
      <div className="manual-appointment__selectors">{waitlistEntryId ? <label>Service<input value={service?.title ?? ""} readOnly /></label> :
        <SearchPicker<Service> label="Service" minimumQueryLength={1} browseOnFocus autoFocus={false}
          selectedLabel={service ? `${service.title} · ${service.durationMinutes} min` : ""}
          selectedDetail={service ? servicePrice.format(service.priceCents / 100) : undefined}
          placeholder="Search services" searchUrl={serviceSearchUrl}
          resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min`}
          resultsDetail={(item) => servicePrice.format(item.priceCents / 100)}
          onPick={setService} onClear={service ? () => setService(null) : undefined} />}
      </div>
      {service ? <section className="manual-appointment__step" aria-label="Additional services">
        {additionalServices.map((row, index) => <fieldset className="manual-appointment__step manual-appointment__service-row" key={row.id}>
          <legend>Service {index + 2}</legend>
          <button type="button" className="appointment-service-remove" aria-label={`Remove service ${index + 2}`}
            onClick={() => setAdditionalServices((current) => current.filter((item) => item.id !== row.id))}>
            <X size={16} aria-hidden="true" />
          </button>
          <SearchPicker<Service>
            label={`Service ${index + 2}`} hideLabel minimumQueryLength={1} browseOnFocus selectedLabel={row.service ? `${row.service.title} · ${row.service.durationMinutes} min` : ""}
            selectedDetail={row.service ? servicePrice.format(row.service.priceCents / 100) : undefined}
            placeholder="Search services" searchUrl={serviceSearchUrl}
            resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min`}
            resultsDetail={(item) => servicePrice.format(item.priceCents / 100)}
            onPick={(item) => void pickAdditionalService(row, index, item)}
          />
          {compactDraft && row.service && row.member ? <div className="manual-appointment__service-summary">
            <span>{[row.member.name, row.time || suggestedStarts[index].time, `${row.service.durationMinutes} min`].filter(Boolean).join(" · ")}</span>
            <button type="button" className="waybook-action waybook-action--secondary"
              aria-expanded={Boolean(row.editingDetails)} aria-label={`Change provider or time for service ${index + 2}`}
              onClick={() => editAdditionalService(row.id, { editingDetails: !row.editingDetails })}>
              {row.editingDetails ? "Hide options" : "Change"}
            </button>
          </div> : null}
          {compactDraft && row.providerPending ? <p role="status" className="tenant-drawer-note">Checking provider availability…</p> : null}
          {(!compactDraft || row.service && !row.providerPending && (!row.member || row.editingDetails)) ? <div className="tenant-drawer-form__grid">
            {fixedStaff || !row.service ? <label>{`Provider for service ${index + 2}`}<input readOnly disabled={!fixedStaff} value={fixedStaff ? initialMember.name : ""} placeholder="Choose a service first" /></label> : <SearchPicker<Member>
              label={`Provider for service ${index + 2}`} selectedLabel={row.member?.name ?? ""}
              placeholder="Search eligible staff" resultsLabel={(item) => item.name}
              searchUrl={(query) => row.service ? `${tenantApiPrefix()}/api/app/staff?${new URLSearchParams({ locationId, serviceId: row.service.id, q: query, limit: "8" })}` : ""}
              onPick={(item) => editAdditionalService(row.id, { member: item })}
            />}
            <AppointmentServiceStartSelect label="Start time" locationId={locationId} date={date}
              serviceId={row.service?.id} providerId={row.member?.id} earliest={suggestedStarts[index].instant}
              sequentialTime={suggestedStarts[index].time} value={row.time}
              onChange={(time) => editAdditionalService(row.id, { time })} />
          </div> : null}
        </fieldset>)}
        {additionalServices.length < 5 ? <button type="button" className="waybook-action waybook-action--secondary" onClick={() => setAdditionalServices((current) => [...current, { id: crypto.randomUUID(), service: null, member: fixedStaff ? initialMember : null, time: "" }])}>Add service</button> : null}
      </section> : null}
      <input type="hidden" name="appointmentDate" value={date} /><input type="hidden" name="appointmentTime" value={time} />
      {showSchedule ? <section className="appointment-reschedule-picker manual-appointment__slot-picker" aria-label="Appointment schedule">
        <div className="manual-appointment__slot-picker-heading">
          <strong>Date</strong><span>{checking ? "Checking availability…" : service ? "Choose an available time" : "Choose a service first"}</span>
        </div>
        <div className="appointment-reschedule-picker__navigation" aria-label="Choose another week">
          <button type="button" className="waybook-action--secondary" aria-label="Previous week" disabled={dateAt(dateWindowStart, -7) < today}
            onClick={() => setDateWindowStart((current) => dateAt(current, -7))}>←</button>
          <span>{dateLabel(dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dateWindowStart}T12:00:00Z`))}
            {" – "}{dateLabel(dates.at(-1) ?? dateWindowStart).day} {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${dates.at(-1) ?? dateWindowStart}T12:00:00Z`))}
          </span>
          <button type="button" className="waybook-action--secondary" aria-label="Next week" onClick={() => setDateWindowStart((current) => dateAt(current, 7))}>→</button>
        </div>
        <div className="appointment-reschedule-picker__days" role="group" aria-label="Appointment date">
          {dates.map((value) => {
            const label = dateLabel(value);
            return <button type="button" key={value} className={`appointment-reschedule-picker__day${value === date ? " is-selected" : ""}`}
              aria-pressed={value === date} onClick={() => {
                if ((waitlistEntryId || fromCalendarSlot) && value !== date) setTime("");
                setDate(value);
              }}>
              <small>{label.weekday}</small><strong>{label.day}</strong><span className="sr-only">{label.full}</span>
            </button>;
          })}
        </div>
        <p className="manual-appointment__slot-picker-title">Available times</p>
        <div className="appointment-reschedule-picker__slots" role="group" aria-label="Appointment time">
          {checking ? <span className="manual-appointment__slot-picker-empty">Checking availability…</span>
            : !service ? <span className="manual-appointment__slot-picker-empty">Choose a service to see available times.</span>
            : timeSlots.length ? timeSlots.map((slot) => {
              const value = clock(slot.startTime, timezone);
              return <button type="button" key={slot.startTime}
                className={`appointment-reschedule-picker__slot${value === time ? " is-selected" : ""}`}
                aria-pressed={value === time} onClick={() => setTime(value)}>{value}</button>;
            }) : <span className="manual-appointment__slot-picker-empty">No bookable times are available for this {terminology.staffMember} on this date.</span>}
        </div>
      </section> : null}
      {originalOpeningUnavailable && !state.success ? <p className="manual-appointment__message is-error" role="status">That opening is no longer available. Choose another time.</p> : null}
    </div>
    <div className="manual-appointment__review">
      {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
      {service ? <div><strong>{servicePrice.format(totalCents / 100)}</strong><span>{durationMinutes} min{!compactDraft && time ? ` · ${dateLabel(date).full}, ${time}` : ""}</span></div> : null}
      {state.booking ? <Link className="waybook-primary-link" data-appointment-navigation href={`${calendarPath}?${new URLSearchParams({ view: "team", location: state.booking.locationId, day: state.booking.date, booking: state.booking.id })}`}>View appointment</Link> :
        <button type="submit" className="waybook-action" disabled={pending || checking || !locationId || !serviceId || !teamMemberId || !slotSelected || !clientReady || !linkedReady || waitlistUnavailable}>{pending ? "Confirming…" : "Confirm appointment"}</button>}
    </div>
  </form>;
}
