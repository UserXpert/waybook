"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCalendarAppointment, updateBookingDetails, rescheduleBooking, updateBookingStatus, cancelAppointment } from "@/app/app/calendars/actions";
import { AppointmentDrawerActions, AppointmentStatusActions } from "@/components/appointment-drawer-actions";
import { CancelAppointmentForm } from "@/components/cancel-appointment-form";
import { appointmentDrawerCapabilities } from "@/lib/waybook/appointment-drawer-capabilities";

type Detail = Awaited<ReturnType<typeof getCalendarAppointment>>;
export type CalendarAppointmentSummary = Pick<Detail, "id" | "bookingNumber" | "customerName" | "serviceTitle" | "teamMemberName" | "startsAt" | "endsAt" | "status">;

export function CalendarAppointmentDrawer({ summaries, initialDetail, timezone }: { summaries: CalendarAppointmentSummary[]; initialDetail: Detail | null; timezone: string }) {
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
    setSelected(summariesRef.current.find((item) => item.id === id) ?? { id, bookingNumber: "", customerName: "Appointment", serviceTitle: "", teamMemberName: "", startsAt: "", endsAt: "", status: "" });
    void getCalendarAppointment(id).then((result) => {
      if (request.current === serial) { setSelected(result); setDetail(result); }
    }).catch(() => { if (request.current === serial) setError("Could not load this appointment. Please try again."); });
  }, []);

  const close = useCallback(() => {
    ++request.current;
    setSelected(null); setDetail(null); setError("");
    const url = new URL(window.location.href); url.searchParams.delete("booking");
    if (window.history.state?.waybookBookingDrawer) window.history.back();
    else window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const id = url.searchParams.get("booking");
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !id || !summariesRef.current.some((item) => item.id === id)) return;
      event.preventDefault(); event.stopPropagation();
      window.history.pushState({ waybookBookingDrawer: true }, "", url); load(id);
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
  const capabilities = detail ? appointmentDrawerCapabilities(detail) : null;
  const date = selected.startsAt ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(selected.startsAt)) : "";
  const clock = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
  return <div className="tenant-drawer-layer" role="presentation">
    <button type="button" className="tenant-drawer-scrim" aria-label="Close appointment" tabIndex={-1} onClick={close} />
    <aside className="tenant-drawer appointment-drawer manual-appointment-drawer" aria-label={`Appointment with ${selected.customerName}`}>
      <header><div><p>APPOINTMENT</p><h2>{selected.customerName}</h2></div><div className="appointment-drawer__header-actions"><button type="button" className="tenant-drawer-close" aria-label="Close appointment" onClick={close}>×</button></div></header>
      <div className="appointment-drawer__body">
        <section className="appointment-drawer__details"><dl>
          <div className="appointment-drawer__detail--status"><dt>Status</dt><dd>{selected.status.replace("_", " ")}</dd></div>
          <div className="appointment-drawer__detail--date"><dt>Date</dt><dd>{date}</dd></div>
          <div className="appointment-drawer__detail--time"><dt>Time</dt><dd>{clock(selected.startsAt)}–{clock(selected.endsAt)}</dd></div>
          <div><dt>Service</dt><dd>{selected.serviceTitle}</dd></div><div><dt>Staff</dt><dd>{selected.teamMemberName}</dd></div><div><dt>Booking number</dt><dd>{selected.bookingNumber}</dd></div>
        </dl></section>
        {error ? <p role="alert">{error}</p> : !detail || !capabilities ? <p role="status">Loading appointment details…</p> : capabilities.canEdit ? <>
          <AppointmentDrawerActions key={detail.id} bookingId={detail.id} customerName={detail.customerName} customerEmail={detail.customerEmail} customerPhone={detail.customerPhone} status={detail.status} timezone={detail.timezone} days={detail.days} slots={detail.slots} saveDetails={updateBookingDetails} reschedule={rescheduleBooking} updateStatus={updateBookingStatus} resourceId={detail.resourceId} resources={detail.resources} />
          {capabilities.canCancel && detail.status !== "cancelled" && detail.status !== "completed" ? <CancelAppointmentForm bookingId={detail.id} cancelAppointment={cancelAppointment} /> : null}
        </> : capabilities.canUpdateStatus ? <>
          <AppointmentStatusActions bookingId={detail.id} status={detail.status} updateStatus={updateBookingStatus} />
        </> : <p className="tenant-drawer-note">Read-only access: appointment changes require an owner or manager.</p>}
      </div>
    </aside>
  </div>;
}
