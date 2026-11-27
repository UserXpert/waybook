"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { fromZonedTime } from "date-fns-tz";
import { tenantDateKey } from "@/lib/waybook/today-command-centre";
import { AppointmentServiceStartSelect } from "@/components/appointment-service-start-select";
import { findEligibleProvider, SearchPicker } from "@/components/calendar-selectors";
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
  const primaryStart = new Date(editor.primary.startsAt);
  const bookingDate = tenantDateKey(primaryStart, timezone);
  let previousEnd: Date | null = null;
  const draftStarts = (draft ?? []).map((row, index) => {
    const earliest = previousEnd;
    const start: Date | null = index === 0 ? primaryStart
      : row.time ? fromZonedTime(`${bookingDate}T${row.time}`, timezone) : earliest;
    previousEnd = start && row.service ? new Date(start.getTime() + row.service.durationMinutes * 60_000) : null;
    return {
      time: start ? clock.format(start) : "",
      earliest: earliest?.toISOString(),
      sequentialTime: earliest ? clock.format(earliest) : "",
    };
  });
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
    const provider = await findEligibleProvider(locationId, service.id, previousProvider);
    if (!provider) return;
    setDraft((rows) => rows?.map((item) => item.key === row.key && item.service?.id === service.id && !item.provider
      ? { ...item, provider } : item) ?? null);
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
            <span>{[row.provider?.name, draftStarts[index].time,
              row.service ? `${row.service.durationMinutes} min` : null].filter(Boolean).join(" · ")}</span>
          </span>
          {row.service ? <span>{money.format(row.service.priceCents / 100)}</span> : null}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {openRow === row.key ? <fieldset className="appointment-service-editor__fields" disabled={saving}>
          <legend className="sr-only">{`Service ${index + 1}`}</legend>
          {index > 0 ? <button type="button" className="appointment-service-remove" aria-label={`Remove service ${index + 1}`} onClick={() => {
            setDraft((rows) => rows?.filter((item) => item.key !== row.key) ?? null);
            setOpenRow(null);
          }}><X size={16} aria-hidden="true" /></button> : null}
          <SearchPicker<Service> label={`Choose service ${index + 1}`} selectedLabel={row.service?.title ?? ""}
            placeholder="Search services" searchUrl={(q) => `${tenantApiPrefix()}/api/app/services?${new URLSearchParams({ locationId, q, limit: "8" })}`}
            resultsLabel={(item) => `${item.title} · ${item.durationMinutes} min · ${money.format(item.priceCents / 100)}`}
            minimumQueryLength={1} browseOnFocus onPick={(service) => void pickService(row, index, service)} />
          <div className="tenant-drawer-form__grid">
            {row.service ? <SearchPicker<Provider> label={`Provider for service ${index + 1}`} selectedLabel={row.provider?.name ?? ""}
              placeholder="Search eligible staff"
              searchUrl={(q) => `${tenantApiPrefix()}/api/app/staff?${new URLSearchParams({ locationId, serviceId: row.service!.id, q, limit: "8" })}`}
              resultsLabel={(item) => item.name} onPick={(provider) => editRow(row.key, { provider })} /> : null}
            {index > 0 && row.service ? <AppointmentServiceStartSelect label={`Start time for service ${index + 1}`}
              bookingId={bookingId} segmentId={row.segmentId} locationId={locationId} date={bookingDate}
              serviceId={row.service.id} providerId={row.provider?.id} earliest={draftStarts[index].earliest}
              sequentialTime={draftStarts[index].sequentialTime} value={row.time}
              onChange={(time) => editRow(row.key, { time })} /> : null}
          </div>
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
