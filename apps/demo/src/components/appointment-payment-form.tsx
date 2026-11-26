"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { recordPayment, type PaymentState } from "@/app/app/calendars/actions";

export function AppointmentPaymentForm({ bookingId, balance, onRecorded, secondary = false }: {
  bookingId: string;
  balance: AppointmentPaymentBalance;
  onRecorded?: (bookingId: string) => Promise<void>;
  secondary?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PaymentState>({ error: null, success: null });
  const [pending, setPending] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const submitting = useRef(false);
  const interrupted = useRef<FormData | null>(null);
  const { outstandingCents, refundableCents, payments } = balance;
  const canAddPayment = payments.length === 0 && outstandingCents > 0;
  const [kind, setKind] = useState("");
  const [draftAmount, setDraftAmount] = useState<string | null>(null);
  const amount = draftAmount ?? (kind !== "refund" && canAddPayment ? (outstandingCents / 100).toFixed(2) : "");
  const editingDisabled = pending || retryRequired;
  const canRecord = (kind === "payment" && canAddPayment || kind === "refund" && refundableCents > 0) && Number(amount) > 0;

  function changeKind(nextKind: string) {
    if (nextKind === "refund" || kind === "refund") setDraftAmount(null);
    setKind(nextKind);
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || (!interrupted.current && !canRecord)) return;
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
        setKind("");
        setDraftAmount(null);
        if (onRecorded) await onRecorded(bookingId).catch(() => router.refresh());
        else router.refresh();
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
      <label>Payment<select name="kind" value={kind} onChange={(event) => changeKind(event.target.value)} disabled={editingDisabled} required>
        <option value="" disabled>Select payment action</option>
        {canAddPayment || kind === "payment" ? <option value="payment" disabled={!canAddPayment}>Payment received</option> : null}
        <option value="refund" disabled={refundableCents <= 0}>Refund issued</option>
      </select></label>
      <label>Method<select name="method" defaultValue="card" disabled={editingDisabled}><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setDraftAmount(event.target.value)} disabled={editingDisabled} required /></label>
    </div>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" className={secondary ? "waybook-action waybook-action--secondary" : undefined} disabled={pending || (!retryRequired && !canRecord)}>
      {pending ? "Recording…" : retryRequired ? "Retry entry" : "Record entry"}
    </button>
  </form>;
}
