"use client";

import { useFormStatus } from "react-dom";

export function StripeOnboardingButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="waybook-action" type="submit" disabled={pending}>{pending ? "Opening Stripe…" : label}</button>;
}
