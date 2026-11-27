"use client";

import Link from "next/link";
import { ArrowUpRight, Ellipsis, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCalendarAppointment, updateBookingDetails, rescheduleBooking, saveAppointmentAttendance, cancelAppointment } from "@/app/app/calendars/actions";
import { AppointmentDrawerActions, AppointmentRescheduleActions, AppointmentStatusActions } from "@/components/appointment-drawer-actions";
import { AppointmentServiceEditor } from "@/components/appointment-service-editor";
import { AppointmentClientCard } from "@/components/appointment-client-card";
import { AppointmentAttendanceJourney } from "@/components/appointment-attendance-journey";
import { CancelAppointmentForm } from "@/components/cancel-appointment-form";
import { TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { appointmentDrawerCapabilities } from "@/lib/waybook/appointment-drawer-capabilities";

import { appointmentStageLabels, isMovableAppointmentStatus } from "@/lib/waybook/appointment-lifecycle";

const servicePrice = new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK" });

type Detail = NonNullable<Awaited<ReturnType<typeof getCalendarAppointment>>>;
export type CalendarAppointmentSummary = Pick<Detail, "id" | "bookingNumber" | "customerName" | "serviceTitle" | "teamMemberName" | "startsAt" | "endsAt" | "status" | "attendanceStage">;

export function CalendarAppointmentDrawer({ summaries, initialDetail, timezone, checkoutPath, clientPath, clientLabel = "Client", staffLabel = "Staff" }: { summaries: CalendarAppointmentSummary[]; initialDetail: Detail | null; timezone: string; checkoutPath: string; clientPath: string; clientLabel?: string; staffLabel?: string }) {
  const [selected, setSelected] = useState<CalendarAppointmentSummary | null>(initialDetail);
  const [detail, setDetail] = useState<Detail | null>(initialDetail);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"edit" | "reschedule" | "cancel" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const actionPanel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;

  useEffect(() => {
    if (initialDetail && new URL(window.location.href).searchParams.get("booking") === initialDetail.id) {
      setSelected(initialDetail); setDetail(initialDetail); setError("");
    }
  }, [initialDetail]);

  useEffect(() => {
    if (mode) actionPanel.current?.focus();
  }, [mode]);

  const load = useCallback((id: string) => {
    setMode(null);
    setMenuOpen(false);
    const serial = ++request.current;
    setError("");
    setDetail(null);
    setSelected(summariesRef.current.find((item) => item.id === id) ?? { id, bookingNumber: "", customerName: "Appointment", serviceTitle: "", teamMemberName: "", startsAt: "", endsAt: "", status: "", attendanceStage: null });
    void getCalendarAppointment(id).then((result) => {
      if (request.current !== serial) return;
      if (result) { setSelected(result); setDetail(result); }
      else { setSelected(null); setDetail(null); }
    }).catch(() => { if (request.current === serial) setError("Could not load this appointment. Please try again."); });
  }, []);

  const refreshAppointment = async (bookingId: string) => {
    const serial = request.current;
    const updated = await getCalendarAppointment(bookingId);
    if (serial === request.current) {
      setSelected(updated);
      setDetail(updated);
    }
  };

  const close = useCallback(() => {
    setMode(null);
    setMenuOpen(false);
    ++request.current;
    setSelected(null); setDetail(null); setError("");
    const url = new URL(window.location.href); url.searchParams.delete("booking");
    // A reloaded drawer retains its history state but has a new document.
    if (window.history.state?.waybookBookingDrawer === performance.timeOrigin) window.history.back();
    else window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download") || link.hasAttribute("data-appointment-navigation")) return;
      const url = new URL(link.href, window.location.href);
      const id = url.searchParams.get("booking");
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !id || !summariesRef.current.some((item) => item.id === id)) return;
      event.preventDefault(); event.stopPropagation();
      window.history.pushState({ waybookBookingDrawer: performance.timeOrigin }, "", url); load(id);
    };
    const onPopState = () => {
      const id = new URL(window.location.href).searchParams.get("booking");
      if (id) load(id); else { ++request.current; setSelected(null); setDetail(null); setError(""); setMode(null); setMenuOpen(false); }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("popstate", onPopState); };
  }, [load]);

  if (!selected) return null;
  const attendanceLabel = selected.attendanceStage ? appointmentStageLabels[selected.attendanceStage] : undefined;
  const capabilities = detail ? appointmentDrawerCapabilities(detail) : null;
  const movable = detail && isMovableAppointmentStatus(detail.status);
  const canReschedule = Boolean(movable && capabilities?.canReschedule && detail.days.length);
  const canCancel = Boolean(movable && capabilities?.canCancel);
  const canEdit = Boolean(detail?.status !== "cancelled" && (capabilities?.canEdit || capabilities?.canUpdateStatus || canReschedule));
  const rescheduleOptions = canReschedule && detail ? <AppointmentRescheduleActions key={detail.id}
    bookingId={detail.id} status={detail.status} timezone={detail.timezone} days={detail.days} slots={detail.slots}
    currentStartsAt={detail.startsAt} linkedServices={detail.additionalServices.length > 0} reschedule={rescheduleBooking} /> : null;
  const date = selected.startsAt ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(selected.startsAt)) : "";
  const services = detail ? [{
    id: detail.id, title: detail.serviceTitle, provider: detail.teamMemberName,
    startsAt: detail.startsAt, endsAt: detail.endsAt, priceCents: detail.primaryServicePriceCents,
  }, ...detail.additionalServices] : [];
  const historyDate = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  const clock = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
  return <TenantEditorDialog title={`Appointment with ${selected.customerName}`} onDismiss={close} cycleFocus>
    <aside className="tenant-drawer appointment-drawer manual-appointment-drawer calendar-appointment-drawer" aria-label={`Appointment with ${selected.customerName}`}>
      <header>
        <div><h2>Appointment</h2></div>
        <div className="appointment-drawer__header-actions tenant-drawer-header-actions">
          {mode === "edit" ? <span data-appointment-save-action style={{ display: "contents" }} /> : null}
          {canReschedule || canCancel ? <div className="appointment-action-popover"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !menuOpen) return;
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
              menuButton.current?.focus();
            }}>
            <button ref={menuButton} type="button" className="calendar-drawer-icon" aria-label="More appointment actions"
              aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              <Ellipsis size={19} aria-hidden="true" />
            </button>
            {menuOpen ? <div className="appointment-action-popover__panel" role="group" aria-label="More appointment actions">
              {canReschedule ? <button type="button" onClick={() => { setMode("reschedule"); setMenuOpen(false); actionPanel.current?.focus(); }}>Reschedule</button> : null}
              {canCancel ? <button type="button" onClick={() => { setMode("cancel"); setMenuOpen(false); actionPanel.current?.focus(); }}>Cancellation options</button> : null}
            </div> : null}
          </div> : null}
          {canEdit ? <button type="button" className="calendar-drawer-icon" aria-label={mode ? "Close editing" : "Edit appointment"}
            aria-expanded={Boolean(mode)} onClick={() => setMode(mode ? null : "edit")}>
            {mode ? <X size={17} aria-hidden="true" /> : <Pencil size={17} aria-hidden="true" />}
          </button> : null}
          <button type="button" className="tenant-drawer-close" aria-label="Close appointment" onClick={(event) => {
            event.currentTarget.closest("dialog")?.close();
            close();
          }}>×</button>
        </div>
      </header>
      <div className="appointment-drawer__body">
        <div className="calendar-appointment-drawer__actions">
          <div className="calendar-appointment-drawer__state">
            <span className="calendar-appointment-drawer__status-dot" data-stage={selected.attendanceStage ?? selected.status} aria-hidden="true" />
            <dl className="appointment-drawer__detail--status"><dt className="sr-only">Status</dt><dd>{attendanceLabel ?? selected.status.replace("_", " ")}</dd></dl>
          </div>
          {detail && capabilities ? <>
            <AppointmentAttendanceJourney key={detail.id} bookingId={detail.id} status={detail.status}
              stage={detail.attendanceStage} canUpdateStatus={capabilities.canUpdateStatus}
              canCheckIn={detail.canCheckIn} canOpenCheckout={detail.canChangeAttendanceNow} canManage={detail.canManage}
              canNotifyProviders={detail.canNotifyProviders} checkoutPath={checkoutPath} onChange={refreshAppointment} />
            {detail.serviceEditor ? <AppointmentServiceEditor key={`${detail.id}-${detail.serviceEditor.revision}`}
              bookingId={detail.id} locationId={detail.locationId} timezone={detail.timezone} editor={detail.serviceEditor} onSaved={refreshAppointment} /> : null}
          </> : null}
        </div>
        <section className="appointment-drawer__details" aria-label="Schedule"><dl>
          <div className="appointment-drawer__detail--date"><dt>Date</dt><dd>{date}</dd></div>
          <div className="appointment-drawer__detail--time"><dt>Time</dt><dd>{clock(selected.startsAt)}–{clock(selected.endsAt)}</dd></div>
          {detail?.locationName ? <div><dt>Location</dt><dd>{detail.locationName}</dd></div> : null}
        </dl></section>
        {error ? <p role="alert">{error}</p> : !detail || !capabilities ? <p role="status">Loading appointment details…</p> : <>
          <section className="calendar-appointment-drawer__client" aria-label={clientLabel}>
            <div className="calendar-appointment-drawer__client-heading">
              <span className="calendar-appointment-drawer__avatar" aria-hidden="true">
                {detail.customerName.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase()}
              </span>
              <div>
                <h3>{detail.customerName}</h3>
                {detail.clientRecord ? <p>{clientLabel} since {new Intl.DateTimeFormat("en-GB", { timeZone: timezone, month: "long", year: "numeric" }).format(new Date(detail.clientRecord.createdAt))}</p> : null}
              </div>
              {detail.clientRecord ? <Link className="waybook-action waybook-action--secondary"
                href={`${clientPath}?customer=${encodeURIComponent(detail.clientRecord.id)}`}>
                Open {clientLabel.toLowerCase()} <ArrowUpRight size={14} aria-hidden="true" />
              </Link> : null}
            </div>
            {detail.clientRecord && (detail.customerPhone || detail.customerEmail) ? <dl>
              {detail.customerPhone ? <div><dt>Phone</dt><dd><a href={`tel:${detail.customerPhone.replace(/[^+0-9]/g, "")}`}>{detail.customerPhone}</a></dd></div> : null}
              {detail.customerEmail ? <div><dt>Email</dt><dd><a href={`mailto:${encodeURIComponent(detail.customerEmail)}`}>{detail.customerEmail}</a></dd></div> : null}
            </dl> : null}
            {detail.clientCard ? <AppointmentClientCard key={detail.id} bookingId={detail.id} card={detail.clientCard} /> : null}
          </section>
          <section className="calendar-appointment-drawer__services" aria-label="Booked services">
            <h3>Services</h3>
            <ul>{services.map((service) => <li key={service.id}>
              <div>
                <strong>{service.title}</strong>
                <span>{clock(service.startsAt)}–{clock(service.endsAt)}{service.provider ? ` · ${service.provider}` : ` · No ${staffLabel.toLowerCase()} assigned`}</span>
              </div>
              <div>
                {service.priceCents != null ? <strong>{servicePrice.format(service.priceCents / 100)}</strong> : null}
                <span>{Math.round((Date.parse(service.endsAt) - Date.parse(service.startsAt)) / 60_000)} min</span>
              </div>
            </li>)}</ul>
          </section>
          <section className="calendar-appointment-drawer__booking" aria-label="Booking details">
            <h3>Booking details</h3>
            <dl>
              <div><dt>Booking number</dt><dd>{selected.bookingNumber}</dd></div>
              {detail.activity ? <>
                <div><dt>Booked on</dt><dd>{historyDate.format(new Date(detail.activity.createdAt))}</dd></div>
                <div><dt>Booked through</dt><dd>{detail.activity.source === "public" ? "Online booking" : "Workspace"}</dd></div>
                {detail.activity.bookedBy ? <div><dt>Booked by</dt><dd>{detail.activity.bookedBy}</dd></div> : null}
                {detail.activity.updatedAt !== detail.activity.createdAt ? <div><dt>Last updated</dt><dd>{historyDate.format(new Date(detail.activity.updatedAt))}</dd></div> : null}
                {detail.activity.updatedBy ? <div><dt>Updated by</dt><dd>{detail.activity.updatedBy}</dd></div> : null}
              </> : null}
            </dl>
          </section>
          {detail.status === "cancelled" && capabilities.canCancel ? <AppointmentStatusActions
            bookingId={detail.id} status={detail.status} canChangeAttendanceNow={false} updateStatus={saveAppointmentAttendance} /> : null}
          {mode && detail.status !== "cancelled" ? <div className="calendar-appointment-drawer__edit" ref={actionPanel} tabIndex={-1}>
            {mode === "edit" && (capabilities.canEdit ? (
              <AppointmentDrawerActions key={detail.id} bookingId={detail.id} paymentBalance={detail.paymentBalance}
                onPaymentRecorded={refreshAppointment} customerName={detail.customerName} customerEmail={detail.customerEmail}
                customerPhone={detail.customerPhone} status={detail.status} canChangeAttendanceNow={detail.canChangeAttendanceNow}
                separateCheckIn attendanceLabel={attendanceLabel} onStatusSaved={refreshAppointment} timezone={detail.timezone} days={detail.days}
                slots={detail.slots} currentStartsAt={detail.startsAt} linkedServices={detail.additionalServices.length > 0}
                saveDetails={updateBookingDetails} reschedule={rescheduleBooking} resourceId={detail.resourceId} resources={detail.resources} />
            ) : <>
              {capabilities.canUpdateStatus ? <AppointmentStatusActions bookingId={detail.id} status={detail.status}
                canChangeAttendanceNow={detail.canChangeAttendanceNow} separateCheckIn attendanceLabel={attendanceLabel}
                onStatusSaved={refreshAppointment} updateStatus={saveAppointmentAttendance} /> : null}
              {rescheduleOptions}
            </>)}
            {mode === "reschedule" ? rescheduleOptions : null}
            {mode === "cancel" && canCancel ? <section><h3>Cancel this appointment?</h3><CancelAppointmentForm bookingId={detail.id} cancelAppointment={cancelAppointment} /></section> : null}
          </div> : null}
          {!canEdit && !canCancel && !capabilities.canCancel ? <p className="tenant-drawer-note">You have view-only access to this appointment.</p> : null}
        </>}
      </div>
    </aside>
  </TenantEditorDialog>;
}
