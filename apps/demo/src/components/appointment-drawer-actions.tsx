"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BookingDetailsResult } from "@/app/app/calendars/actions";
import { useRouter } from "next/navigation";
import { showSuccessToast } from "@/lib/waybook/toast";
import { AppointmentPaymentForm } from "@/components/appointment-payment-form";
import { RescheduleSlotPicker } from "@/components/reschedule-slot-picker";
import { isMovableAppointmentStatus } from "@/lib/waybook/appointment-lifecycle";
import styles from "./appointment-drawer-actions.module.css";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Slot = { startTime: string; endTime: string };
type Props = {
  bookingId: string; customerName: string; customerEmail: string; customerPhone: string | null; status: string;
  timezone: string; days: string[]; slots: Slot[];
  canChangeAttendanceNow: boolean;
  saveDetails: (formData: FormData) => Promise<BookingDetailsResult>; reschedule: ServerAction; updateStatus: ServerAction;
  resourceId: string | null; resources: { id: string; name: string; isMutuallyExclusive: boolean }[];
};

type StatusActionProps = Pick<Props, "bookingId" | "status" | "updateStatus" | "canChangeAttendanceNow">;
type RescheduleProps = Pick<Props, "bookingId" | "status" | "timezone" | "days" | "slots" | "reschedule">;

export function AppointmentStatusActions({ bookingId, status, updateStatus, canChangeAttendanceNow }: StatusActionProps) {
  const statusOptions = status === "confirmed"
    ? [["arrived", "Arrived"], ["completed", "Completed"], ["no_show", "No show"]] as const
    : status === "arrived"
      ? [["completed", "Completed"], ["no_show", "No show"]] as const
      : status === "no_show"
        ? [["completed", "Completed"]] as const
        : [];

  if (!statusOptions.length || !canChangeAttendanceNow) {
    const label = status === "no_show" ? "No show" : status[0]?.toUpperCase() + status.slice(1);
    const explanation = status === "cancelled"
      ? "This appointment has been cancelled. Its customer and audit history remain available, but it can no longer be edited, rescheduled, or paid."
      : statusOptions.length
        ? status === "no_show" ? "Completion can be recorded after the appointment ends." : "Attendance can be updated once the appointment starts."
        : "This appointment’s status is final and cannot be changed.";
    return <section className="appointment-drawer__history"><h3>Appointment status</h3><p className="appointment-drawer__status-readonly">{label}</p><p className="appointment-drawer__readonly">{explanation}</p></section>;
  }

  return <section><h3>Appointment status</h3><p className="appointment-status-current">Current: {status.replace("_", " ")}</p><div className="appointment-drawer__status-actions">{statusOptions.map(([value, label]) => <form action={updateStatus} key={value}><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="status" value={value} /><button type="submit">{label}</button></form>)}</div></section>;
}

export function AppointmentRescheduleActions({ bookingId, status, timezone, days, slots, reschedule }: RescheduleProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [hasNewTime, setHasNewTime] = useState(false);
  if (!isMovableAppointmentStatus(status)) return null;

  async function saveSchedule(formData: FormData) {
    setPending(true);
    setError("");
    try {
      await reschedule(formData);
      showSuccessToast("Appointment rescheduled");
      router.refresh();
    } catch {
      setError("Could not reschedule this appointment. Please try another time.");
    } finally {
      setPending(false);
    }
  }

  return <section>
    <h3>Reschedule</h3>
    <form action={saveSchedule} className="tenant-drawer-form">
      <input type="hidden" name="bookingId" value={bookingId} />
      <RescheduleSlotPicker bookingId={bookingId} timezone={timezone} days={days} slots={slots} onSelectionChange={setHasNewTime} />
      {error ? <p className={`${styles.saveNotice} ${styles.error}`} role="alert">{error}</p> : null}
      <button type="submit" disabled={!hasNewTime || pending}>{pending ? "Rescheduling…" : "Reschedule appointment"}</button>
    </form>
  </section>;
}

export function AppointmentDrawerActions({ bookingId, customerName, customerEmail, customerPhone, status, timezone, days, slots, canChangeAttendanceNow, saveDetails, reschedule, updateStatus, resourceId, resources }: Props) {
  const router = useRouter();
  const detailsFormId = useId();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [saveTarget, setSaveTarget] = useState<HTMLElement | null>(null);

  // Keep the Save control React-owned while the drawer updates or shows a save error.
  useEffect(() => {
    const target = detailsFormRef.current?.closest(".appointment-drawer")
      ?.querySelector<HTMLElement>("[data-appointment-save-action]");
    setSaveTarget(target ?? null);
  }, [bookingId]);
  const [details, setDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "" });
  const [savedDetails, setSavedDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "", resource: resourceId ?? "" });
  const [resource, setResource] = useState(resourceId ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function saveEdits(formData: FormData) {
    setSavingDetails(true);
    setSaveError("");
    try {
      const result = await saveDetails(formData);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setSavedDetails({ ...details, resource });
      showSuccessToast("Changes saved");
      router.refresh();
    } catch {
      setSaveError("Could not save changes. Please try again.");
    } finally {
      setSavingDetails(false);
    }
  }
  const detailsChanged = details.name !== savedDetails.name || details.email !== savedDetails.email || details.phone !== savedDetails.phone || resource !== savedDetails.resource;
  const attendance = <AppointmentStatusActions bookingId={bookingId} status={status} updateStatus={updateStatus} canChangeAttendanceNow={canChangeAttendanceNow} />;
  if (status === "cancelled") return attendance;
  const saveButton = <button type="submit" form={detailsFormId} disabled={!detailsChanged || savingDetails}>
    {savingDetails ? "Saving…" : "Save changes"}
  </button>;
  return <>
    {attendance}
    <section>
      <h3>Edit</h3>
      <form id={detailsFormId} ref={detailsFormRef} action={saveEdits} className="tenant-drawer-form" data-drawer-submit-in-header>
        <input type="hidden" name="bookingId" value={bookingId} />
        <label>Customer name
          <input name="customerName" value={details.name} onChange={(event) => { setDetails({ ...details, name: event.target.value }); setSaveError(""); }} required />
        </label>
        <label>Email
          <input name="customerEmail" type="email" value={details.email} onChange={(event) => { setDetails({ ...details, email: event.target.value }); setSaveError(""); }} required />
        </label>
        <label>Phone
          <input name="customerPhone" type="tel" value={details.phone} onChange={(event) => { setDetails({ ...details, phone: event.target.value }); setSaveError(""); }} />
        </label>
        <label>Resource
          <select name="resourceId" value={resource} onChange={(event) => { setResource(event.target.value); setSaveError(""); }}>
            <option value="">Unassigned</option>
            {resources.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isMutuallyExclusive ? " · exclusive" : " · shared"}</option>)}
          </select>
        </label>
        {saveError ? <p className={`${styles.saveNotice} ${styles.error}`} role="alert">{saveError}</p> : null}
        {saveTarget ? createPortal(saveButton, saveTarget) : saveButton}
      </form>
    </section>
    <AppointmentRescheduleActions bookingId={bookingId} status={status} timezone={timezone} days={days} slots={slots} reschedule={reschedule} />
    <section><h3>Sales ledger</h3><p className="appointment-status-current">Record payment received or a refund. Entries are immutable and feed paid-revenue reporting.</p><AppointmentPaymentForm bookingId={bookingId} outstandingCents={0} /></section>
  </>;
}
