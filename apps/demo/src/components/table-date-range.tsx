"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarMonthPicker, parsePickerDate } from "./calendar-month-picker";

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const format = (key: string) => shortDate.format(parsePickerDate(key));
const shiftDays = (key: string, days: number) => {
  const date = parsePickerDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function TableDateRange({ label, today, initialFrom = "", initialTo = "" }: {
  label: string;
  today: string;
  initialFrom?: string;
  initialTo?: string;
}) {
  const id = useId();
  const picker = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [visibleMonth, setVisibleMonth] = useState(() => parsePickerDate(initialFrom || initialTo || today));
  const { from, to } = range;
  const summary = from && to ? from === to ? format(from) : `${format(from)} – ${format(to)}`
    : from ? `From ${format(from)}` : to ? `Through ${format(to)}` : "All dates";

  useEffect(() => {
    if (open) picker.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function selectDay(day: string) {
    if (!from || to) setRange({ from: day, to: "" });
    else setRange(from <= day ? { from, to: day } : { from: day, to: from });
  }

  const presets = [
    { name: "All dates", from: "", to: "" },
    { name: "Today", from: today, to: today },
    { name: "Last 7 days", from: shiftDays(today, -6), to: today },
    { name: "Last 30 days", from: shiftDays(today, -29), to: today },
  ];

  return <fieldset className="workspace-date-range">
    <legend id={id + "-label"}>{label}</legend>
    <button type="button" className="workspace-date-range__toggle" aria-expanded={open} aria-controls={id + "-dates"}
      aria-labelledby={id + "-label " + id + "-summary"} onClick={() => setOpen(!open)}>
      <CalendarDays size={17} aria-hidden="true" /><span id={id + "-summary"}>{summary}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    <input type="hidden" name="from" value={from} />
    <input type="hidden" name="to" value={to} />
    {open ? <div id={id + "-dates"} ref={picker} className="workspace-date-range__picker">
      <div className="workspace-date-range__presets" aria-label="Date presets" role="group">
        {presets.map((preset) => <button type="button" className="waybook-action waybook-action--secondary" key={preset.name}
          aria-pressed={from === preset.from && to === preset.to} onClick={() => {
            setRange({ from: preset.from, to: preset.to });
            setVisibleMonth(parsePickerDate(preset.to || today));
          }}>{preset.name}</button>)}
      </div>
      <p>{from && !to ? "Choose an end date" : "Choose a start date"}</p>
      <CalendarMonthPicker visibleMonth={visibleMonth} referenceYear={parsePickerDate(today).getUTCFullYear()}
        from={from} to={to} onMonthChange={setVisibleMonth} onSelect={selectDay} />
      <details>
        <summary>Enter dates</summary>
        <div className="workspace-date-range__manual">
          <label>From<input type="date" aria-label={label + " from"} value={from} min="1000-01-01" max="9999-12-31"
            onChange={(event) => {
              const next = event.target.value;
              if (next && !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(next)) return;
              setRange({ from: next, to: to && next > to ? "" : to });
              if (next) setVisibleMonth(parsePickerDate(next));
            }} /></label>
          <label>To<input type="date" aria-label={label + " to"} value={to} min="1000-01-01" max="9999-12-31"
            onChange={(event) => {
              const next = event.target.value;
              if (next && !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(next)) return;
              setRange({ from: next && next < from ? "" : from, to: next });
              if (next) setVisibleMonth(parsePickerDate(next));
            }} /></label>
        </div>
      </details>
    </div> : null}
  </fieldset>;
}
