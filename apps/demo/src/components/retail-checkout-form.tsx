"use client";

import { useRouter, unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RetailCheckoutResult } from "@/app/app/sales/retail/actions";
import { clearSuccessToast } from "@/lib/waybook/toast";

export function RetailCheckoutForm({ action, children, submitLabel }: {
  action: (data: FormData) => Promise<RetailCheckoutResult>;
  children: React.ReactNode;
  submitLabel: string;
}) {
  const router = useRouter();
  const submitButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const interrupted = useRef<FormData | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (retry && !pending) submitButton.current?.focus();
  }, [pending, retry]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = interrupted.current ?? new FormData(form);
    if (!interrupted.current) data.set("entryId", crypto.randomUUID());
    submitting.current = true;
    clearSuccessToast();
    setPending(true);
    setError("");
    try {
      const result = await action(data);
      interrupted.current = null;
      setRetry(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      form.reset();
      router.push(result.href);
    } catch (error) {
      unstable_rethrow(error);
      interrupted.current = data;
      setRetry(true);
      setError("Could not confirm whether checkout was updated. Retry this action to check.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <form className="tenant-inline-form retail-checkout-form" onSubmit={submit}>
    {error ? <p className="manual-appointment__message is-error retail-checkout-form__error" role="alert">{error}</p> : null}
    <fieldset disabled={pending || retry}>{children}</fieldset>
    <button ref={submitButton} type="submit" disabled={pending}>{pending ? "Saving…" : retry ? "Retry checkout" : submitLabel}</button>
  </form>;
}
