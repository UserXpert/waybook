"use client";

import { useActionState, useEffect } from "react";
import { saveCustomerForm } from "@/app/app/customers/actions";
import { showSuccessToast } from "@/lib/waybook/toast";

type Customer = { id?: string; name?: string; email?: string; phone?: string | null };

export function CustomerForm({ customer, clientLabel }: { customer?: Customer | null; clientLabel: string }) {
  const [state, formAction, pending] = useActionState(saveCustomerForm, { error: null, success: null });
  useEffect(() => {
    if (state.success) showSuccessToast(state.success);
  }, [state]);
  return <form action={formAction} className="waybook-customer-form">
    <input type="hidden" name="customerId" value={customer?.id ?? ""} />
    <label>Name<input name="name" defaultValue={customer?.name ?? ""} required /></label>
    <label>Email<input name="email" type="email" defaultValue={customer?.email ?? ""} required /></label>
    <label>Phone<input name="phone" type="tel" defaultValue={customer?.phone ?? ""} /></label>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending}>{pending ? "Saving…" : `Save ${clientLabel}`}</button>
  </form>;
}
