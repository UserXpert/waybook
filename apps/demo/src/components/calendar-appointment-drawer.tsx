"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCalendarAppointment, updateBookingDetails, rescheduleBooking, saveAppointmentAttendance, cancelAppointment } from "@/app/app/calendars/actions";
import { AppointmentDrawerActions, AppointmentRescheduleActions, AppointmentStatusActions } from "@/components/appointment-drawer-actions";
import { AppointmentServiceEditor } from "@/components/appointment-service-editor";
import { AppointmentAttendanceJourney } from "@/components/appointment-attendance-journey";
import { CancelAppointmentForm } from "@/components/cancel-appointment-form";
import { TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { appointmentDrawerCapabilities } from "@/lib/waybook/appointment-drawer-capabilities";

import { appointmentStageLabels, isMovableAppointmentStatus } from "@/lib/waybook/appointment-lifecycle";

type Detail = NonNullable<Awaited<ReturnType<typeof getCalendarAppointment>>>;
export type CalendarAppointmentSummary = Pick<Detail, "id" | "bookingNumber" | "customerName" | "serviceTitle" | "teamMemberName" | "startsAt" | "endsAt" | "status" | "attendanceStage">;

export function CalendarAppointmentDrawer({ summaries, initialDetail, timezone, checkoutPath, staffLabel = "Staff" }: { summaries: CalendarAppointmentSummary[]; initialDetail: Detail | null; timezone: string; checkoutPath: string; staffLabel?: string }) {
  const [selected, setSelected] = useState<CalendarAppointmentSummary | null>(initialDetail);
  const [detail, setDetail] = useState<Detail | null>(initialDetail);
  const [error, setError] = useState("");
  const request = useRef(0);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;

  useEffect(() => {
    if (initialDetail && new URL(window.location.href).searchParams.get("booking") === initialDetail.id) {
      setSelected(initialDetail); setDetail(initialDetail); setError("");
    }
  }, [initialDetail]);

  const load = useCallback((id: string) => {
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
      if (id) load(id); else { ++request.current; setSelected(null); setDetail(null); setError(""); }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("popstate", onPopState); };
  }, [load]);

  if (!selected) return null;
  const attendanceLabel = selected.attendanceStage ? appointmentStageLabels[selected.attendanceStage] : undefined;
  const capabilities = detail ? appointmentDrawerCapabilities(detail) : null;
  const date = selected.startsAt ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(selected.startsAt)) : "";
  const clock = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
  return <TenantEditorDialog title={`Appointment with ${selected.customerName}`} onDismiss={close} cycleFocus>
    <aside className="tenant-drawer appointment-drawer manual-appointment-drawer calendar-appointment-drawer" aria-label={`Appointment with ${selected.customerName}`}>
      <header><div><p>APPOINTMENT</p><h2>{selected.customerName}</h2></div><div className="appointment-drawer__header-actions tenant-drawer-header-actions"><span data-appointment-save-action style={{ display: "contents" }} /><button type="button" className="tenant-drawer-close" aria-label="Close appointment" onClick={(event) => {
        event.currentTarget.closest("dialog")?.close();
        close();
      }}>×</button></div></header>
      <div className="appointment-drawer__body">
        <section className="appointment-drawer__details"><dl>
          <div className="appointment-drawer__detail--status"><dt>Status</dt><dd>{attendanceLabel ?? selected.status.replace("_", " ")}</dd></div>
          <div className="appointment-drawer__detail--date"><dt>Date</dt><dd>{date}</dd></div>
          <div className="appointment-drawer__detail--time"><dt>Time</dt><dd>{clock(selected.startsAt)}–{clock(selected.endsAt)}</dd></div>
          <div><dt>Service</dt><dd>{selected.serviceTitle}</dd></div><div><dt>{staffLabel}</dt><dd>{selected.teamMemberName}</dd></div><div><dt>Booking number</dt><dd>{selected.bookingNumber}</dd></div>
        </dl></section>
        {error ? <p role="alert">{error}</p> : !detail || !capabilities ? <p role="status">Loading appointment details…</p> : <>
          <AppointmentAttendanceJourney key={detail.id} bookingId={detail.id} status={detail.status}
            stage={detail.attendanceStage} canUpdateStatus={capabilities.canUpdateStatus}
            canCheckIn={detail.canCheckIn} canOpenCheckout={detail.canChangeAttendanceNow} canManage={detail.canManage}
            canNotifyProviders={detail.canNotifyProviders} checkoutPath={checkoutPath} onChange={refreshAppointment} />
          {detail.additionalServices.length > 0 ? <section className="appointment-drawer__details">
            <h3>Additional services</h3>
            <dl>{detail.additionalServices.map((service) => <div key={service.id}>
              <dt>{service.title}</dt>
              <dd>{clock(service.startsAt)}–{clock(service.endsAt)}{service.provider ? ` · ${service.provider}` : ""}</dd>
            </div>)}</dl>
          </section> : null}
          {detail.serviceEditor ? <AppointmentServiceEditor key={`${detail.id}-${detail.serviceEditor.revision}`}
            bookingId={detail.id} locationId={detail.locationId} timezone={detail.timezone} editor={detail.serviceEditor} onSaved={refreshAppointment} /> : null}
          {capabilities.canEdit ? (
            <AppointmentDrawerActions key={detail.id} bookingId={detail.id} paymentBalance={detail.paymentBalance} onPaymentRecorded={refreshAppointment} customerName={detail.customerName} customerEmail={detail.customerEmail} customerPhone={detail.customerPhone} status={detail.status} canChangeAttendanceNow={detail.canChangeAttendanceNow} separateCheckIn attendanceLabel={attendanceLabel} onStatusSaved={refreshAppointment} timezone={detail.timezone} days={detail.days} slots={detail.slots} currentStartsAt={detail.startsAt} linkedServices={detail.additionalServices.length > 0} saveDetails={updateBookingDetails} reschedule={rescheduleBooking} resourceId={detail.resourceId} resources={detail.resources} />
          ) : <>
            {capabilities.canUpdateStatus || (capabilities.canCancel && detail.status === "cancelled") ? <AppointmentStatusActions bookingId={detail.id} status={detail.status} canChangeAttendanceNow={detail.canChangeAttendanceNow} separateCheckIn attendanceLabel={attendanceLabel} onStatusSaved={refreshAppointment} updateStatus={saveAppointmentAttendance} /> : null}
            {capabilities.canReschedule ? <AppointmentRescheduleActions key={detail.id} bookingId={detail.id} status={detail.status} timezone={detail.timezone} days={detail.days} slots={detail.slots} currentStartsAt={detail.startsAt} linkedServices={detail.additionalServices.length > 0} reschedule={rescheduleBooking} /> : null}
            {!capabilities.canUpdateStatus && !capabilities.canReschedule ? <p className="tenant-drawer-note">You have view-only access to this appointment.</p> : null}
          </>}
          {capabilities.canCancel && isMovableAppointmentStatus(detail.status) ? <CancelAppointmentForm bookingId={detail.id} cancelAppointment={cancelAppointment} /> : null}
        </>}
      </div>
    </aside>
  </TenantEditorDialog>;
}
