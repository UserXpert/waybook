"use client";

import { CreditCard } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { updateAppointmentClientCard } from "@/app/app/calendars/actions";

const cardBrands: Record<string, string> = { amex: "American Express", mastercard: "Mastercard", visa: "Visa" };

export function AppointmentClientCard({ bookingId, card }: {
  bookingId: string;
  card: { brand: string | null; last4: string | null; pending: boolean };
}) {
  const [showConsent, setShowConsent] = useState(false);
  const [state, submit, submitting] = useActionState(updateAppointmentClientCard, { error: null, success: null });
  const checkedReturn = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (checkedReturn.current || !card.pending || url.searchParams.get("booking") !== bookingId ||
        url.searchParams.get("cardSetup") !== "return") return;
    checkedReturn.current = true;
    const form = new FormData();
    form.set("bookingId", bookingId);
    form.set("action", "return");
    startTransition(() => submit(form));
  }, [bookingId, card.pending, submit]);

  return <div>
    <dt><CreditCard size={16} aria-hidden="true" /><span className="sr-only">Card on file</span></dt>
    <dd className="appointment-client-card">{card.brand && card.last4
      ? <span>{cardBrands[card.brand] ?? "Card"} ending in {card.last4}</span>
      : <>
        {!showConsent ? <button className="waybook-action waybook-action--secondary" type="button"
          disabled={submitting} onClick={() => setShowConsent(true)}>
          {submitting ? "Checking Stripe…" : card.pending ? "Resume card setup" : "Add credit card"}
        </button> : <form action={submit} className="appointment-client-card__consent">
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="action" value="open" />
          <label><input type="checkbox" name="clientConsent" required /> The client agrees to save this card for future checkouts.</label>
          <small>Card details are entered on Stripe. No payment is taken.</small>
          <div className="appointment-client-card__line">
            <button className="waybook-primary-link" disabled={submitting}>{submitting ? "Opening Stripe…" : "Continue to Stripe"}</button>
            <button className="waybook-action waybook-action--secondary" type="button" disabled={submitting} onClick={() => setShowConsent(false)}>Cancel</button>
          </div>
        </form>}
        {state.error ? <small role="alert">{state.error}</small> : null}
      </>}
    </dd>
  </div>;
}
