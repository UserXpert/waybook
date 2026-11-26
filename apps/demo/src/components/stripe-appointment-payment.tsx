"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { updateStripeAppointmentPayment } from "@/app/app/calendars/actions";

export function StripeAppointmentPayment({ bookingId, amountCents, pendingPayment, verifyOnReturn }: {
  bookingId: string;
  amountCents: number;
  pendingPayment: boolean;
  verifyOnReturn: boolean;
}) {
  const [result, submit, submitting] = useActionState(updateStripeAppointmentPayment, { error: null, success: null });
  const checkedReturn = useRef<string | null>(null);
  useEffect(() => {
    if (!verifyOnReturn || !pendingPayment || checkedReturn.current === bookingId) return;
    checkedReturn.current = bookingId;
    const data = new FormData();
    data.set("bookingId", bookingId);
    data.set("action", "return");
    startTransition(() => submit(data));
  }, [bookingId, pendingPayment, submit, verifyOnReturn]);

  return <form action={submit} className="tenant-drawer-form">
    <input type="hidden" name="bookingId" value={bookingId} />
    <input type="hidden" name="expectedCents" value={amountCents} />
    <p className="sale-detail__note">{pendingPayment
      ? "Waybook checks the payment when you return from Stripe. You can cancel an open card payment to choose another method."
      : "Use a Stripe test card on Stripe’s payment page."}</p>
    {result.error ? <p className="manual-appointment__message is-error" role="alert">{result.error}</p> : null}
    {result.success ? <p className="sale-detail__note" role="status">{result.success}</p> : null}
    <div className="recorded-appointment-payments__actions" aria-busy={submitting}>
      <button className="waybook-action" name="action" value={pendingPayment ? "check" : "open"} disabled={submitting} type="submit">
        {submitting ? "Checking Stripe…" : pendingPayment ? "Check payment status" : "Pay by card in Stripe sandbox"}
      </button>
      {pendingPayment ? <>
        <button className="waybook-action waybook-action--secondary" name="action" value="open" disabled={submitting} type="submit">Continue in Stripe</button>
        <button className="waybook-action waybook-action--secondary" name="action" value="cancel" disabled={submitting} type="submit">Cancel card payment</button>
      </> : null}
    </div>
  </form>;
}
