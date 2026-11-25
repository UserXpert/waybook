"use client";

import { useRef, useState, type FormEvent } from "react";
import { recordPayment, type PaymentState } from "@/app/app/calendars/actions";

export function AppointmentPaymentForm({ bookingId, outstandingCents }: { bookingId: string; outstandingCents: number }) {
  const [state, setState] = useState<PaymentState>({ error: null, success: null });
  const [pending, setPending] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const submitting = useRef(false);
  const interrupted = useRef<FormData | null>(null);
  const outstandingDkk = Math.max(0, outstandingCents) / 100;
  const [amount, setAmount] = useState(outstandingDkk ? outstandingDkk.toFixed(2) : "");
  const [amountConfirmed, setAmountConfirmed] = useState(false);
  const editingDisabled = pending || retryRequired;

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || (!interrupted.current && (!amountConfirmed || Number(amount) <= 0))) return;
    const data = interrupted.current ?? new FormData(event.currentTarget);
    if (!interrupted.current) data.set("entryId", crypto.randomUUID());
    submitting.current = true;
    setPending(true);
    setState({ error: null, success: null });
    try {
      const result = await recordPayment(data);
      interrupted.current = null;
      setRetryRequired(false);
      setState(result);
      if (result.success) {
        setAmount("");
        setAmountConfirmed(false);
      }
    } catch {
      interrupted.current = data;
      setRetryRequired(true);
      setState({ error: "Could not confirm whether the entry was recorded. Retry this entry to check.", success: null });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <form className="tenant-drawer-form appointment-payment-form" onSubmit={saveEntry}>
    <input type="hidden" name="bookingId" value={bookingId} />
    <div className="tenant-drawer-form__grid">
      <label>Entry<select name="kind" defaultValue="payment" disabled={editingDisabled}><option value="payment">Payment received</option><option value="refund">Refund issued</option></select></label>
      <label>Method<select name="method" defaultValue="card" disabled={editingDisabled}><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setAmountConfirmed(true); }} disabled={editingDisabled} required /></label>
    </div>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || (!retryRequired && (!amountConfirmed || Number(amount) <= 0))}>
      {pending ? "Recording…" : retryRequired ? "Retry entry" : "Record entry"}
    </button>
  </form>;
}
