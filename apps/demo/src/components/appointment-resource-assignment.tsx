"use client";

import { useState } from "react";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Resource = { id: string; name: string; isMutuallyExclusive: boolean };

export function AppointmentResourceAssignment({
  bookingId,
  initialResourceId,
  resources,
  assignResource,
}: {
  bookingId: string;
  initialResourceId: string | null;
  resources: Resource[];
  assignResource: ServerAction;
}) {
  const initialValue = initialResourceId ?? "";
  const [resourceId, setResourceId] = useState(initialValue);
  const changed = resourceId !== initialValue;
  const canSave = changed && (resourceId !== "" || initialValue !== "");

  return (
    <section className="appointment-resource-assignment">
      <h3>Resource assignment</h3>
      <form action={assignResource} className="tenant-drawer-form">
        <input type="hidden" name="bookingId" value={bookingId} />
        <label>
          Resource
          <select name="resourceId" value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
            <option value="">Unassigned</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}{resource.isMutuallyExclusive ? " · exclusive" : " · shared"}
              </option>
            ))}
          </select>
        </label>
        <p className="tenant-drawer-note appointment-resource-assignment__hint">Resources are assigned after booking. Exclusive resources reject overlaps; shared resources may overlap.</p>
        <button type="submit" disabled={!canSave}>Save resource</button>
      </form>
    </section>
  );
}
