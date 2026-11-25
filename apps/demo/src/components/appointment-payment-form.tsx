"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { recordPayment } from "@/app/app/calendars/actions";

export function AppointmentPaymentForm({ bookingId, outstandingCents }: { bookingId: string; outstandingCents: number }) {
  const [state, formAction, pending] = useActionState(recordPayment, { error: null, success: null });
  const outstandingDkk = Math.max(0, outstandingCents) / 100;
  const [amount, setAmount] = useState(outstandingDkk ? outstandingDkk.toFixed(2) : "");
  const [amountConfirmed, setAmountConfirmed] = useState(false);
  useEffect(() => {
    if (!state.success) return;
    setAmount("");
    setAmountConfirmed(false);
  }, [state]);
  return <form action={formAction} className="tenant-drawer-form appointment-payment-form" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }}>
    <input type="hidden" name="bookingId" value={bookingId} />
    <div className="tenant-drawer-form__grid">
      <label>Entry<select name="kind" defaultValue="payment"><option value="payment">Payment received</option><option value="refund">Refund issued</option></select></label>
      <label>Method<select name="method" defaultValue="card"><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setAmountConfirmed(true); }} required /></label>
    </div>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || !amountConfirmed || Number(amount) <= 0}>{pending ? "Recording…" : "Record entry"}</button>
  </form>;
}
