"use client";

import { useActionState, useState } from "react";
import { updateBookingDetails } from "@/app/app/calendars/actions";

type SaveState = { error?: string; saved?: boolean };
type Details = { name: string; email: string; phone: string };

export function SaleAppointmentDetailsForm({ bookingId, name, email, phone }: Details & { bookingId: string }) {
  const [details, setDetails] = useState({ name, email, phone });
  const [saved, setSaved] = useState({ name, email, phone });
  const [state, submit, pending] = useActionState<SaveState, FormData>(async (_, data) => {
    try {
      const result = await updateBookingDetails(data);
      if (result.error) return { error: result.error };
      setSaved(details);
      return { saved: true };
    } catch {
      return { error: "Could not save details. Please try again." };
    }
  }, {});
  const changed = details.name !== saved.name || details.email !== saved.email || details.phone !== saved.phone;

  return <form action={submit} className="tenant-drawer-form">
    <input type="hidden" name="bookingId" value={bookingId} />
    <label>Name<input name="customerName" value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} required /></label>
    <div className="tenant-drawer-form__grid">
      <label>Email<input name="customerEmail" type="email" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} required /></label>
      <label>Phone<input name="customerPhone" type="tel" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} /></label>
    </div>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
    {state.saved && !changed ? <p className="manual-appointment__message is-success" role="status">Details saved.</p> : null}
    <button type="submit" className="waybook-action waybook-action--secondary" disabled={pending || !changed}>{pending ? "Saving…" : "Save details"}</button>
  </form>;
}
