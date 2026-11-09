"use client";

import { useMemo, useState } from "react";
import { OperationalTimeRange } from "@/components/operational-time-range";

type Hour = { dayOfWeek: number; startTime: string; endTime: string };
const days = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]] as const;
const timeAfter = (time: string) => {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + 60;
  return minutes <= 23 * 60 + 30 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` : null;
};

export function LocationHoursEditor({ initialHours }: { initialHours: Hour[] }) {
  const initial = useMemo(() => initialHours.length ? initialHours : days.filter(([day]) => day >= 1 && day <= 5).map(([day]) => ({ dayOfWeek: day, startTime: "09:00", endTime: "17:00" })), [initialHours]);
  const [hours, setHours] = useState(initial);
  const set = (index: number, key: "startTime" | "endTime", value: string) => setHours((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const addRange = (dayOfWeek: number, current: Hour[]) => {
    const startTime = current.at(-1)?.endTime ?? "09:00";
    const endTime = timeAfter(startTime);
    if (endTime) setHours((items) => [...items, { dayOfWeek, startTime, endTime }]);
  };
  return <fieldset className="location-hours-editor"><legend>Opening hours</legend><input type="hidden" name="openingHours" value={JSON.stringify(hours.map(({ dayOfWeek, startTime, endTime }) => ({ day: dayOfWeek, start: startTime, end: endTime })))} />{days.map(([day, label]) => {
    const ranges = hours.map((hour, index) => ({ hour, index })).filter(({ hour }) => hour.dayOfWeek === day);
    const first = ranges[0]?.hour;
    const last = ranges.at(-1)?.hour;
    const removeRange = (index: number) => setHours((items) => items.filter((_, itemIndex) => itemIndex !== index));
    return <section key={day} className="location-hours-editor__day"><header><strong>{label}</strong>{first && last ? <span className="location-hours-editor__summary"><small>Starts</small><b>{first.startTime}</b><small>Ends</small><b>{last.endTime}</b></span> : <small>Closed</small>}{ranges.length === 1 ? <button type="button" className="location-hours-editor__remove" aria-label={`Remove ${label} range 1`} title="Remove range" onClick={() => removeRange(ranges[0].index)}>×</button> : null}</header>{ranges.map(({ hour, index }, rangeIndex) => <div className="location-hours-editor__range" key={`${day}-${index}`}><OperationalTimeRange compact label={`${label} opening hours`} startTime={hour.startTime} endTime={hour.endTime} onStartTimeChange={(value) => set(index, "startTime", value)} onEndTimeChange={(value) => set(index, "endTime", value)} />{ranges.length > 1 ? <button type="button" className="location-hours-editor__remove" aria-label={`Remove ${label} range ${rangeIndex + 1}`} title="Remove range" onClick={() => removeRange(index)}>×</button> : null}</div>)}<button type="button" className="location-hours-editor__add" onClick={() => addRange(day, ranges.map(({ hour }) => hour))} disabled={Boolean(ranges.length && !timeAfter(ranges.at(-1)!.hour.endTime))}>+ Add range</button></section>;
  })}</fieldset>;
}
