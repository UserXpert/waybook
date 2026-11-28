"use client";

import { useActionState } from "react";
import { updateStripeAppointmentRefund } from "@/app/app/calendars/actions";

export function StripeAppointmentRefund({ bookingId, requestId, remainingCents, pendingCents, failure, paymentMethod, livemode }: {
  bookingId: string;
  requestId: string;
  remainingCents: number;
  pendingCents: number | null;
  failure: string | null;
  paymentMethod: "card" | "mobilepay";
  livemode: boolean;
}) {
  const [result, submit, submitting] = useActionState(updateStripeAppointmentRefund, { error: null, success: null });
  const formatter = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });
  return <form action={submit} className="tenant-drawer-form">
    <input type="hidden" name="bookingId" value={bookingId} />
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="expectedCents" value={remainingCents} />
    {result.error || failure ? <p className="manual-appointment__message is-error" role="alert">{result.error || failure}</p> : null}
    {result.success ? <p className="sale-detail__note" role="status">{result.success}</p> : null}
    {pendingCents !== null ? <>
      <p className="sale-detail__note">Pending refund {formatter.format(pendingCents / 100)}</p>
      <button className="waybook-action waybook-action--secondary" name="action" value="check" disabled={submitting} type="submit">
        {submitting ? "Checking Stripe…" : "Check refund status"}
      </button>
    </> : remainingCents > 0 ? <>
      <p className="sale-detail__note">{paymentMethod === "mobilepay"
        ? "Stripe refunds the card used for the original MobilePay payment."
        : livemode ? "Stripe refunds the original card." : "Refunds return to the original test card."}</p>
      <label>Refund amount (DKK)<input key={remainingCents} type="number" name="amountDkk" min="0.01"
        max={(remainingCents / 100).toFixed(2)} step="0.01" defaultValue={(remainingCents / 100).toFixed(2)} required /></label>
      <button className="waybook-action waybook-action--secondary" name="action" value="start" disabled={submitting} type="submit">
        {submitting ? "Submitting refund…" : livemode ? "Refund in Stripe" : "Refund in Stripe sandbox"}
      </button>
    </> : null}
  </form>;
}
