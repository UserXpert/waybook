"use client";

import { useActionState } from "react";
import { saveCustomerForm } from "@/app/app/customers/actions";

type Customer = { id?: string; name?: string; email?: string; phone?: string | null; tags?: string[]; internalNotes?: string | null };

export function CustomerForm({ customer }: { customer?: Customer | null }) {
  const [state, formAction, pending] = useActionState(saveCustomerForm, { error: null, success: null });
  return <form action={formAction} className="waybook-customer-form">
    <input type="hidden" name="customerId" value={customer?.id ?? ""} />
    <label>Name<input name="name" defaultValue={customer?.name ?? ""} required /></label>
    <label>Email<input name="email" type="email" defaultValue={customer?.email ?? ""} required /></label>
    <label>Phone<input name="phone" type="tel" defaultValue={customer?.phone ?? ""} /></label>
    <label>Tags<input name="tags" defaultValue={customer?.tags?.join(", ") ?? ""} placeholder="VIP, regular, referral" /><small>Comma-separated internal labels.</small></label>
    <label>Internal notes<textarea name="internalNotes" defaultValue={customer?.internalNotes ?? ""} rows={3} /></label>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save client"}</button>
  </form>;
}
