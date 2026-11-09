"use client";

import { useState } from "react";
import { AppointmentPaymentForm } from "@/components/appointment-payment-form";
import { RescheduleSlotPicker } from "@/components/reschedule-slot-picker";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Slot = { startTime: string; endTime: string };
type Props = {
  bookingId: string; customerName: string; customerEmail: string; customerPhone: string | null; status: string;
  timezone: string; days: string[]; slots: Slot[];
  saveDetails: ServerAction; reschedule: ServerAction; updateStatus: ServerAction;
  resourceId: string | null; resources: { id: string; name: string; isMutuallyExclusive: boolean }[];
};

export function AppointmentDrawerActions({ bookingId, customerName, customerEmail, customerPhone, status, timezone, days, slots, saveDetails, reschedule, updateStatus, resourceId, resources }: Props) {
  const [details, setDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "" });
  const [hasNewTime, setHasNewTime] = useState(false);
  const [resource, setResource] = useState(resourceId ?? "");
  const detailsChanged = details.name !== customerName || details.email !== customerEmail || details.phone !== (customerPhone ?? "") || resource !== (resourceId ?? "");
  const statusOptions = [["arrived", "Arrived"], ["completed", "Completed"], ["no_show", "No show"]] as const;

  if (status === "cancelled") {
    return (
      <section className="appointment-drawer__history">
        <h3>Appointment status</h3>
        <p className="appointment-drawer__status-readonly">Cancelled</p>
        <p className="appointment-drawer__readonly">This appointment has been cancelled. Its customer and audit history remain available, but it can no longer be edited, rescheduled, or paid.</p>
      </section>
    );
  }

  return <>
    <section><h3>Appointment status</h3><p className="appointment-status-current">Current: {status.replace("_", " ")}</p><div className="appointment-drawer__status-actions">{statusOptions.map(([value, label]) => <form action={updateStatus} key={value}><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="status" value={value} /><button type="submit" disabled={value === status}>{label}</button></form>)}</div></section>
    <section><h3>Edit</h3><form action={saveDetails} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><label>Customer name<input name="customerName" value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} required /></label><label>Email<input name="customerEmail" type="email" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} required /></label><label>Phone<input name="customerPhone" type="tel" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} /></label><label>Resource<select name="resourceId" value={resource} onChange={event => setResource(event.target.value)}><option value="">Unassigned</option>{resources.map(item => <option key={item.id} value={item.id}>{item.name}{item.isMutuallyExclusive ? " · exclusive" : " · shared"}</option>)}</select></label><button type="submit" disabled={!detailsChanged}>Save changes</button></form></section>
    {status !== "completed" ? <section><h3>Reschedule</h3><form action={reschedule} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><RescheduleSlotPicker bookingId={bookingId} timezone={timezone} days={days} slots={slots} onSelectionChange={setHasNewTime} /><button type="submit" disabled={!hasNewTime}>Reschedule appointment</button></form></section> : null}
    <section><h3>Sales ledger</h3><p className="appointment-status-current">Record payment received or a refund. Entries are immutable and feed paid-revenue reporting.</p><AppointmentPaymentForm bookingId={bookingId} outstandingCents={0} /></section>
  </>;
}
