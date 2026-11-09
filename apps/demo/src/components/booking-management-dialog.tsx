"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fromZonedTime } from "date-fns-tz";
import { ArrowLeft, X } from "lucide-react";

type Booking = { service: string; location: string; startsAt: string; endsAt: string; status: string; canChange: boolean; canCancel: boolean };
type Slot = { startTime: string; endTime: string };
type Provider = { slots: Slot[] };
type Stage = "lookup" | "booking" | "times" | "confirmCancel" | "confirmMove" | "done";

function dateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}

export function BookingManagementDialog({ tenantSlug, timezone, open, onClose, policyText, policyUrl, theme = "light" }: { theme?: "light" | "dark"; tenantSlug: string; timezone: string; open: boolean; onClose: () => void; policyText?: string; policyUrl?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [stage, setStage] = useState<Stage>("lookup");
  const [bookingId, setBookingId] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [date, setDate] = useState(() => dateKey(new Date(), timezone));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  useEffect(() => { const element = dialog.current; if (!element) return; if (open && !element.open) element.showModal(); else if (!open && element.open) element.close(); }, [open, mounted]);
  const close = () => { setStage("lookup"); setBookingId(""); setEmail(""); setBooking(null); setSlots([]); setError(""); setResult(""); onClose(); };
  const request = async (action: string, fields: Record<string, string> = {}) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/${tenantSlug}/api/public/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, bookingId, email, ...fields }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Please try again."); return null; }
      return data;
    } catch { setError("We couldn’t connect. Please try again."); return null; }
    finally { setBusy(false); }
  };
  const lookup = async () => { const data = await request("lookup"); if (data) { setBooking(data.booking); setStage("booking"); } };
  const loadTimes = async (day: string) => {
    setDate(day); setSlots([]); setSelected(null);
    const start = fromZonedTime(`${day}T00:00:00`, timezone);
    const end = fromZonedTime(`${day}T23:59:59.999`, timezone);
    const data = await request("availability", { start: new Date(start.getTime() - 86_400_000).toISOString(), end: new Date(end.getTime() + 86_400_000).toISOString() });
    if (data) { const unique = new Map<string, Slot>(); for (const provider of data.availability as Provider[]) for (const slot of provider.slots) if (dateKey(new Date(slot.startTime), timezone) === day && new Date(slot.startTime).getTime() > Date.now()) unique.set(slot.startTime, slot); setSlots([...unique.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))); }
  };
  const formatted = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const submitAction = async (action: "cancel" | "reschedule") => { const data = await request(action, action === "reschedule" && selected ? { startsAt: selected.startTime } : {}); if (data) { setResult(action === "cancel" ? "Your booking has been cancelled." : "Your booking has been rescheduled."); setStage("done"); } };
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} data-booking-theme={theme} className="booking-manage-dialog" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (open) close(); }} aria-labelledby={headingId}><div className="booking-manage-dialog__header">{stage !== "lookup" && stage !== "done" ? <button type="button" className="booking-manage-icon" aria-label="Go back" onClick={() => { setError(""); setStage(stage === "booking" ? "lookup" : stage === "confirmMove" ? "times" : "booking"); }}><ArrowLeft size={19} /></button> : <span /> }<button type="button" className="booking-manage-icon" aria-label="Close" onClick={close}><X size={19} /></button></div><div className="booking-manage-dialog__body"><p className="booking-manage-kicker">MANAGE YOUR BOOKING</p>{stage === "lookup" ? <><h2 id={headingId}>Find your booking</h2><p>Enter your booking number and the email address you used when booking.</p><form onSubmit={event => { event.preventDefault(); void lookup(); }}><label>Booking number<input required value={bookingId} onChange={event => setBookingId(event.target.value)} autoComplete="off" /></label><label>Email address<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>{error ? <p className="booking-manage-error" role="alert">{error}</p> : null}<button className="booking-manage-primary" disabled={busy}>{busy ? "Finding your booking…" : "Find booking"}</button></form></> : null}{stage !== "lookup" ? <h2 id={headingId}>{stage === "booking" ? "Your booking" : stage === "times" ? "Choose a new time" : stage === "confirmCancel" ? "Cancel this booking?" : stage === "confirmMove" ? "Confirm your new time" : "All done"}</h2> : null}{booking && stage === "booking" ? <><div className="booking-manage-summary"><strong>{booking.service}</strong><span>{formatted(booking.startsAt)}</span><span>{booking.location}</span></div>{booking.canChange ? <div className="booking-manage-actions"><button className="booking-manage-primary" type="button" onClick={() => { setStage("times"); void loadTimes(date); }}>Reschedule booking</button><button className="booking-manage-secondary" type="button" onClick={() => setStage("confirmCancel")}>Cancel booking</button>{!booking.canCancel ? <small>This booking has payment or package activity. Please contact the business to cancel it.</small> : null}</div> : <p>This booking can no longer be changed online. Please contact the business if you need help.</p>}</> : null}{stage === "times" ? <><p>Choose a day and an available time.</p><label>Day<input type="date" min={dateKey(new Date(), timezone)} value={date} onChange={event => { if (event.target.value) void loadTimes(event.target.value); }} /></label><div className="booking-manage-times">{slots.map(slot => <button type="button" key={slot.startTime} onClick={() => { setSelected(slot); setStage("confirmMove"); }}>{new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: timezone }).format(new Date(slot.startTime))}</button>)}</div>{!busy && !slots.length && !error ? <p>No times are available on this day.</p> : null}</> : null}{stage === "confirmCancel" ? <><p>Please check the business’s cancellation policy before confirming.</p>{policyText ? <p>{policyText}</p> : null}{policyUrl && /^https:\/\//i.test(policyUrl) ? <p><a href={policyUrl} target="_blank" rel="noreferrer">Read the cancellation policy</a></p> : null}{booking && !booking.canCancel ? <p>Please contact the business to cancel this booking because it has payment or package activity.</p> : <button type="button" className="booking-manage-primary" disabled={busy} onClick={() => void submitAction("cancel")}>{busy ? "Cancelling…" : "Confirm cancellation"}</button>}</> : null}{stage === "confirmMove" && selected ? <><p>Your new appointment will be:</p><div className="booking-manage-summary"><strong>{formatted(selected.startTime)}</strong><span>{booking?.location}</span></div><button type="button" className="booking-manage-primary" disabled={busy} onClick={() => void submitAction("reschedule")}>{busy ? "Rescheduling…" : "Confirm new time"}</button></> : null}{stage === "done" ? <><p>{result}</p><button type="button" className="booking-manage-primary" onClick={close}>Done</button></> : null}{error && stage !== "lookup" ? <p className="booking-manage-error" role="alert">{error}</p> : null}</div></dialog>, document.body);
}
