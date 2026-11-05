"use client";

import { useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number };
type TeamMember = { id: string; name: string; serviceId: string };
type Slot = { startTime: string; endTime: string; localStart: string; localEnd: string };
type Availability = { teamMemberId: string; slots: Slot[] };
type AssignedMember = { id: string; name: string };
type Step = "service" | "time" | "details" | "complete";
type Props = { tenantName: string; timezone: string; services: Service[]; teamMembers: TeamMember[] };

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

function price(priceCents: number) {
  return new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(priceCents / 100);
}

export function PublicBookingFlow({ tenantName, timezone, services, teamMembers }: Props) {
  const [step, setStep] = useState<Step>("service");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(() => isoDateInTimezone(new Date(), timezone));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [assignedMember, setAssignedMember] = useState<AssignedMember | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<{ id: string; startsAt: string } | null>(null);
  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const eligibleMembers = teamMembers.filter((member) => member.serviceId === serviceId);
  const upcomingDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const value = new Date(); value.setDate(value.getDate() + index);
    return isoDateInTimezone(value, timezone);
  }), [timezone]);

  const fetchSlots = async (selectedDate: string) => {
    if (!selectedService || !eligibleMembers.length) { setStatus("This service has no available staff member yet."); return; }
    setIsLoading(true); setStatus(""); setSelectedSlot(null); setHoldId(null); setIdempotencyKey(null);
    const startsAt = fromZonedTime(`${selectedDate}T00:00:00`, timezone);
    const endsAt = fromZonedTime(`${selectedDate}T23:59:59.999`, timezone);
    const response = await fetch(`/api/public/availability?service=${encodeURIComponent(selectedService.id)}&start=${encodeURIComponent(new Date(startsAt.getTime() - 24 * 60 * 60_000).toISOString())}&end=${encodeURIComponent(new Date(endsAt.getTime() + 24 * 60 * 60_000).toISOString())}`);
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

  const chooseService = (nextServiceId: string) => {
    setServiceId(nextServiceId); setStatus(""); setSlots([]); setSelectedSlot(null); setHoldId(null); setAssignedMember(null); setIdempotencyKey(null);
  };
  const continueToTime = async () => {
    if (!serviceId) { setStatus("Choose a service to continue."); return; }
    setStep("time"); await fetchSlots(date);
  };
  const chooseDate = async (nextDate: string) => { setDate(nextDate); await fetchSlots(nextDate); };
  const reserveSlot = async (slot: Slot) => {
    if (!selectedService) return;
    setIsLoading(true); setStatus("");
    const response = await fetch("/api/public/holds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: selectedService.id, startsAt: slot.startTime, endsAt: slot.endTime }) });
    const payload = await response.json();
    setIsLoading(false);
    if (!response.ok) { setStatus(payload.error ?? "That time is no longer available."); return; }
    setSelectedSlot(slot); setHoldId(payload.holdId); setAssignedMember(payload.teamMember); setIdempotencyKey(crypto.randomUUID()); setStep("details");
  };
  const confirm = async (formData: FormData) => {
    if (!holdId || !idempotencyKey) return;
    setIsLoading(true); setStatus("");
    const response = await fetch("/api/public/confirmations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holdId, idempotencyKey, customer: { name: formData.get("name"), email: formData.get("email"), phone: formData.get("phone") } }) });
    const payload = await response.json();
    setIsLoading(false);
    if (!response.ok) { setStatus(payload.error ?? "Could not confirm the booking."); return; }
    setConfirmation(payload.booking); setStep("complete");
  };
  const reset = () => { setStep("service"); setServiceId(""); setSlots([]); setSelectedSlot(null); setHoldId(null); setAssignedMember(null); setIdempotencyKey(null); setStatus(""); setConfirmation(null); };
  const goBack = () => { if (step === "time") setStep("service"); if (step === "details") setStep("time"); };
  const progress = step === "service" ? 1 : step === "time" ? 2 : 3;

  return <main className="tenant-booking-page"><section className="tenant-booking-card"><header className="tenant-booking-header"><div><p>ONLINE BOOKING</p><strong>{tenantName}</strong></div><div className="tenant-booking-actions"><button type="button" aria-label="Go back" onClick={goBack} disabled={step === "service" || step === "complete"}>←</button><button type="button" aria-label="Start over" onClick={reset}>×</button></div></header><div className="tenant-booking-progress" aria-label={`Step ${progress} of 3`}><i style={{ width: `${(progress / 3) * 100}%` }} /></div>{step === "service" ? <section className="tenant-booking-stage"><p className="tenant-booking-step">STEP 1 OF 3</p><h1>Choose a service</h1><span>Select what you would like to book.</span><div className="tenant-service-list">{services.map((service) => <button type="button" key={service.id} className={service.id === serviceId ? "is-selected" : ""} aria-pressed={service.id === serviceId} onClick={() => chooseService(service.id)}><span><strong>{service.title}</strong><small>{service.durationMinutes} min · {price(service.priceCents)}</small></span><em>{service.id === serviceId ? "✓" : ""}</em></button>)}</div>{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}<button type="button" className="tenant-booking-primary" onClick={() => void continueToTime()}>Continue <b>→</b></button></section> : null}{step === "time" ? <section className="tenant-booking-stage"><p className="tenant-booking-step">STEP 2 OF 3</p><h1>Choose a time</h1><span>{selectedService?.title} · We’ll assign an available employee</span><div className="tenant-day-list">{upcomingDays.map((day) => <button type="button" key={day} className={day === date ? "is-selected" : ""} aria-pressed={day === date} onClick={() => void chooseDate(day)}><small>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: timezone }).format(new Date(`${day}T12:00:00Z`))}</small><strong>{day.slice(-2)}</strong></button>)}</div><h2>{isLoading ? "Finding available times…" : "Available times"}</h2><div className="tenant-time-grid">{slots.map((slot) => <button type="button" key={slot.startTime} onClick={() => void reserveSlot(slot)} disabled={isLoading}>{clockTime(slot, timezone)}</button>)}</div>{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}</section> : null}{step === "details" && selectedSlot ? <form action={confirm} className="tenant-booking-stage tenant-customer-stage"><p className="tenant-booking-step">STEP 3 OF 3</p><h1>Confirm your booking</h1><span>{selectedService?.title} with {assignedMember?.name ?? "your assigned employee"}</span><article><b>{fullDate(selectedSlot.startTime, timezone)}</b><small>This time is held for ten minutes with {assignedMember?.name ?? "your assigned employee"}.</small></article><label>Name<input name="name" autoComplete="name" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" /></label>{status ? <p className="tenant-booking-status" role="status">{status}</p> : null}<button className="tenant-booking-primary" type="submit" disabled={isLoading}>{isLoading ? "Confirming…" : "Confirm booking"} <b>→</b></button></form> : null}{step === "complete" && confirmation ? <section className="tenant-booking-stage tenant-complete-stage"><p className="tenant-booking-step">BOOKING CONFIRMED</p><h1>You're booked in.</h1><span>{selectedService?.title} with {assignedMember?.name ?? "your assigned employee"} at {tenantName}</span><article><b>{fullDate(confirmation.startsAt, timezone)}</b><small>A confirmation email has been queued.</small></article><button type="button" className="tenant-booking-primary" onClick={reset}>Book another time <b>→</b></button></section> : null}<footer>Powered by <b>Waybook</b></footer></section></main>;
}
