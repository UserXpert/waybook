"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishAppointmentCheckout, notifyWaitingRoomProviders, setAppointmentAttendanceStage } from "@/app/app/calendars/actions";
import { activeAppointmentStage, type AppointmentAttendanceStage } from "@/lib/waybook/appointment-lifecycle";
import { showSuccessToast } from "@/lib/waybook/toast";

export function AppointmentAttendanceJourney({ bookingId, status, stage, canUpdateStatus, canCheckIn, canCheckout, canNotifyProviders, checkoutPath, onChange }: {
  bookingId: string;
  status: string;
  stage: AppointmentAttendanceStage | null;
  canUpdateStatus: boolean;
  canCheckIn: boolean;
  canCheckout: boolean;
  canNotifyProviders: boolean;
  checkoutPath: string;
  onChange: (bookingId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notifying, setNotifying] = useState(false);
  const checkInButton = useRef<HTMLButtonElement>(null);
  const waitingChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (choosing) waitingChoice.current?.focus(); }, [choosing]);
  const checkoutHref = `${checkoutPath}?booking=${bookingId}`;
  const current = activeAppointmentStage(status, stage);
  const canChoose = status === "confirmed" && canUpdateStatus && canCheckIn;
  const canStart = current === "waiting_room" && canUpdateStatus && canCheckIn;
  const canStartCheckout = current === "in_service" && canCheckout;

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

  async function notifyProviders() {
    setNotifying(true);
    setError("");
    try {
      const result = await notifyWaitingRoomProviders(bookingId);
      if (result.error) { setError(result.error); return; }
      showSuccessToast(result.count ? "Waiting room alert sent" : "No new provider alerts needed");
      await onChange(bookingId).catch(() => router.refresh());
    } catch {
      setError("Could not notify providers. Please try again.");
    } finally {
      setNotifying(false);
    }
  }

  if (canCheckout && status === "completed") return <Link className="waybook-primary-link" href={checkoutHref}>View sale</Link>;
  if (canCheckout && current === "checking_out") return <Link className="waybook-primary-link" href={checkoutHref}>Continue checkout</Link>;
  if (!canChoose && !canStart && !canStartCheckout) return null;
  return <section aria-label="Front desk" className="appointment-attendance">
    <div className="appointment-drawer__status-actions">
      {canChoose ? <div className="appointment-attendance__picker" onBlur={(event) => {
        if (!pending && !event.currentTarget.contains(event.relatedTarget)) setChoosing(false);
      }} onKeyDown={(event) => {
        if (event.key !== "Escape" || !choosing || pending) return;
        event.preventDefault();
        event.stopPropagation();
        setChoosing(false);
        checkInButton.current?.focus();
      }}>
        <button ref={checkInButton} type="button" className="waybook-action" aria-expanded={choosing}
          disabled={pending} onClick={() => { setChoosing(!choosing); setError(""); }}>
          Check in <ChevronDown size={15} aria-hidden="true" />
        </button>
        {choosing ? <div role="group" aria-label="Check-in options" className="appointment-attendance__choices">
          <button ref={waitingChoice} type="button" disabled={pending} onClick={() => void advance("waiting_room")}>Waiting room</button>
          <button type="button" disabled={pending} onClick={() => void advance("in_service")}>In service</button>
        </div> : null}
      </div> : null}
      {canStart ? <button type="button" disabled={pending || notifying} onClick={() => void advance("in_service")}>Start service</button> : null}
      {canStart && canNotifyProviders ? <button type="button" disabled={pending || notifying} onClick={() => void notifyProviders()}>{notifying ? "Notifying…" : "Notify providers"}</button> : null}
      {canStartCheckout ? <button type="button" className="waybook-action" disabled={pending} onClick={() => void advance("checking_out")}>Checkout</button> : null}
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
