"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { hasNonGiftCardPayment } from "@/lib/waybook/appointment-payment-records";
import type { AppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { recordPayment, type PaymentState } from "@/app/app/calendars/actions";

const paymentMethods = [
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

export function PaymentMethodOptions() {
  return <>{paymentMethods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</>;
}

export function AppointmentPaymentForm({ bookingId, balance, onRecorded, checkout = false, requireFullBalance = false, canFinishCheckout = false, manualSplit = false, giftCardHref, refundOnly = false }: {
  bookingId: string;
  balance: AppointmentPaymentBalance;
  onRecorded?: (bookingId: string) => Promise<void>;
  checkout?: boolean;
  requireFullBalance?: boolean;
  canFinishCheckout?: boolean;
  manualSplit?: boolean;
  giftCardHref?: string;
  refundOnly?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PaymentState>({ error: null, success: null });
  const [pending, setPending] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const submitting = useRef(false);
  const interrupted = useRef<FormData | null>(null);
  const { outstandingCents, refundableCents, payments } = balance;
  const canAddPayment = (manualSplit || !hasNonGiftCardPayment(payments)) && outstandingCents > 0;
  const [entryKind, setKind] = useState("");
  const kind = refundOnly ? "refund" : checkout ? "payment" : entryKind;
  const [method, setMethod] = useState(refundOnly ? payments[0]?.method ?? "" : checkout ? "" : "card");
  const [draftAmount, setDraftAmount] = useState<string | null>(null);
  const settlingGiftCard = kind === "payment" && canAddPayment && payments.some(({ method }) => method === "gift_card");
  const remainingAmount = kind !== "refund" && canAddPayment ? (outstandingCents / 100).toFixed(2) : "";
  const fixedAmount = settlingGiftCard || requireFullBalance;
  const amount = fixedAmount ? remainingAmount : draftAmount ?? remainingAmount;
  const finishCheckout = canFinishCheckout && canAddPayment && Number(amount) === Number(remainingAmount);
  const partialPayment = manualSplit && !fixedAmount && Number(amount) > 0 && Number(amount) < Number(remainingAmount);
  const recordLabel = refundOnly ? "Record refund" : finishCheckout ? "Record payment and finish checkout"
    : partialPayment ? "Record partial payment" : checkout ? "Record payment" : "Record entry";
  const editingDisabled = pending || retryRequired;
  const canRecord = (kind === "payment" && canAddPayment || kind === "refund" && refundableCents > 0) && Boolean(method) && Number(amount) > 0;

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
        if (checkout) setMethod("");
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
    {finishCheckout ? <input type="hidden" name="finishCheckout" value="true" /> : null}
    {settlingGiftCard ? <p className="sale-detail__note">Gift card applied. Record the remaining balance.</p> : null}
    <div className={`tenant-drawer-form__grid${checkout ? " appointment-payment-form__amount" : ""}`}>
      {refundOnly ? <input type="hidden" name="kind" value="refund" /> : checkout ? <><input type="hidden" name="kind" value="payment" /><input type="hidden" name="expectedBalanceCents" value={outstandingCents} /></> : <label>Payment<select name="kind" value={kind} onChange={(event) => changeKind(event.target.value)} disabled={editingDisabled} required>
        <option value="" disabled>Select payment action</option>
        {canAddPayment || kind === "payment" ? <option value="payment" disabled={!canAddPayment}>Payment received</option> : null}
        <option value="refund" disabled={refundableCents <= 0}>Refund issued</option>
      </select></label>}
      {!checkout ? <label>Method<select name="method" value={method} onChange={(event) => setMethod(event.target.value)} disabled={editingDisabled} required>
        {refundOnly ? paymentMethods.filter(({ value }) => payments.some(payment => payment.method === value))
          .map(({ value, label }) => <option key={value} value={value}>{label}</option>) : <PaymentMethodOptions />}
      </select></label> : null}
      <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" step="0.01" value={amount} readOnly={fixedAmount} onChange={(event) => setDraftAmount(event.target.value)} disabled={editingDisabled} required /></label>
    </div>
    {checkout ? <fieldset className="appointment-payment-methods" disabled={editingDisabled}>
      <legend>Payment method</legend>
      <div className="appointment-payment-methods__choices">
        {paymentMethods.map(({ value, label }) => <label key={value} className="appointment-payment-methods__option">
          <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} required />
          <span>{value === "card" ? "Card paid elsewhere" : label}</span>
        </label>)}
        {giftCardHref ? (editingDisabled
          ? <span className="appointment-payment-methods__option" aria-disabled="true">Gift card</span>
          : <Link className="appointment-payment-methods__option" href={giftCardHref}>Gift card</Link>) : null}
      </div>
    </fieldset> : null}
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || (!retryRequired && !canRecord)}>
      {pending ? "Recording…" : retryRequired ? "Retry entry" : recordLabel}
    </button>
  </form>;
}
