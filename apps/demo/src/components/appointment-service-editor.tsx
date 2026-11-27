"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { SearchPicker } from "@/components/calendar-selectors";
import { updateAppointmentServices, type getCalendarAppointment } from "@/app/app/calendars/actions";
import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";
import { showSuccessToast } from "@/lib/waybook/toast";

type Editor = NonNullable<NonNullable<Awaited<ReturnType<typeof getCalendarAppointment>>>["serviceEditor"]>;
type Service = { id: string; title: string; priceCents: number; durationMinutes: number };
type Provider = { id: string; name: string };
type Row = { key: string; segmentId?: string; service: Service | null; provider: Provider | null; time: string };

const money = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });
function bookedService(item: Editor["primary"] | Editor["additional"][number]): Service {
  return { id: item.serviceId, title: item.title, priceCents: item.priceCents,
    durationMinutes: (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000 };
}

export function AppointmentServiceEditor({ bookingId, locationId, timezone, editor, onSaved }: {
  bookingId: string;
  locationId: string;
  timezone: string;
  editor: Editor;
  onSaved: (bookingId: string) => Promise<void>;
}) {
  const router = useRouter();
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const subtotal = (draft ?? []).reduce((sum, row) => sum + (row.service?.priceCents ?? 0), 0);
  const startEditing = () => {
    setError("");
    setOpenRow(null);
    setDraft([editor.primary, ...editor.additional].map((item, index) => ({
      key: item.id ?? bookingId,
      segmentId: item.id ?? undefined,
      service: bookedService(item),
      provider: item.teamMemberId && item.provider ? { id: item.teamMemberId, name: item.provider } : null,
      time: index > 0 ? clock.format(new Date(item.startsAt)) : "",
    })));
  };
  const editRow = (key: string, patch: Partial<Row>) =>
    setDraft((rows) => rows?.map((row) => row.key === key ? { ...row, ...patch } : row) ?? null);

  async function pickService(row: Row, index: number, service: Service) {
    if (service.id === row.service?.id) return;
    const original = index === 0 ? editor.primary : editor.additional.find((item) => item.id === row.segmentId);
    editRow(row.key, { service: original?.serviceId === service.id ? bookedService(original) : service, provider: null });
    const previousProvider = !row.service && draft?.[index - 1]?.provider;
    if (!previousProvider) return;
    try {
      const query = new URLSearchParams({ locationId, serviceId: service.id, q: previousProvider.name, limit: "50" });
      const response = await fetch(`${tenantApiPrefix()}/api/app/staff?${query}`);
      if (!response.ok) return;
      const { items } = await response.json() as { items: Provider[] };
      const provider = items.find((item) => item.id === previousProvider.id);
      if (!provider) return;
      setDraft((rows) => rows?.map((item) => item.key === row.key && item.service?.id === service.id && !item.provider
        ? { ...item, provider } : item) ?? null);
    } catch {
      // Staff can still choose a provider explicitly.
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !draft?.every((row) => row.service && row.provider)) return;
    const data = new FormData();
    data.set("bookingId", bookingId);
    data.set("revision", editor.revision);
    data.set("services", JSON.stringify(draft.map((row) => ({
      segmentId: row.segmentId, serviceId: row.service?.id, teamMemberId: row.provider?.id, time: row.time,
    }))));
    setSaving(true);
    setError("");
    try {
      const result = await updateAppointmentServices(data);
      if (result.error) { setError(result.error); return; }
      await onSaved(bookingId).catch(() => router.refresh());
      setDraft(null);
      showSuccessToast("Services saved");
      router.refresh();
    } catch {
      setError("Could not save the services. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <section aria-label="Appointment services" className={draft ? "appointment-service-editor--open" : undefined}>
    {draft ? <form className="tenant-drawer-form manual-appointment appointment-service-editor" data-drawer-inline-actions onSubmit={save}>
      <h3>Edit services</h3>
      {draft.map((row, index) => <div key={row.key} className="appointment-service-editor__row">
        <button type="button" className="appointment-service-editor__row-trigger" aria-expanded={openRow === row.key}
          aria-label={`Edit service ${index + 1}${row.service ? `, ${row.service.title}` : ""}`}
          disabled={saving} onClick={() => setOpenRow(openRow === row.key ? null : row.key)}>
          <span className="appointment-service-editor__overview">
            <strong>{row.service?.title ?? "Choose a service"}</strong>
            <span>{[row.provider?.name, index === 0 ? clock.format(new Date(editor.primary.startsAt)) : row.time || "After previous service",
              row.service ? `${row.service.durationMinutes} min` : null].filter(Boolean).join(" · ")}</span>
          </span>
          {row.service ? <span>{money.format(row.service.priceCents / 100)}</span> : null}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {openRow === row.key ? <fieldset className="appointment-service-editor__fields" disabled={saving}>
          <legend className="sr-only">{`Service ${index + 1}`}</legend>
          <SearchPicker<Service> label={`Choose service ${index + 1}`} selectedLabel={row.service?.title ?? ""}
            placeholder="Search services" searchUrl={(q) => `${tenantApiPrefix()}/api/app/services?${new URLSearchParams({ locationId, q, limit: "8" })}`}
            resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min · ${money.format(item.priceCents / 100)}`}
            browseOnFocus={!row.service} onPick={(service) => void pickService(row, index, service)} />
          <div className="tenant-drawer-form__grid">
            {row.service ? <SearchPicker<Provider> label={`Provider for service ${index + 1}`} selectedLabel={row.provider?.name ?? ""}
              placeholder="Search eligible staff"
              searchUrl={(q) => `${tenantApiPrefix()}/api/app/staff?${new URLSearchParams({ locationId, serviceId: row.service!.id, q, limit: "8" })}`}
              resultsLabel={(item) => item.name} onPick={(provider) => editRow(row.key, { provider })} /> : null}
            {index > 0 && row.service ? <label className="appointment-service-editor__time">{`Start time for service ${index + 1}`}
              <input type="time" value={row.time} onChange={(event) => editRow(row.key, { time: event.target.value })} />
              <small>Defaults to after the previous service.</small>
            </label> : null}
          </div>
          {index > 0 ? <button type="button" className="waybook-action waybook-action--secondary" onClick={() => {
            setDraft((rows) => rows?.filter((item) => item.key !== row.key) ?? null);
            setOpenRow(null);
          }}>Remove service {index + 1}</button> : null}
        </fieldset> : null}
      </div>)}
      {draft.length < 6 ? <button type="button" className="waybook-action waybook-action--secondary" disabled={saving} onClick={() =>
        {
          const key = crypto.randomUUID();
          setDraft((rows) => rows ? [...rows, { key, service: null, provider: null, time: "" }] : null);
          setOpenRow(key);
        }
      }>Add service</button> : null}
      {error ? <p role="alert" className="manual-appointment__message is-error">{error}</p> : null}
      <div className="appointment-service-editor__review">
        <div><span>Subtotal</span><strong>{money.format(subtotal / 100)}</strong></div>
        <div>
          <button type="button" className="waybook-action waybook-action--secondary" aria-label="Discard service changes"
            disabled={saving} onClick={() => { setDraft(null); setError(""); }}>Discard</button>
          <button type="submit" className="waybook-action" disabled={saving || !draft.every((row) => row.service && row.provider)}>{saving ? "Saving…" : "Save services"}</button>
        </div>
      </div>
    </form> : <button type="button" className="waybook-action waybook-action--secondary" onClick={startEditing}>Edit services</button>}
  </section>;
}
