"use client";

import { useFormStatus } from "react-dom";

export function StripeOnboardingButton({ label, checkStatus = false }: { label: string; checkStatus?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={checkStatus ? "waybook-action waybook-action--secondary" : "waybook-action"} type="submit" disabled={pending}>
    {pending ? checkStatus ? "Checking Stripe…" : "Opening Stripe…" : label}
  </button>;
}
