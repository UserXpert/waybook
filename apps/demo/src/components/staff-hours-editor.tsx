"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { saveStaffWorkingHours } from "@/app/app/team/actions";
import { OperationalTimeRange } from "@/components/operational-time-range";

const days = [
  { id: "SU", label: "Sunday", short: "Sun" },
  { id: "MO", label: "Monday", short: "Mon" },
  { id: "TU", label: "Tuesday", short: "Tue" },
  { id: "WE", label: "Wednesday", short: "Wed" },
  { id: "TH", label: "Thursday", short: "Thu" },
  { id: "FR", label: "Friday", short: "Fri" },
  { id: "SA", label: "Saturday", short: "Sat" },
] as const;

type DayId = (typeof days)[number]["id"];
type Shift = { id: string; startTime: string; endTime: string };
type Schedule = Record<DayId, Shift[]>;
const dayOrder = days.map((day) => day.id);

function shiftId() { return Math.random().toString(36).slice(2, 10); }
function readableTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return displayHour + ":" + String(minute).padStart(2, "0") + " " + suffix;
}
function hasOverlappingShifts(shifts: Shift[]) {
  const ordered = [...shifts].sort((left, right) => left.startTime.localeCompare(right.startTime));
  return ordered.some((shift, index) => index > 0 && shift.startTime < ordered[index - 1].endTime);
}
function timeAfter(value: string, minutes: number) {
  const [hour, minute] = value.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  if (total >= 24 * 60) return null;
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}
function weekDays() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return days.map((day, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { ...day, date, dateLabel: String(date.getDate()) + "/" + String(date.getMonth() + 1) };
  });
}

export function StaffHoursEditor({ memberId, initialSchedule }: { memberId: string; initialSchedule: Array<{ day: string; startTime: string; endTime: string }> }) {
  const initial = useMemo(() => {
    const empty: Schedule = { SU: [], MO: [], TU: [], WE: [], TH: [], FR: [], SA: [] };
    initialSchedule.forEach((entry, index) => {
      if (dayOrder.includes(entry.day as DayId)) empty[entry.day as DayId].push({ id: entry.day + "-" + index, startTime: entry.startTime, endTime: entry.endTime });
    });
    return empty;
  }, [initialSchedule]);
  const [schedule, setSchedule] = useState<Schedule>(initial);
  const [editingDay, setEditingDay] = useState<DayId | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<Shift[] | null>(null);
  const calendarDays = useMemo(weekDays, []);
  const payload = dayOrder.flatMap((day) => schedule[day].map(({ startTime, endTime }) => ({ day, startTime, endTime })));
  const editing = editingDay ? schedule[editingDay] : [];
  const editingLabel = days.find((day) => day.id === editingDay)?.label ?? "";
  const overlappingDays = dayOrder.filter((day) => hasOverlappingShifts(schedule[day]));

  function openEditor(day: DayId) {
    setEditingSnapshot(schedule[day].map((shift) => ({ ...shift })));
    setEditingDay(day);
  }
  function closeEditor(discard: boolean) {
    if (discard && editingDay && editingSnapshot) {
      setSchedule((current) => ({ ...current, [editingDay]: editingSnapshot }));
    }
    setEditingSnapshot(null);
    setEditingDay(null);
  }

  function updateShift(index: number, key: "startTime" | "endTime", value: string) {
    if (!editingDay) return;
    setSchedule((current) => ({ ...current, [editingDay]: current[editingDay].map((shift, shiftIndex) => shiftIndex === index ? { ...shift, [key]: value } : shift) }));
  }
  function addShift() {
    if (!editingDay) return;
    setSchedule((current) => {
      const shifts = current[editingDay];
      const latestEnd = shifts.reduce((latest, shift) => shift.endTime > latest ? shift.endTime : latest, "09:00");
      const endTime = timeAfter(latestEnd, 60);
      if (!endTime) return current;
      return { ...current, [editingDay]: [...shifts, { id: shiftId(), startTime: latestEnd, endTime }] };
    });
  }
  function removeShift(index: number) {
    if (!editingDay) return;
    setSchedule((current) => ({ ...current, [editingDay]: current[editingDay].filter((_, shiftIndex) => shiftIndex !== index) }));
  }

  return <form action={saveStaffWorkingHours} className="staff-shift-schedule" onSubmit={(event) => {
    if (overlappingDays.length) event.preventDefault();
  }}>
    <input type="hidden" name="memberId" value={memberId} />
    <input type="hidden" name="schedule" value={JSON.stringify(payload)} />
    <div className="staff-shift-schedule__heading"><div><h4>Recurring weekly shifts</h4><p>Edit a day to set the hours that repeat each week. Time-off exceptions remain separate.</p></div><span>{payload.length} shift{payload.length === 1 ? "" : "s"} each week</span></div>
    <ol className="staff-shift-schedule__list">{calendarDays.map((day) => {
      const shifts = schedule[day.id];
      return <li key={day.id}><button type="button" className="staff-shift-schedule__row" onClick={() => openEditor(day.id)} aria-label={"Edit " + day.label + " shifts"}><span className="staff-shift-schedule__day"><strong>{day.short}</strong><span>{day.dateLabel}</span></span><span className={shifts.length ? "staff-shift-schedule__summary has-shifts" : "staff-shift-schedule__summary"}>{shifts.length ? shifts.map((shift) => <span key={shift.id}>{readableTime(shift.startTime)} – {readableTime(shift.endTime)}</span>) : <em>No shifts</em>}</span><Pencil className="staff-shift-schedule__pencil" aria-hidden="true" /></button></li>;
    })}</ol>
    {editingDay ? <div className="staff-shift-modal-layer" role="presentation"><button type="button" className="staff-shift-modal-layer__scrim" aria-label="Close shift editor" onClick={() => closeEditor(true)} /><section className="staff-shift-modal" role="dialog" aria-modal="true" aria-label={"Edit shifts for " + editingLabel + "s"}><button type="button" className="staff-shift-modal__close" aria-label="Close shift editor" onClick={() => closeEditor(true)}>×</button><header><p>RECURRING WORK HOURS</p><h3>Edit shifts for {editingLabel}s</h3><span>These changes apply to all future {editingLabel}s. Existing time-off exceptions are unchanged.</span></header><div className="staff-shift-modal__body">{overlappingDays.length ? <p className="staff-shift-modal__error" role="alert">Shifts cannot overlap. Adjust or remove one interval before saving.</p> : null}{editing.map((shift, index) => <div className="staff-shift-modal__row" key={shift.id}><OperationalTimeRange compact label={editingLabel + " shift " + (index + 1)} startTime={shift.startTime} endTime={shift.endTime} onStartTimeChange={(value) => updateShift(index, "startTime", value)} onEndTimeChange={(value) => updateShift(index, "endTime", value)} /><button type="button" className="staff-shift-modal__remove" aria-label="Remove shift" onClick={() => removeShift(index)}>Remove</button></div>)}<button type="button" className="staff-shift-modal__add" onClick={addShift}>+ Add a shift</button></div><footer><button type="button" className="staff-shift-modal__cancel" onClick={() => closeEditor(true)}>Cancel</button><button type="submit" disabled={overlappingDays.length > 0}>Save changes</button></footer></section></div> : null}
  </form>;
}
