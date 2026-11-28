"use client";

import { CreditCard } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { updateStripeAppointmentPayment } from "@/app/app/calendars/actions";

export function StripeAppointmentPayment({ bookingId, amountCents, pendingPayment, mobilePayAvailable, livemode, verifyOnReturn }: {
  bookingId: string;
  amountCents: number;
  pendingPayment: "card" | "mobilepay" | null;
  mobilePayAvailable: boolean;
  livemode: boolean;
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

  return <form action={submit} className="tenant-drawer-form appointment-online-payment">
    <input type="hidden" name="bookingId" value={bookingId} />
    <input type="hidden" name="expectedCents" value={amountCents} />
    <div className="appointment-online-payment__heading">
      <CreditCard size={17} aria-hidden="true" />
      <h3>{pendingPayment ? "Online payment in progress" : "Pay online"}</h3>
      <span>{livemode ? "Stripe Checkout" : "Stripe test mode"}</span>
    </div>
    {pendingPayment ? <p className="sale-detail__note">Cancel the open payment to choose another method.</p> : null}
    {result.error ? <p className="manual-appointment__message is-error" role="alert">{result.error}</p> : null}
    {result.success ? <p className="sale-detail__note" role="status">{result.success}</p> : null}
    <div className="recorded-appointment-payments__actions" aria-busy={submitting}>
      <button className="waybook-action" name="action" value={pendingPayment ? "check" : "open-card"} disabled={submitting} type="submit">
        {submitting ? "Checking Stripe…" : pendingPayment ? "Check payment status" : livemode ? "Pay by card with Stripe" : "Pay by card in Stripe sandbox"}
      </button>
      {pendingPayment ? <>
        <button className="waybook-action waybook-action--secondary" name="action" value="open" disabled={submitting} type="submit">Continue in Stripe</button>
        <button className="waybook-action waybook-action--secondary" name="action" value="cancel" disabled={submitting} type="submit">
          {pendingPayment === "mobilepay" ? "Cancel MobilePay payment" : "Cancel card payment"}
        </button>
      </> : null}
      {!pendingPayment && mobilePayAvailable ? <button className="waybook-action waybook-action--secondary" name="action" value="open-mobilepay" disabled={submitting} type="submit">
        {livemode ? "Pay with MobilePay" : "Pay with MobilePay in Stripe sandbox"}
      </button> : null}
    </div>
  </form>;
}
