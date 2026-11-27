"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AttendanceResult, BookingDetailsResult } from "@/app/app/calendars/actions";
import { useRouter } from "next/navigation";
import { showSuccessToast } from "@/lib/waybook/toast";
import { RecordedAppointmentPayments } from "@/components/recorded-appointment-payments";
import { AppointmentPaymentForm, PaymentMethodOptions } from "@/components/appointment-payment-form";
import { RescheduleSlotPicker } from "@/components/reschedule-slot-picker";
import { isMovableAppointmentStatus } from "@/lib/waybook/appointment-lifecycle";
import { hasNonGiftCardPayment } from "@/lib/waybook/appointment-payment-records";
import type { AppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import styles from "./appointment-drawer-actions.module.css";

type Slot = { startTime: string; endTime: string };
type Props = {
  bookingId: string; customerName: string; customerEmail: string; customerPhone: string | null; status: string;
  timezone: string; days: string[]; slots: Slot[];
  currentStartsAt?: string; linkedServices?: boolean;
  canChangeAttendanceNow: boolean;
  separateCheckIn?: boolean;
  attendanceLabel?: string;
  onStatusSaved?: (bookingId: string) => Promise<void>;
  paymentBalance: AppointmentPaymentBalance | null;
  onPaymentRecorded?: (bookingId: string) => Promise<void>;
  saveDetails: (formData: FormData) => Promise<BookingDetailsResult>;
  reschedule: (formData: FormData) => Promise<{ error: string | null }>;
  resourceId: string | null; resources: { id: string; name: string; isMutuallyExclusive: boolean }[];
};

type StatusActionProps = Pick<Props, "bookingId" | "status" | "canChangeAttendanceNow" | "onStatusSaved" | "separateCheckIn" | "attendanceLabel"> & {
  updateStatus: (formData: FormData) => Promise<AttendanceResult>;
};
type RescheduleProps = Pick<Props, "bookingId" | "status" | "timezone" | "days" | "slots" | "reschedule" | "currentStartsAt" | "linkedServices">;

function attendanceOptions(status: string, separateCheckIn?: boolean) {
  if (status === "confirmed" && !separateCheckIn) return [["arrived", "Arrived"], ["completed", "Completed"], ["no_show", "No show"]] as const;
  if (status === "confirmed") return [["completed", "Completed"], ["no_show", "No show"]] as const;
  if (status === "arrived") return [["completed", "Completed"], ["no_show", "No show"]] as const;
  if (status === "no_show") return [["completed", "Completed"]] as const;
  return [];
}

function AppointmentStatusPicker({ status, canChangeAttendanceNow, value, onChange, pending, notice, separateCheckIn, attendanceLabel }: {
  status: string; canChangeAttendanceNow: boolean; value: string; onChange: (value: string) => void; pending: boolean; notice: string;
  separateCheckIn?: boolean; attendanceLabel?: string;
}) {
  const options = attendanceOptions(status, separateCheckIn);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);
  if (!options.length || !canChangeAttendanceNow) {
    const label = status === "no_show" ? "No show" : status[0]?.toUpperCase() + status.slice(1);
    const explanation = status === "cancelled"
      ? "This appointment has been cancelled. Its customer and audit history remain available, but it can no longer be edited, rescheduled, or paid."
      : options.length
        ? status === "no_show" ? "Completion can be recorded after the appointment ends."
          : separateCheckIn ? "Completion and no-show options are available once the appointment starts."
            : "Attendance can be updated once the appointment starts."
        : "This appointment’s status is final and cannot be changed.";
    return <section className="appointment-drawer__history"><h3>Appointment status</h3><p className="appointment-drawer__status-readonly">{label}</p><p className="appointment-drawer__readonly">{explanation}</p></section>;
  }

  return <section className="appointment-attendance">
    <h3>Appointment status</h3>
    <p className="appointment-status-current">Current: {attendanceLabel ?? status.replace("_", " ")}</p>
    <div className="appointment-drawer__status-actions" role="group" aria-label="Choose status">
      {options.map(([option, label]) => <button key={option} type="button"
        className={value === option ? "is-selected" : undefined} aria-pressed={value === option}
        disabled={pending} onClick={() => onChange(value === option ? "" : option)}>{label}</button>)}
    </div>
    {notice ? <p ref={noticeRef} className={`${styles.saveNotice} ${styles.error}`} role="alert">{notice}</p> : null}
  </section>;
}

function AppointmentSaveButton({ formId, formRef, disabled, pending, skipValidation = false }: {
  formId: string; formRef: RefObject<HTMLFormElement | null>; disabled: boolean; pending: boolean; skipValidation?: boolean;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(formRef.current?.closest(".appointment-drawer")?.querySelector<HTMLElement>("[data-appointment-save-action]") ?? null);
  }, [formRef]);
  const button = <button type="submit" form={formId} formNoValidate={skipValidation} disabled={disabled || pending}>
    {pending ? "Saving…" : "Save changes"}
  </button>;
  return target ? createPortal(button, target) : button;
}

export function AppointmentStatusActions({ bookingId, status, updateStatus, canChangeAttendanceNow, onStatusSaved, separateCheckIn, attendanceLabel }: StatusActionProps) {
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [selection, setSelection] = useState({ from: "", to: "" });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedStatus = selection.from === status ? selection.to : "";

  async function saveAttendance(data: FormData) {
    if (!selectedStatus || pending) return;
    setPending(true);
    setNotice("");
    try {
      const result = await updateStatus(data);
      if (result.error) {
        setNotice(result.paymentRequired ? "Ask a manager to record a payment before completing this no-show." : result.error);
        return;
      }
      setSelection({ from: "", to: "" });
      showSuccessToast("Changes saved");
      if (onStatusSaved) await onStatusSaved(bookingId).catch(() => router.refresh());
      else router.refresh();
    } catch {
      setNotice("Could not save appointment status. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <AppointmentStatusPicker status={status} canChangeAttendanceNow={canChangeAttendanceNow} value={selectedStatus} separateCheckIn={separateCheckIn} attendanceLabel={attendanceLabel}
      pending={pending} notice={notice} onChange={(to) => { setSelection({ from: status, to }); setNotice(""); }} />
    {canChangeAttendanceNow && attendanceOptions(status, separateCheckIn).length > 0 ? <form id={formId} ref={formRef} action={saveAttendance}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="expectedStatus" value={status} />
      <input type="hidden" name="status" value={selectedStatus} />
      <AppointmentSaveButton formId={formId} formRef={formRef} disabled={!selectedStatus} pending={pending} />
    </form> : null}
  </>;
}

export function AppointmentRescheduleActions({ bookingId, status, timezone, days, slots, reschedule, currentStartsAt, linkedServices }: RescheduleProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [hasNewTime, setHasNewTime] = useState(false);
  if (!isMovableAppointmentStatus(status) || !days.length) return null;

  async function saveSchedule(formData: FormData) {
    setPending(true);
    setError("");
    try {
      const result = await reschedule(formData);
      if (result.error) { setError(result.error); return; }
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
    {linkedServices ? <p>All services move together with their assigned providers.</p> : null}
    <form action={saveSchedule} className="tenant-drawer-form">
      <input type="hidden" name="bookingId" value={bookingId} />
      {currentStartsAt ? <input type="hidden" name="expectedStartsAt" value={currentStartsAt} /> : null}
      <RescheduleSlotPicker bookingId={bookingId} timezone={timezone} days={days} slots={slots} onSelectionChange={setHasNewTime} />
      {error ? <p className={`${styles.saveNotice} ${styles.error}`} role="alert">{error}</p> : null}
      <button type="submit" disabled={!hasNewTime || pending}>{pending ? "Rescheduling…" : "Reschedule appointment"}</button>
    </form>
  </section>;
}

export function AppointmentDrawerActions({ bookingId, customerName, customerEmail, customerPhone, status, timezone, days, slots, currentStartsAt, linkedServices, canChangeAttendanceNow, saveDetails, reschedule, resourceId, resources, paymentBalance, onPaymentRecorded, onStatusSaved, separateCheckIn, attendanceLabel }: Props) {
  const router = useRouter();
  const detailsFormId = useId();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [details, setDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "" });
  const [savedDetails, setSavedDetails] = useState({ name: customerName, email: customerEmail, phone: customerPhone ?? "", resource: resourceId ?? "" });
  const [resource, setResource] = useState(resourceId ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [selection, setSelection] = useState({ from: "", to: "" });
  const selectedStatus = selection.from === status ? selection.to : "";
  const inlinePayment = status === "no_show" && paymentBalance && (!paymentBalance.packageRedeemed || paymentBalance.outstandingCents > 0) && paymentBalance.payments.length === 0;
  const paymentEntered = Boolean(inlinePayment && paymentAmount.trim());
  const detailsChanged = details.name !== savedDetails.name || details.email !== savedDetails.email || details.phone !== savedDetails.phone || resource !== savedDetails.resource;

  async function refreshDrawer(refresh?: Props["onStatusSaved"]) {
    if (refresh) await refresh(bookingId).catch(() => router.refresh());
    else router.refresh();
  }

  async function saveEdits(formData: FormData) {
    if ((!detailsChanged && !selectedStatus && !paymentEntered) || savingDetails) return;
    setSavingDetails(true);
    setSaveError("");
    setStatusNotice("");
    try {
      const result = await saveDetails(formData);
      if (result.error) {
        if (result.paymentRequired) {
          setStatusNotice(result.error);
          await refreshDrawer(onStatusSaved);
        } else if (selectedStatus || paymentEntered) setStatusNotice(result.error);
        else setSaveError(result.error);
        return;
      }
      setSelection({ from: "", to: "" });
      setPaymentAmount("");
      setSavedDetails({ ...details, resource });
      showSuccessToast("Changes saved");
      await refreshDrawer(onStatusSaved);
    } catch {
      setSaveError("Could not save changes. Please try again.");
    } finally {
      setSavingDetails(false);
    }
  }

  const attendance = <AppointmentStatusPicker status={status} canChangeAttendanceNow={canChangeAttendanceNow} value={selectedStatus} separateCheckIn={separateCheckIn} attendanceLabel={attendanceLabel}
    pending={savingDetails} notice={statusNotice} onChange={(to) => { setSelection({ from: status, to }); setStatusNotice(""); }} />;
  if (status === "cancelled") return attendance;

  const noShow = status === "no_show";
  const canRecordPayment = Boolean(paymentBalance && (paymentBalance.refundableCents > 0 || (!hasNonGiftCardPayment(paymentBalance.payments) && paymentBalance.outstandingCents > 0)));
  const paymentRecorded = async () => {
    setStatusNotice("");
    await refreshDrawer(onPaymentRecorded);
  };
  const payment = paymentBalance && (noShow || canRecordPayment || paymentBalance.payments.length > 0) ? <section>
    <h3>{noShow ? "Payment details" : "Sales ledger"}</h3>
    {paymentBalance.payments.length > 0 ? <RecordedAppointmentPayments bookingId={bookingId} payments={paymentBalance.payments} onRecorded={paymentRecorded} /> : null}
    {inlinePayment ? <div className="tenant-drawer-form appointment-drawer__inline-payment">
      <div className="tenant-drawer-form__grid">
        <label>{paymentBalance.outstandingCents > 0 ? "Amount (DKK)" : "No-show fee (DKK)"}
          <input form={detailsFormId} name="paymentAmount" type="number" min="0.01" step="0.01"
            placeholder={paymentBalance.outstandingCents > 0 ? (paymentBalance.outstandingCents / 100).toFixed(2) : "0.00"}
            value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); setStatusNotice(""); }} />
        </label>
        <label>Method<select form={detailsFormId} name="paymentMethod" defaultValue="card"><PaymentMethodOptions /></select></label>
      </div>
    </div> : canRecordPayment ? <AppointmentPaymentForm bookingId={bookingId} balance={paymentBalance} onRecorded={paymentRecorded} /> : null}
    {!inlinePayment && !canRecordPayment && paymentBalance.payments.length === 0 ? <p className="appointment-drawer__readonly">No payment is due for this appointment.</p> : null}
  </section> : null;
  return <>
    {attendance}
    {status === "no_show" ? payment : null}
    <section>
      <h3>Edit</h3>
      <form id={detailsFormId} ref={detailsFormRef} action={saveEdits} className="tenant-drawer-form" data-drawer-submit-in-header>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="expectedStatus" value={status} />
        <input type="hidden" name="status" value={selectedStatus} />
        <input type="hidden" name="editDetails" value={String(detailsChanged)} />
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
        <AppointmentSaveButton formId={detailsFormId} formRef={detailsFormRef} disabled={!detailsChanged && !selectedStatus && !paymentEntered}
          pending={savingDetails} skipValidation={!detailsChanged && !paymentEntered} />
      </form>
    </section>
    <AppointmentRescheduleActions bookingId={bookingId} status={status} timezone={timezone} days={days} slots={slots} reschedule={reschedule} currentStartsAt={currentStartsAt} linkedServices={linkedServices} />
    {status !== "no_show" ? payment : null}
  </>;
}
