"use client";

import { useEffect, useMemo, useState } from "react";

type Slot = { startTime: string; endTime: string };
type Props = { timezone: string; days: string[]; slots: Slot[]; onSelectionChange?: (hasSelection: boolean) => void };

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function clockTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function localDateTimeValue(value: string, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T");
}

export function RescheduleSlotPicker({ timezone, days, slots, onSelectionChange }: Props) {
  const firstAvailableDate = days.find((day) => slots.some((slot) => localDateKey(new Date(slot.startTime), timezone) === day)) ?? days[0] ?? "";
  const [date, setDate] = useState(firstAvailableDate);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const dateSlots = useMemo(() => slots.filter((slot) => localDateKey(new Date(slot.startTime), timezone) === date), [date, slots, timezone]);

  useEffect(() => {
    setDate(firstAvailableDate);
    setSelectedSlot(null);
    onSelectionChange?.(false);
  }, [firstAvailableDate, onSelectionChange]);

  return <div className="appointment-reschedule-picker">
    <input type="hidden" name="startsAt" value={selectedSlot ? localDateTimeValue(selectedSlot.startTime, timezone) : ""} />
    <div className="appointment-reschedule-picker__days" aria-label="Choose a date">
      {days.map((day) => <button type="button" key={day} className={`appointment-reschedule-picker__day${day === date ? " is-selected" : ""}`} aria-pressed={day === date} onClick={() => { setDate(day); setSelectedSlot(null); onSelectionChange?.(false); }}><small>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: timezone }).format(new Date(`${day}T12:00:00Z`))}</small><strong>{day.slice(-2)}</strong></button>)}
    </div>
    <p className="appointment-reschedule-picker__label">Available times</p>
    <div className="appointment-reschedule-picker__slots">{dateSlots.map((slot) => <button type="button" key={slot.startTime} className={`appointment-reschedule-picker__slot${selectedSlot?.startTime === slot.startTime ? " is-selected" : ""}`} aria-pressed={selectedSlot?.startTime === slot.startTime} onClick={() => { setSelectedSlot(slot); onSelectionChange?.(true); }}>{clockTime(slot.startTime, timezone)}</button>)}</div>
    {!dateSlots.length ? <p className="appointment-reschedule-picker__empty">No times are available on this date.</p> : null}
  </div>;
}
