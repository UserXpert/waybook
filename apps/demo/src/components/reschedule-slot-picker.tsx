"use client";

import { useEffect, useMemo, useState } from "react";
import { getRescheduleBookingAvailability } from "@/app/app/calendars/actions";

type Slot = { teamMemberId?: string; startTime: string; endTime: string };
type Props = { bookingId: string; timezone: string; days: string[]; slots: Slot[]; onSelectionChange?: (hasSelection: boolean) => void };

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

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

export function RescheduleSlotPicker({ bookingId, timezone, days: initialDays, slots: initialSlots, onSelectionChange }: Props) {
  const today = localDateKey(new Date(), timezone);
  const [days, setDays] = useState(initialDays);
  const [slots, setSlots] = useState(initialSlots);
  const [isLoading, setIsLoading] = useState(false);
  const firstAvailableDate = days.find((day) => slots.some((slot) => localDateKey(new Date(slot.startTime), timezone) === day)) ?? days[0] ?? "";
  const [date, setDate] = useState(firstAvailableDate);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const dateSlots = useMemo(() => slots.filter((slot) => localDateKey(new Date(slot.startTime), timezone) === date), [date, slots, timezone]);

  useEffect(() => {
    setDays(initialDays);
    setSlots(initialSlots);
  }, [initialDays, initialSlots]);

  useEffect(() => {
    setDate(firstAvailableDate);
    setSelectedSlot(null);
    onSelectionChange?.(false);
  }, [firstAvailableDate, onSelectionChange]);

  const moveWindow = async (direction: -1 | 1) => {
    const startDate = addDays(days[0] ?? today, direction * 7);
    if (startDate < today || isLoading) return;
    setIsLoading(true);
    setSelectedSlot(null);
    onSelectionChange?.(false);
    try {
      const result = await getRescheduleBookingAvailability({ bookingId, startDate });
      setDays(Array.from({ length: 7 }, (_, index) => addDays(startDate, index)));
      setSlots(result.slots);
      setDate(startDate);
    } finally {
      setIsLoading(false);
    }
  };

  return <div className="appointment-reschedule-picker">
    <input type="hidden" name="startsAt" value={selectedSlot ? localDateTimeValue(selectedSlot.startTime, timezone) : ""} />
    <input type="hidden" name="teamMemberId" value={selectedSlot?.teamMemberId ?? ""} />
    <div className="appointment-reschedule-picker__navigation" aria-label="Choose another week">
      <button type="button" aria-label="Previous week" onClick={() => void moveWindow(-1)} disabled={isLoading || !days[0] || addDays(days[0], -7) < today}>←</button>
      <span>{days[0] ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(`${days[0]}T12:00:00Z`)) : ""} – {days.at(-1) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(`${days.at(-1)}T12:00:00Z`)) : ""}</span>
      <button type="button" aria-label="Next week" onClick={() => void moveWindow(1)} disabled={isLoading}>→</button>
    </div>
    <div className="appointment-reschedule-picker__days" aria-label="Choose a date">
      {days.map((day) => <button type="button" key={day} className={`appointment-reschedule-picker__day${day === date ? " is-selected" : ""}`} aria-pressed={day === date} onClick={() => { setDate(day); setSelectedSlot(null); onSelectionChange?.(false); }}><small>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: timezone }).format(new Date(`${day}T12:00:00Z`))}</small><strong>{day.slice(-2)}</strong></button>)}
    </div>
    <p className="appointment-reschedule-picker__label">Available times</p>
    <div className="appointment-reschedule-picker__slots">{isLoading ? <span className="appointment-reschedule-picker__empty">Checking availability…</span> : dateSlots.map((slot) => <button type="button" key={slot.startTime} className={`appointment-reschedule-picker__slot${selectedSlot?.startTime === slot.startTime ? " is-selected" : ""}`} aria-pressed={selectedSlot?.startTime === slot.startTime} onClick={() => { setSelectedSlot(slot); onSelectionChange?.(true); }}>{clockTime(slot.startTime, timezone)}</button>)}</div>
    {!dateSlots.length ? <p className="appointment-reschedule-picker__empty">No times are available on this date.</p> : null}
  </div>;
}
