"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type CalendarScope = {
  location?: string;
  employee?: string;
  service?: string;
  staff?: string;
  after?: string;
  before?: string;
  showOffShift?: string;
};

/** A compact date control that preserves the current calendar scope and filters. */
export function CalendarDatePicker({ date, label, scope }: { date: string; label: string; scope: CalendarScope }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const choose = (nextDate: string) => {
    if (!nextDate) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", nextDate);
    params.set("week", nextDate);
    params.delete("monthDay");
    params.delete("booking");
    params.delete("create");
    for (const [key, value] of Object.entries(scope)) {
      if (value) params.set(key, value);
    }
    setOpen(false);
    router.push(`${pathname}?${params.toString()}`);
  };

  return <span className="calendar-date-picker">
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
    {open ? <span className="calendar-date-picker__popover" role="dialog" aria-label="Choose calendar date"><label>Calendar date<input type="date" value={date} onChange={(event) => choose(event.target.value)} /></label><button type="button" onClick={() => setOpen(false)}>Close</button></span> : null}
  </span>;
}
