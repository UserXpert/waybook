"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CalendarMonthPicker, parsePickerDate } from "./calendar-month-picker";

type CalendarScope = { location?: string; employee?: string; service?: string; staff?: string; after?: string; before?: string; showOffShift?: string };

/** Choose a calendar date without changing the active workspace or filters. */
export function CalendarDatePicker({ date, label, scope }: { date: string; label: string; scope: CalendarScope }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parsePickerDate(date));
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = parsePickerDate(date);
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
  return <span className="calendar-date-picker" ref={root}>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) setVisibleMonth(parsePickerDate(date)); setOpen(!open); }}>{label}</button>
    {open ? <span className="calendar-date-picker__popover" role="dialog" aria-label="Choose calendar date">
      <span className="calendar-date-picker__heading"><strong>Select date</strong><span className="calendar-date-picker__selected" aria-label={`Selected date ${selectedLabel}`}>{selectedLabel}</span></span>
      <CalendarMonthPicker visibleMonth={visibleMonth} referenceYear={selected.getUTCFullYear()}
        from={date} to={date} onMonthChange={setVisibleMonth} onSelect={choose} />
    </span> : null}
  </span>;
}
