"use client";

import { useActionState } from "react";
import { updateStripeAppointmentPayment } from "@/app/app/calendars/actions";

export function StripeAppointmentPayment({ bookingId, amountCents, pendingPayment }: {
  bookingId: string;
  amountCents: number;
  pendingPayment: boolean;
}) {
  const [result, submit, submitting] = useActionState(updateStripeAppointmentPayment, { error: null, success: null });

  return <form action={submit} className="tenant-drawer-form">
    <input type="hidden" name="bookingId" value={bookingId} />
    <input type="hidden" name="expectedCents" value={amountCents} />
    <p className="sale-detail__note">{pendingPayment
      ? "Check the payment status after returning from Stripe. You can cancel an open card payment to choose another method."
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
