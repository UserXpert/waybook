"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fromZonedTime } from "date-fns-tz";
import { BookingLocationPicker } from "@/components/booking-location-picker";
import { ArrowLeft } from "lucide-react";
import { BookingProgress } from "@/components/booking-progress";
import { BookingManagementDialog } from "@/components/booking-management-dialog";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number };
type TeamMember = { id: string; name: string; serviceId: string };
type Location = { id: string; name: string; locationType: string };
type Slot = { startTime: string; endTime: string; localStart: string; localEnd: string };
type Availability = { teamMemberId: string; slots: Slot[] };
type AssignedMember = { id: string; name: string };
type Step = "service" | "time" | "details" | "complete";
type Props = { launcherLabel?: string; launcherPosition?: "left" | "right"; bookingTheme?: "light" | "dark"; managementEnabled?: boolean; initialManage?: boolean; tenantSlug: string; tenantName: string; timezone: string; currency: string; services: Service[]; teamMembers: TeamMember[]; locations: Location[]; initialLocationId?: string; initialServiceId?: string; embedSource?: string; embedToken?: string; intro?: string; contact?: string; logoUrl?: string; panelImageUrl?: string; panelOverlayColor?: string; panelTitle?: string; panelCopy?: string; policyVersion?: string; policyUrl?: string; policyText?: string; serviceStepTitle?: string; timeStepTitle?: string; detailsStepTitle?: string; brandColor?: string; showPrices: boolean };

function isoDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function clockTime(slot: Slot, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(slot.startTime));
}

function fullDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(new Date(instant));
}

function price(priceCents: number, currency: string) {
  return new Intl.NumberFormat("en-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(priceCents / 100);
}

export function PublicBookingFlow({ launcherLabel = "Book now", launcherPosition = "right", bookingTheme = "light", managementEnabled = false, initialManage = false, tenantSlug, tenantName, timezone, currency, services, teamMembers, locations, initialLocationId, initialServiceId, embedSource, embedToken, intro, contact, logoUrl, panelImageUrl, panelOverlayColor, panelTitle, panelCopy, policyVersion, policyUrl, policyText, serviceStepTitle, timeStepTitle, detailsStepTitle, brandColor, showPrices }: Props) {
  const [step, setStep] = useState<Step>("service");
  const [bookingOpen, setBookingOpen] = useState(true);
  const [manageOpen, setManageOpen] = useState(managementEnabled && initialManage);
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  const [locationId, setLocationId] = useState(() => initialLocationId ?? locations[0]?.id ?? "");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationOptions, setLocationOptions] = useState<Location[]>(locations);
  const [date, setDate] = useState(() => isoDateInTimezone(new Date(), timezone));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [assignedMember, setAssignedMember] = useState<AssignedMember | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<{ id: string; bookingNumber: string; startsAt: string } | null>(null);
  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const upcomingDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const value = new Date(); value.setDate(value.getDate() + index);
    return isoDateInTimezone(value, timezone);
  }), [timezone]);
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { fetch(`/${tenantSlug}/api/public/locations?q=${encodeURIComponent(locationQuery)}&limit=20`).then((response) => response.ok ? response.json() : { items: [] }).then((data: { items: Location[] }) => { if (!cancelled) { setLocationOptions(data.items); } }).catch(() => { if (!cancelled) setLocationOptions(locations); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [locationId, locationQuery, locations, tenantSlug]);

  const fetchSlots = async (selectedDate: string, service = selectedService) => {
    if (!service || !teamMembers.some(member => member.serviceId === service.id)) { setStatus("This service has no available staff member yet."); return; }
    setIsLoading(true); setStatus(""); setSelectedSlot(null); setHoldId(null); setIdempotencyKey(null);
    const startsAt = fromZonedTime(`${selectedDate}T00:00:00`, timezone);
    const endsAt = fromZonedTime(`${selectedDate}T23:59:59.999`, timezone);
    const response = await fetch(`/${tenantSlug}/api/public/availability?service=${encodeURIComponent(service.id)}&location=${encodeURIComponent(locationId)}&start=${encodeURIComponent(new Date(startsAt.getTime() - 24 * 60 * 60_000).toISOString())}&end=${encodeURIComponent(new Date(endsAt.getTime() + 24 * 60 * 60_000).toISOString())}`);
    const payload = await response.json();
    setIsLoading(false);
    if (!response.ok) { setSlots([]); setStatus(payload.error ?? "Could not find availability."); return; }
    const deduplicated = new Map<string, Slot>();
    for (const provider of payload.availability as Availability[]) {
      for (const slot of provider.slots) {
        if (isoDateInTimezone(new Date(slot.startTime), timezone) === selectedDate) {
          deduplicated.set(`${slot.startTime}:${slot.endTime}`, slot);
        }
      }
    }
    const available = [...deduplicated.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
    setSlots(available);
    if (!available.length) setStatus("No times are available on this date. Try another day.");
  };

  const chooseService = async (nextServiceId: string) => {
    const service = services.find(item => item.id === nextServiceId);
    if (!locationId || !service) { setStatus("Choose a location before selecting a service."); return; }
    setServiceId(nextServiceId); setStatus(""); setSlots([]); setSelectedSlot(null); setHoldId(null); setAssignedMember(null); setIdempotencyKey(null);
    setStep("time"); await fetchSlots(date, service);
  };
  const chooseDate = async (nextDate: string) => { setDate(nextDate); await fetchSlots(nextDate); };
  const reserveSlot = async (slot: Slot) => {
    if (!selectedService) return;
    setIsLoading(true); setStatus("");
    const response = await fetch(`/${tenantSlug}/api/public/holds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: selectedService.id, locationId, startsAt: slot.startTime, endsAt: slot.endTime }) });
    const payload = await response.json();
    setIsLoading(false);
    if (!response.ok) { setStatus(payload.error ?? "That time is no longer available."); return; }
    setSelectedSlot(slot); setHoldId(payload.holdId); setAssignedMember(payload.teamMember); setIdempotencyKey(crypto.randomUUID()); setStep("details");
  };
  const confirm = async (formData: FormData) => {
    if (!holdId || !idempotencyKey) return;
    setIsLoading(true); setStatus("");
    const response = await fetch(`/${tenantSlug}/api/public/confirmations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holdId, idempotencyKey, acceptedPolicy: formData.get("acceptedPolicy") === "on", embedSource, embedToken, customer: { name: formData.get("name"), email: formData.get("email"), phone: formData.get("phone") } }) });
    const payload = await response.json();
    setIsLoading(false);
    if (!response.ok) { setStatus(payload.error ?? "Could not confirm the booking."); return; }
    setConfirmation(payload.booking); setStep("complete");
  };
  const reset = () => { setStep("service"); setServiceId(""); setSlots([]); setSelectedSlot(null); setHoldId(null); setAssignedMember(null); setIdempotencyKey(null); setStatus(""); setConfirmation(null); };
  const goBack = () => { if (step === "time") setStep("service"); if (step === "details") setStep("time"); };
  const progress = step === "service" ? 1 : step === "time" ? 2 : 3;

  const panelStyle = panelImageUrl ? { backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${panelOverlayColor ?? brandColor ?? "#1f2937"} 90%, transparent), color-mix(in srgb, ${panelOverlayColor ?? brandColor ?? "#1f2937"} 68%, transparent)), url("${panelImageUrl}")` } : undefined;
  return <main className={`tenant-booking-page${embedSource ? " tenant-booking-page--embedded" : " tenant-booking-page--standalone"}`} data-booking-theme={bookingTheme} data-booking-open={bookingOpen} style={{ "--tenant-booking-brand": brandColor ?? "#1f2937", "--tenant-booking-panel": panelOverlayColor ?? brandColor ?? "#1f2937" } as CSSProperties}>{!embedSource ? <><div className="booking-site-skeleton" aria-hidden="true"><div className="booking-site-skeleton__nav"><i /><span /><span /><span /><span /></div><div className="booking-site-skeleton__hero"><div><i /><i /><i /><b /></div><div className="booking-site-skeleton__image" /></div><div className="booking-site-skeleton__cards"><i /><i /><i /></div></div><div className={`booking-page-launcher is-${launcherPosition}`}><button type="button" aria-expanded={bookingOpen} onClick={() => setBookingOpen(true)}>{launcherLabel}</button><span>Powered by <img src="/brand/waybook-logo-white.svg" alt="Waybook" /></span></div></> : null}{bookingOpen ? <section className="tenant-booking-card"><aside className="tenant-booking-brand-panel" style={panelStyle}>{logoUrl ? <img className="tenant-booking-logo" src={logoUrl} alt={`${tenantName} logo`} /> : <small>{tenantName}</small>}<div><h2>{panelTitle || `Book with ${tenantName}`}</h2><p>{panelCopy || "Choose a service and a time that works for you."}</p></div></aside><div className="tenant-booking-flow"><header className="tenant-booking-header"><div className="tenant-booking-header__identity">{step !== "service" && step !== "complete" ? <button className="tenant-booking-back" type="button" aria-label="Go back" onClick={goBack}><ArrowLeft size={19} strokeWidth={2} /></button> : null}<div>{locations.length ? <BookingLocationPicker compact locations={locationOptions} value={locationId} onSearch={setLocationQuery} onChange={(id) => { setLocationId(id); setServiceId(""); setStep("service"); setSlots([]); setSelectedSlot(null); setHoldId(null); setAssignedMember(null); setIdempotencyKey(null); setStatus(""); }} /> : <strong>{tenantName}</strong>}</div></div><div className="tenant-booking-actions"><button type="button" aria-label={embedSource ? "Start over" : "Close booking"} onClick={() => embedSource ? reset() : setBookingOpen(false)}>×</button></div></header>{step === "service" ? <section className="tenant-booking-stage"><p className="tenant-booking-step">STEP 1 OF 3</p><BookingProgress step={progress} color={brandColor} /><h1>{serviceStepTitle || "Choose a service"}</h1><span>{"Select where and what you would like to book."}</span>{!locations.length ? <p className="tenant-booking-status">No online location is currently available.</p> : null}<div className="tenant-service-list">{services.map((service) => <button type="button" key={service.id} onClick={() => void chooseService(service.id)}><strong>{service.title}</strong><small>{service.durationMinutes} min{showPrices ? ` · ${price(service.priceCents, currency)}` : ""}</small></button>)}</div>{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}</section> : null}{step === "time" ? <section className="tenant-booking-stage"><p className="tenant-booking-step">STEP 2 OF 3</p><BookingProgress step={progress} color={brandColor} /><h1>{timeStepTitle || "Choose a time"}</h1><span>{selectedService?.title} · We’ll assign an available employee</span><div className="tenant-day-list">{upcomingDays.map((day) => <button type="button" key={day} className={day === date ? "is-selected" : ""} aria-pressed={day === date} onClick={() => void chooseDate(day)}><small>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: timezone }).format(new Date(`${day}T12:00:00Z`))}</small><strong>{day.slice(-2)}</strong></button>)}</div><h2>{isLoading ? "Finding available times…" : "Available times"}</h2><div className="tenant-time-grid">{slots.map((slot) => <button type="button" key={slot.startTime} onClick={() => void reserveSlot(slot)} disabled={isLoading}>{clockTime(slot, timezone)}</button>)}</div>{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}</section> : null}{step === "details" && selectedSlot ? <form action={confirm} className="tenant-booking-stage tenant-customer-stage"><p className="tenant-booking-step">STEP 3 OF 3</p><BookingProgress step={progress} color={brandColor} /><h1>{detailsStepTitle || "Confirm your booking"}</h1><span>{selectedService?.title} with {assignedMember?.name ?? "your assigned employee"}</span><article><b>{fullDate(selectedSlot.startTime, timezone)}</b><small>This time is held for ten minutes with {assignedMember?.name ?? "your assigned employee"}.</small></article><label>Name<input name="name" autoComplete="name" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" /></label>{policyVersion && (policyText || policyUrl) ? <div className="tenant-booking-policy-block">{policyText ? <p>{policyText}</p> : null}<label className="tenant-booking-policy"><input name="acceptedPolicy" type="checkbox" required /> <span>I agree to the {policyUrl ? <a href={policyUrl} target="_blank" rel="noreferrer">{policyVersion}</a> : policyVersion}.</span></label></div> : null}{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}<button className="tenant-booking-primary" type="submit" disabled={isLoading}>{isLoading ? "Confirming…" : "Confirm booking"} <b>→</b></button></form> : null}{step === "complete" && confirmation ? <section className="tenant-booking-stage tenant-complete-stage"><p className="tenant-booking-step">BOOKING CONFIRMED</p><h1>You’re booked in.</h1><span>{selectedService?.title} with {assignedMember?.name ?? "your assigned employee"} at {tenantName}</span><article><b>{fullDate(confirmation.startsAt, timezone)}</b><small>Booking number: {confirmation.bookingNumber}</small><small>Keep this number and the email address used for your booking.</small><small>A confirmation email has been queued.</small></article><button type="button" className="tenant-booking-primary" onClick={reset}>Book another time <b>→</b></button></section> : null}<footer>{managementEnabled ? <><button type="button" className="booking-manage-link" onClick={() => setManageOpen(true)}>Manage booking</button><BookingManagementDialog theme={bookingTheme} tenantSlug={tenantSlug} timezone={timezone} policyText={policyText} policyUrl={policyUrl} open={manageOpen} onClose={() => setManageOpen(false)} /></> : <details className="booking-cancel-link"><summary>Manage booking</summary><p>To cancel an existing booking, please contact the business. Online cancellation is not available yet.</p>{policyUrl ? <a href={policyUrl} target="_blank" rel="noreferrer">Read cancellation policy</a> : policyText ? <p>{policyText}</p> : null}</details>}<span className="booking-powered-footer">Powered by <img src="/brand/waybook-logo-white.svg" alt="Waybook" /></span></footer></div></section> : null}</main>;
}
