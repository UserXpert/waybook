"use client";

import { useEffect, useRef } from "react";
import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import { checkStripePracticePayment } from "../../settings/payment-actions";

export function PracticePaymentCheck({ saleId, returned }: { saleId: string; returned: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!returned || submitted.current) return;
    submitted.current = true;
    form.current?.requestSubmit();
  }, [returned]);

  return <form ref={form} action={checkStripePracticePayment}>
    {returned ? <p role="status">Confirming your test payment…</p> : null}
    <input type="hidden" name="saleId" value={saleId} />
    <StripeOnboardingButton label="Check test payment" checkStatus />
  </form>;
}
