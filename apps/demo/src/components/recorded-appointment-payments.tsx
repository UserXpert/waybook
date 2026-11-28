"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { correctAppointmentPayment } from "@/app/app/calendars/actions";
import { manualPaymentMethods, paymentMethodLabels, type RecordedAppointmentPayment } from "@/lib/waybook/appointment-payment-records";
import { showSuccessToast } from "@/lib/waybook/toast";

const money = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });

export function RecordedAppointmentPayments({ bookingId, payments, onRecorded, allowEdit = true }: {
  bookingId: string;
  payments: RecordedAppointmentPayment[];
  onRecorded?: (id: string) => Promise<void>;
  allowEdit?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ payment: RecordedAppointmentPayment; operation: "edit" | "delete" } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const request = useRef<FormData | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || submitting.current) return;
    const data = request.current ?? new FormData(event.currentTarget);
    if (!request.current) {
      data.set("operationId", crypto.randomUUID());
      data.set("operation", selected.operation);
      data.set("bookingId", bookingId);
      data.set("paymentId", selected.payment.id);
      data.set("revision", selected.payment.revision ?? "");
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await correctAppointmentPayment(data);
      request.current = null;
      setRetry(false);
      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        showSuccessToast(result.success);
        setSelected(null);
        if (onRecorded) await onRecorded(bookingId).catch(() => router.refresh());
        else router.refresh();
      }
    } catch {
      request.current = data;
      setRetry(true);
      setError("Could not confirm the change. Retry to check whether it was saved.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <div className="recorded-appointment-payments">
    {payments.map((payment) => <div className="recorded-appointment-payments__item" key={payment.id}>
      <div><strong>{money.format(payment.amountCents / 100)}</strong><span>{payment.stripeSandbox
        ? payment.stripePaymentMethod === "mobilepay" ? "Stripe sandbox MobilePay" : "Stripe sandbox card"
        : paymentMethodLabels[payment.method] ?? payment.method}</span></div>
      {payment.stripeSandbox ? null : payment.method !== "gift_card" ? <div className="recorded-appointment-payments__actions">
        {allowEdit ? <button type="button" className="waybook-action waybook-action--secondary" disabled={pending || retry} onClick={() => { setError(""); setSelected({ payment, operation: "edit" }); }}>Edit payment</button> : null}
        <button type="button" className="waybook-action waybook-action--secondary" disabled={pending || retry} onClick={() => { setError(""); setSelected({ payment, operation: "delete" }); }}>Delete payment</button>
      </div> : <span>Refunds return to the original gift card.</span>}
      {selected?.payment.id === payment.id ? <form key={selected.operation} onSubmit={submit} className="recorded-appointment-payments__form">
        {selected.operation === "edit" ? <div className="tenant-drawer-form"><div className="tenant-drawer-form__grid">
          <label>Method<select name="method" defaultValue={selected.payment.method} disabled={pending || retry}>{manualPaymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select></label>
          <label>Amount (DKK)<input name="amountDkk" type="number" min="0.01" step="0.01" defaultValue={(selected.payment.amountCents / 100).toFixed(2)} required disabled={pending || retry} /></label>
        </div></div> : <p className="sale-detail__note">Delete this payment record? This does not send money back to the client.</p>}
        {error ? <p role="alert" className="manual-appointment__message is-error">{error}</p> : null}
        <div className="recorded-appointment-payments__actions">
          <button type="submit" className={selected.operation === "delete" ? "waybook-action waybook-action--danger" : "waybook-action"} disabled={pending}>
            {pending ? "Saving…" : retry ? "Retry change" : selected.operation === "delete" ? "Confirm deletion" : "Save payment"}
          </button>
          <button type="button" className="waybook-action waybook-action--secondary" disabled={pending || retry} onClick={() => { setSelected(null); setError(""); }}>Cancel</button>
        </div>
      </form> : null}
    </div>)}
  </div>;
}
