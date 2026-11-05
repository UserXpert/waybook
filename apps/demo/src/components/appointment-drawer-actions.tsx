"use client";

import { useState } from "react";
import { RescheduleSlotPicker } from "@/components/reschedule-slot-picker";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Slot = { startTime: string; endTime: string };
type Props = {
  bookingId: string; customerName: string; customerEmail: string; customerPhone: string | null; status: string;
  timezone: string; days: string[]; slots: Slot[];
  saveDetails: ServerAction; reschedule: ServerAction; updateStatus: ServerAction;
};

export function AppointmentDrawerActions({ bookingId, customerName, customerEmail, customerPhone, status, timezone, days, slots, saveDetails, reschedule, updateStatus }: Props) {
  const [details, setDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "" });
  const [hasNewTime, setHasNewTime] = useState(false);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  const detailsChanged = details.name !== customerName || details.email !== customerEmail || details.phone !== (customerPhone ?? "");
  const statusOptions = [["arrived", "Arrived"], ["completed", "Completed"], ["no_show", "No show"]] as const;

  return <>
    <section><h3>Edit</h3><form action={saveDetails} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><label>Customer name<input name="customerName" value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} required /></label><label>Email<input name="customerEmail" type="email" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} required /></label><label>Phone<input name="customerPhone" type="tel" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} /></label><button type="submit" disabled={!detailsChanged}>Save changes</button></form></section>
    {status !== "cancelled" ? <section><h3>Reschedule</h3><form action={reschedule} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><RescheduleSlotPicker timezone={timezone} days={days} slots={slots} onSelectionChange={setHasNewTime} /><button type="submit" disabled={!hasNewTime}>Reschedule appointment</button></form></section> : null}
    <section><h3>Appointment status</h3><p className="appointment-status-current">Current: {status.replace("_", " ")}</p><form action={updateStatus} className="appointment-status-form"><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="status" value={nextStatus ?? ""} /><div className="appointment-drawer__status-actions">{statusOptions.map(([value, label]) => <button type="button" key={value} className={nextStatus === value ? "is-selected" : ""} aria-pressed={nextStatus === value} disabled={value === status} onClick={() => setNextStatus(value)}>{label}</button>)}</div><button type="submit" disabled={!nextStatus}>Update status</button></form></section>
  </>;
}
