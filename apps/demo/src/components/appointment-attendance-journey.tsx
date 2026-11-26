"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishAppointmentCheckout, setAppointmentAttendanceStage } from "@/app/app/calendars/actions";
import { activeAppointmentStage, type AppointmentAttendanceStage } from "@/lib/waybook/appointment-lifecycle";
import { showSuccessToast } from "@/lib/waybook/toast";

export function AppointmentAttendanceJourney({ bookingId, status, stage, canUpdateStatus, canCheckIn, canManage, checkoutPath, onChange }: {
  bookingId: string;
  status: string;
  stage: AppointmentAttendanceStage | null;
  canUpdateStatus: boolean;
  canCheckIn: boolean;
  canManage: boolean;
  checkoutPath: string;
  onChange: (bookingId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const waitingChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (choosing) waitingChoice.current?.focus(); }, [choosing]);
  const checkoutHref = `${checkoutPath}?booking=${bookingId}`;
  const current = activeAppointmentStage(status, stage);
  const canChoose = status === "confirmed" && canUpdateStatus && canCheckIn;
  const canStart = current === "waiting_room" && canUpdateStatus && canCheckIn;
  const canCheckout = current === "in_service" && canManage;

  async function advance(next: AppointmentAttendanceStage) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await setAppointmentAttendanceStage(bookingId, next);
      if (result.error) { setError(result.error); return; }
      if (next === "checking_out") { router.push(checkoutHref); return; }
      setChoosing(false);
      await onChange(bookingId).catch(() => router.refresh());
      router.refresh();
    } catch {
      setError("Could not update the appointment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (canManage && status === "completed") return <Link className="waybook-primary-link" href={checkoutHref}>View sale</Link>;
  if (canManage && current === "checking_out") return <Link className="waybook-primary-link" href={checkoutHref}>Continue checkout</Link>;
  if (!canChoose && !canStart && !canCheckout) return null;
  return <section aria-label="Front desk" className="appointment-attendance">
    <div className="appointment-drawer__status-actions">
      {canChoose && !choosing ? <button type="button" className="waybook-action" onClick={() => setChoosing(true)}>Check in</button> : null}
      {canChoose && choosing ? <div role="group" aria-label="Check-in options" className="appointment-drawer__status-actions">
        <button ref={waitingChoice} type="button" disabled={pending} onClick={() => void advance("waiting_room")}>Waiting room</button>
        <button type="button" disabled={pending} onClick={() => void advance("in_service")}>In service</button>
        <button type="button" disabled={pending} onClick={() => { setChoosing(false); setError(""); }}>Back</button>
      </div> : null}
      {canStart ? <button type="button" disabled={pending} onClick={() => void advance("in_service")}>Start service</button> : null}
      {canCheckout ? <button type="button" className="waybook-action" disabled={pending} onClick={() => void advance("checking_out")}>Checkout</button> : null}
    </div>
    {error ? <p className="manual-appointment__message is-error" role="alert">{error}</p> : null}
  </section>;
}

export function FinishAppointmentCheckout({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function finish() {
    setPending(true);
    setError("");
    try {
      const result = await finishAppointmentCheckout(bookingId);
      if (result.error) { setError(result.error); return; }
      showSuccessToast("Appointment completed");
      router.refresh();
    } catch {
      setError("Could not finish checkout. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return <div>
    <button className="waybook-action" type="button" disabled={pending} onClick={() => void finish()}>{pending ? "Finishing checkout…" : "Finish checkout"}</button>
    {error ? <p className="manual-appointment__message is-error" role="alert">{error}</p> : null}
  </div>;
}
