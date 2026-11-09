"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { OperationalTimeRange } from "@/components/operational-time-range";

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
    {!fullDay ? <OperationalTimeRange label="Partial-day lockout" startName="startTime" endName="endTime" startTime={timeAt(startSlot)} endTime={timeAt(endSlot)} onStartTimeChange={(value) => setStartSlot(Number(value.slice(0, 2)) * 2 + (value.endsWith("30") ? 1 : 0))} onEndTimeChange={(value) => setEndSlot(Number(value.slice(0, 2)) * 2 + (value.endsWith("30") ? 1 : 0))} /> : null}
    <label>Reason <span className="staff-timeoff-form__optional">Optional</span><input name="reason" defaultValue={initial?.reason ?? ""} placeholder="Holiday, leave, break, meeting" /></label>
    <div className="staff-timeoff-form__actions">
      <button type="submit">{initial ? "Save changes" : "Save time off"}</button>
      {initial && deleteAction ? <button className="staff-timeoff-form__remove" type="submit" formAction={deleteAction} onClick={(event) => { if (!window.confirm("Remove this time-off entry? This cannot be undone.")) event.preventDefault(); }}><Trash2 aria-hidden="true" />Remove time off</button> : null}
    </div>
  </form>;
}
