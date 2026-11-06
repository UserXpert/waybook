"use client";

import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

type Props = {
  memberId: string;
  timezone: string;
  action: (formData: FormData) => void | Promise<void>;
  deleteAction?: (formData: FormData) => void | Promise<void>;
  initial?: { id: string; localDate: string; startTime: string | null; endTime: string | null; reason: string | null };
};
type DateMode = "day" | "range";
const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function parseDateKey(value: string) { return new Date(`${value}T12:00:00Z`); }
function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function addMonths(date: Date, amount: number) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1)); }
function firstOfMonth(value: string) { const date = parseDateKey(value); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parseDateKey(value)); }
function formatMonth(date: Date) { return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date); }
function monthDates(month: Date) {
  const firstDay = (month.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  return [...Array<string | null>(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => dateKey(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index + 1))))];
}
function timeLabel(value: string) { return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(`1970-01-01T${value}:00Z`)); }
function timeAt(slot: number) { return `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`; }

export function StaffTimeOffForm({ memberId, timezone, action, deleteAction, initial }: Props) {
  const today = useMemo(() => localDateKey(new Date(), timezone), [timezone]);
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [startDate, setStartDate] = useState(initial?.localDate ?? today);
  const [endDate, setEndDate] = useState(initial?.localDate ?? today);
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => firstOfMonth(today));
  const [fullDay, setFullDay] = useState(!initial?.startTime || !initial?.endTime);
  const [startSlot, setStartSlot] = useState(initial?.startTime ? Number(initial.startTime.slice(0, 2)) * 2 + (initial.startTime.endsWith("30") ? 1 : 0) : 18);
  const [endSlot, setEndSlot] = useState(initial?.endTime ? Number(initial.endTime.slice(0, 2)) * 2 + (initial.endTime.endsWith("30") ? 1 : 0) : 34);
  const [activeRangeHandle, setActiveRangeHandle] = useState<"start" | "end">("start");
  const months = [visibleMonth, addMonths(visibleMonth, 1)];
  const canGoBack = visibleMonth.getTime() > firstOfMonth(today).getTime();
  const selectedLabel = dateMode === "day" || startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} – ${formatDate(endDate)}`;

  function changeMode(nextMode: DateMode) {
    setDateMode(nextMode);
    setRangeAnchor(null);
    if (nextMode === "day") setEndDate(startDate);
  }
  function selectDate(value: string) {
    if (dateMode === "day") { setStartDate(value); setEndDate(value); return; }
    if (!rangeAnchor) { setStartDate(value); setEndDate(value); setRangeAnchor(value); return; }
    if (value < rangeAnchor) { setStartDate(value); setEndDate(rangeAnchor); } else { setStartDate(rangeAnchor); setEndDate(value); }
    setRangeAnchor(null);
  }
  function setRangeHandle(handle: "start" | "end", nextSlot: number) {
    if (handle === "start") setStartSlot(Math.max(0, Math.min(nextSlot, endSlot - 1)));
    else setEndSlot(Math.min(47, Math.max(nextSlot, startSlot + 1)));
  }
  function setRangeHandleFromPointer(handle: "start" | "end", clientX: number, element: HTMLButtonElement) {
    const bounds = element.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const slot = Math.round(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * 47);
    setRangeHandle(handle, slot);
  }
  function handleRangeKeys(handle: "start" | "end", event: KeyboardEvent<HTMLButtonElement>) {
    const current = handle === "start" ? startSlot : endSlot;
    const minimum = handle === "start" ? 0 : startSlot + 1;
    const maximum = handle === "start" ? endSlot - 1 : 47;
    const change = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
    if (change) { event.preventDefault(); setRangeHandle(handle, current + change); }
    if (event.key === "Home") { event.preventDefault(); setRangeHandle(handle, minimum); }
    if (event.key === "End") { event.preventDefault(); setRangeHandle(handle, maximum); }
  }

  return <form action={action} className="staff-timeoff-form">
    <input type="hidden" name="memberId" value={memberId} />
    {initial ? <input type="hidden" name="overrideId" value={initial.id} /> : null}
    <input type="hidden" name="localDate" value={startDate} />
    <input type="hidden" name="endLocalDate" value={dateMode === "range" ? endDate : startDate} />
    <input type="hidden" name="fullDay" value={fullDay ? "true" : "false"} />
    <section className="staff-timeoff-form__date-picker" aria-label="Time off dates">
      <div className="staff-timeoff-form__date-picker-heading">
        <div><span>Dates</span><strong>{selectedLabel}</strong></div>
        {!initial ? <div className="staff-timeoff-form__date-mode" aria-label="Date selection mode">
          <button type="button" data-active={dateMode === "day"} onClick={() => changeMode("day")}>One day</button>
          <button type="button" data-active={dateMode === "range"} onClick={() => changeMode("range")}>Date range</button>
        </div> : <span className="staff-timeoff-form__edit-label">Editing one date</span>}
      </div>
      <div className="staff-timeoff-form__calendar-navigation">
        <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => setVisibleMonth((month) => addMonths(month, -1))}><ChevronLeft aria-hidden="true" /></button>
        <p>{initial ? "Choose the date for this time-off entry." : dateMode === "range" ? "Choose a start date, then an end date (up to 31 days)." : "Choose the day to block."}</p>
        <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((month) => addMonths(month, 1))}><ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="staff-timeoff-form__months">
        {months.map((month) => <section className="staff-timeoff-form__month" key={month.toISOString()} aria-label={formatMonth(month)}>
          <h4>{formatMonth(month)}</h4>
          <div className="staff-timeoff-form__weekdays" aria-hidden="true">{weekdays.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}</div>
          <div className="staff-timeoff-form__day-grid">
            {monthDates(month).map((value, index) => {
              if (!value) return <span key={`empty-${index}`} aria-hidden="true" />;
              const disabled = value < today;
              const isStart = value === startDate;
              const isEnd = value === endDate;
              const inRange = dateMode === "range" && value > startDate && value < endDate;
              const selected = isStart || isEnd;
              return <button key={value} type="button" disabled={disabled} aria-label={`${selected ? "Selected" : "Choose"} ${formatDate(value)}`} className={[isStart ? "is-start" : "", isEnd ? "is-end" : "", inRange ? "is-in-range" : ""].filter(Boolean).join(" ")} onClick={() => selectDate(value)}>{Number(value.slice(-2))}</button>;
            })}
          </div>
        </section>)}
      </div>
      {dateMode === "range" && rangeAnchor ? <p className="staff-timeoff-form__date-picker-hint" role="status">Now choose the last day of the range.</p> : null}
    </section>
    <div className="staff-timeoff-form__mode"><button type="button" className="staff-timeoff-form__switch" role="switch" aria-checked={fullDay} onClick={() => setFullDay((current) => !current)}><span aria-hidden="true" /><span><b>Full day</b><small>{fullDay ? "Blocks the selected date or date range from booking." : "Turn on to block every selected date."}</small></span></button></div>
    {!fullDay ? <div className="staff-timeoff-form__range" aria-label="Partial-day lockout time range">
      <input type="hidden" name="startTime" value={timeAt(startSlot)} /><input type="hidden" name="endTime" value={timeAt(endSlot)} />
      <div className="staff-timeoff-form__range-values"><span><small>Starts</small><b>{timeLabel(timeAt(startSlot))}</b></span><span><small>Ends</small><b>{timeLabel(timeAt(endSlot))}</b></span></div>
      <div className="staff-timeoff-form__range-track" data-active-handle={activeRangeHandle} style={{ "--range-start": `${(startSlot / 47) * 100}%`, "--range-end": `${(endSlot / 47) * 100}%`, "--range-mid": `${((startSlot + endSlot) / 2 / 47) * 100}%` } as CSSProperties}>
        <span className="staff-timeoff-form__range-rail" aria-hidden="true" />
        <span className="staff-timeoff-form__range-selection" aria-hidden="true" />
        <output className="staff-timeoff-form__range-bubble" aria-live="polite">{timeLabel(timeAt(startSlot))} – {timeLabel(timeAt(endSlot))}</output>
        <button type="button" className="staff-timeoff-form__range-handle staff-timeoff-form__range-handle--start" style={{ "--handle-position": `${(startSlot / 47) * 100}%` } as CSSProperties} role="slider" aria-label="Lockout starts" aria-valuemin={0} aria-valuemax={endSlot - 1} aria-valuenow={startSlot} aria-valuetext={timeLabel(timeAt(startSlot))} onFocus={() => setActiveRangeHandle("start")} onKeyDown={(event) => handleRangeKeys("start", event)} onPointerDown={(event) => { setActiveRangeHandle("start"); event.currentTarget.setPointerCapture(event.pointerId); setRangeHandleFromPointer("start", event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setRangeHandleFromPointer("start", event.clientX, event.currentTarget); }} />
        <button type="button" className="staff-timeoff-form__range-handle staff-timeoff-form__range-handle--end" style={{ "--handle-position": `${(endSlot / 47) * 100}%` } as CSSProperties} role="slider" aria-label="Lockout ends" aria-valuemin={startSlot + 1} aria-valuemax={47} aria-valuenow={endSlot} aria-valuetext={timeLabel(timeAt(endSlot))} onFocus={() => setActiveRangeHandle("end")} onKeyDown={(event) => handleRangeKeys("end", event)} onPointerDown={(event) => { setActiveRangeHandle("end"); event.currentTarget.setPointerCapture(event.pointerId); setRangeHandleFromPointer("end", event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setRangeHandleFromPointer("end", event.clientX, event.currentTarget); }} />
      </div><div className="staff-timeoff-form__range-scale" aria-hidden="true"><span>00:00</span><span>12:00</span><span>23:30</span></div>
    </div> : null}
    <label>Reason <span className="staff-timeoff-form__optional">Optional</span><input name="reason" defaultValue={initial?.reason ?? ""} placeholder="Holiday, leave, break, meeting" /></label>
    <div className="staff-timeoff-form__actions">
      <button type="submit">{initial ? "Save changes" : "Save time off"}</button>
      {initial && deleteAction ? <button className="staff-timeoff-form__remove" type="submit" formAction={deleteAction} onClick={(event) => { if (!window.confirm("Remove this time-off entry? This cannot be undone.")) event.preventDefault(); }}><Trash2 aria-hidden="true" />Remove time off</button> : null}
    </div>
  </form>;
}
