"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

type CalendarScope = { location?: string; employee?: string; service?: string; staff?: string; after?: string; before?: string; showOffShift?: string };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month, 1))));
const parseDate = (value: string) => new Date(`${value}T12:00:00Z`);
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

/** Choose a calendar date without changing the active workspace or filters. */
export function CalendarDatePicker({ date, label, scope }: { date: string; label: string; scope: CalendarScope }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDate(date));
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = parseDate(date);
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const selectedLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(selected);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  const choose = (nextDate: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", nextDate); params.set("week", nextDate);
    params.delete("monthDay"); params.delete("booking"); params.delete("create");
    for (const [key, value] of Object.entries(scope)) if (value) params.set(key, value);
    setOpen(false);
    router.push(`${pathname}?${params.toString()}`);
  };
  const moveMonth = (offset: number) => setVisibleMonth(new Date(Date.UTC(year, month + offset, 1, 12)));

  return <span className="calendar-date-picker" ref={root}>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) setVisibleMonth(parseDate(date)); setOpen(!open); }}>{label}</button>
    {open ? <span className="calendar-date-picker__popover" role="dialog" aria-label="Choose calendar date">
      <span className="calendar-date-picker__heading"><strong>Select date</strong><span className="calendar-date-picker__selected" aria-label={`Selected date ${selectedLabel}`}>{selectedLabel}</span></span>
      <span className="calendar-date-picker__navigation">
        <button type="button" aria-label="Previous picker month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        <label><span className="calendar-date-picker__sr-only">Month</span><select aria-label="Month" value={month} onChange={(event) => setVisibleMonth(new Date(Date.UTC(year, Number(event.target.value), 1, 12)))}>{months.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>
        <label><span className="calendar-date-picker__sr-only">Year</span><select aria-label="Year" value={year} onChange={(event) => setVisibleMonth(new Date(Date.UTC(Number(event.target.value), month, 1, 12)))}>{Array.from({ length: 201 }, (_, index) => selected.getUTCFullYear() - 100 + index).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" aria-label="Next picker month" onClick={() => moveMonth(1)}><ChevronRight size={17} aria-hidden="true" /></button>
      </span>
      <span className="calendar-date-picker__weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</span>
      <span className="calendar-date-picker__grid">{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: dayCount }, (_, index) => { const value = keyOf(new Date(Date.UTC(year, month, index + 1, 12))); const text = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(value)); return <button type="button" key={value} aria-label={text} aria-pressed={value === date} className={value === date ? "is-selected" : ""} onClick={() => choose(value)}>{index + 1}</button>; })}</span>
    </span> : null}
  </span>;
}
