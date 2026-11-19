"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSuccessToast } from "@/lib/waybook/toast";
import { AppointmentPaymentForm } from "@/components/appointment-payment-form";
import { RescheduleSlotPicker } from "@/components/reschedule-slot-picker";
import styles from "./appointment-drawer-actions.module.css";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Slot = { startTime: string; endTime: string };
type Props = {
  bookingId: string; customerName: string; customerEmail: string; customerPhone: string | null; status: string;
  timezone: string; days: string[]; slots: Slot[];
  saveDetails: ServerAction; reschedule: ServerAction; updateStatus: ServerAction;
  resourceId: string | null; resources: { id: string; name: string; isMutuallyExclusive: boolean }[];
};

export function AppointmentDrawerActions({ bookingId, customerName, customerEmail, customerPhone, status, timezone, days, slots, saveDetails, reschedule, updateStatus, resourceId, resources }: Props) {
  const router = useRouter();
  const [reschedulePending, setReschedulePending] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [details, setDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "" });
  const [savedDetails, setSavedDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "", resource: resourceId ?? "" });
  const [hasNewTime, setHasNewTime] = useState(false);
  const [resource, setResource] = useState(resourceId ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const detailsChanged = details.name !== savedDetails.name || details.email !== savedDetails.email || details.phone !== savedDetails.phone || resource !== savedDetails.resource;
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
    <section><h3>Edit</h3><form action={async (formData) => { setSaveState("saving"); try { await saveDetails(formData); setSavedDetails({ ...details, resource }); setSaveState("saved"); showSuccessToast("Changes saved"); router.refresh(); } catch { setSaveState("error"); } }} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><label>Customer name<input name="customerName" value={details.name} onChange={(event) => { setDetails({ ...details, name: event.target.value }); setSaveState("idle"); }} required /></label><label>Email<input name="customerEmail" type="email" value={details.email} onChange={(event) => { setDetails({ ...details, email: event.target.value }); setSaveState("idle"); }} required /></label><label>Phone<input name="customerPhone" type="tel" value={details.phone} onChange={(event) => { setDetails({ ...details, phone: event.target.value }); setSaveState("idle"); }} /></label><label>Resource<select name="resourceId" value={resource} onChange={event => { setResource(event.target.value); setSaveState("idle"); }}><option value="">Unassigned</option>{resources.map(item => <option key={item.id} value={item.id}>{item.name}{item.isMutuallyExclusive ? " · exclusive" : " · shared"}</option>)}</select></label>{saveState === "error" ? <p className={`${styles.saveNotice} ${styles.error}`} role="alert">Could not save changes. Please try again.</p> : null}<button type="submit" disabled={!detailsChanged || saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save changes"}</button></form></section>
    {status !== "completed" ? <section><h3>Reschedule</h3><form action={async (formData) => { setReschedulePending(true); setRescheduleError(""); try { await reschedule(formData); showSuccessToast("Appointment rescheduled"); router.refresh(); } catch { setRescheduleError("Could not reschedule this appointment. Please try another time."); } finally { setReschedulePending(false); } }} className="tenant-drawer-form"><input type="hidden" name="bookingId" value={bookingId} /><RescheduleSlotPicker bookingId={bookingId} timezone={timezone} days={days} slots={slots} onSelectionChange={setHasNewTime} />{rescheduleError ? <p className={`${styles.saveNotice} ${styles.error}`} role="alert">{rescheduleError}</p> : null}<button type="submit" disabled={!hasNewTime || reschedulePending}>{reschedulePending ? "Rescheduling…" : "Reschedule appointment"}</button></form></section> : null}
    <section><h3>Sales ledger</h3><p className="appointment-status-current">Record payment received or a refund. Entries are immutable and feed paid-revenue reporting.</p><AppointmentPaymentForm bookingId={bookingId} outstandingCents={0} /></section>
  </>;
}
