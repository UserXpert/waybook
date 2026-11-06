"use client";

import { useActionState } from "react";
import { addWaitlistEntry, saveWaitlistStatus } from "@/app/app/waitlist/actions";

type Customer = { id: string; name: string; email: string };
type Service = { id: string; title: string; durationMinutes: number };
type Location = { id: string; name: string };
type Staff = { id: string; name: string };

export function WaitlistForm({ customers, services, locations, staff }: { customers: Customer[]; services: Service[]; locations: Location[]; staff: Staff[] }) {
  const [state, action, pending] = useActionState(addWaitlistEntry, { error: null, success: null });
  return <form action={action} className="tenant-drawer-form waitlist-form">
    <label>Client<select name="customerId" required defaultValue=""><option value="" disabled>Choose a client</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label>
    <div className="tenant-drawer-form__grid"><label>Service<select name="serviceId" required defaultValue=""><option value="" disabled>Choose a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.title} · {service.durationMinutes} min</option>)}</select></label><label>Location<select name="locationId" required defaultValue=""><option value="" disabled>Choose a location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
    <label>Preferred staff <select name="preferredTeamMemberId" defaultValue=""><option value="">No preference</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    <fieldset><legend>Preferred appointment window <small>Optional</small></legend><div className="tenant-drawer-form__grid"><label>Date<input name="preferredLocalDate" type="date" /></label><label>From<input name="preferredStartTime" type="time" /></label><label>Until<input name="preferredEndTime" type="time" /></label></div></fieldset>
    <label>Internal note<textarea name="notes" rows={3} maxLength={1000} placeholder="Availability, flexibility, or context for the team" /></label>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add to waitlist'}</button>
  </form>;
}

export function WaitlistStatusForm({ entryId, status }: { entryId: string; status: string }) {
  return <form action={saveWaitlistStatus} className="waitlist-status-form"><input type="hidden" name="entryId" value={entryId} /><label>Status<select name="status" defaultValue={status}><option value="waiting">Waiting</option><option value="offered">Offer sent</option><option value="booked">Booked</option><option value="cancelled">Cancelled</option></select></label><button type="submit">Save</button></form>;
}
