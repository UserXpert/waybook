"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";

type Props = { startTime: string; endTime: string; onStartTimeChange: (value: string) => void; onEndTimeChange: (value: string) => void; startName?: string; endName?: string; label?: string; compact?: boolean };
const lastSlot = 47;
const toSlot = (value: string) => Number(value.slice(0, 2)) * 2 + (value.endsWith("30") ? 1 : 0);
const toTime = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
const timeLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(`1970-01-01T${value}:00Z`));

/** A keyboard and pointer accessible 30-minute range selector for operational hours. */
export function OperationalTimeRange({ startTime, endTime, onStartTimeChange, onEndTimeChange, startName, endName, label = "Time range", compact = false }: Props) {
  const [activeHandle, setActiveHandle] = useState<"start" | "end">("start");
  const startSlot = toSlot(startTime);
  const endSlot = toSlot(endTime);
  const setHandle = (handle: "start" | "end", next: number) => {
    if (handle === "start") onStartTimeChange(toTime(Math.max(0, Math.min(next, endSlot - 1))));
    else onEndTimeChange(toTime(Math.min(lastSlot, Math.max(next, startSlot + 1))));
  };
  const fromPointer = (handle: "start" | "end", clientX: number, element: HTMLButtonElement) => {
    const bounds = element.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    setHandle(handle, Math.round(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * lastSlot));
  };
  const onKeys = (handle: "start" | "end", event: KeyboardEvent<HTMLButtonElement>) => {
    const current = handle === "start" ? startSlot : endSlot;
    const minimum = handle === "start" ? 0 : startSlot + 1;
    const maximum = handle === "start" ? endSlot - 1 : lastSlot;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
    if (delta) { event.preventDefault(); setHandle(handle, current + delta); }
    if (event.key === "Home") { event.preventDefault(); setHandle(handle, minimum); }
    if (event.key === "End") { event.preventDefault(); setHandle(handle, maximum); }
  };
  return <div className={compact ? "operational-time-range operational-time-range--compact" : "operational-time-range"} aria-label={label}>
    {startName ? <input type="hidden" name={startName} value={startTime} /> : null}{endName ? <input type="hidden" name={endName} value={endTime} /> : null}
    {!compact ? <div className="operational-time-range__values"><span><small>Starts</small><b>{timeLabel(startTime)}</b></span><span><small>Ends</small><b>{timeLabel(endTime)}</b></span></div> : null}
    <div className="operational-time-range__track" data-active-handle={activeHandle} style={{ "--range-start": `${(startSlot / lastSlot) * 100}%`, "--range-end": `${(endSlot / lastSlot) * 100}%`, "--range-mid": `${((startSlot + endSlot) / 2 / lastSlot) * 100}%` } as CSSProperties}>
      <span className="operational-time-range__rail" aria-hidden="true" /><span className="operational-time-range__selection" aria-hidden="true" /><output className="operational-time-range__bubble" aria-live="polite">{timeLabel(startTime)} – {timeLabel(endTime)}</output>
      {(["start", "end"] as const).map((handle) => { const slot = handle === "start" ? startSlot : endSlot; return <button key={handle} type="button" className={`operational-time-range__handle operational-time-range__handle--${handle}`} style={{ "--handle-position": `${(slot / lastSlot) * 100}%` } as CSSProperties} role="slider" aria-label={`${label} ${handle === "start" ? "starts" : "ends"}`} aria-valuemin={handle === "start" ? 0 : startSlot + 1} aria-valuemax={handle === "start" ? endSlot - 1 : lastSlot} aria-valuenow={slot} aria-valuetext={timeLabel(toTime(slot))} onFocus={() => setActiveHandle(handle)} onKeyDown={(event) => onKeys(handle, event)} onPointerDown={(event) => { setActiveHandle(handle); event.currentTarget.setPointerCapture(event.pointerId); fromPointer(handle, event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(handle, event.clientX, event.currentTarget); }} />; })}
    </div><div className="operational-time-range__scale" aria-hidden="true"><span>00:00</span><span>12:00</span><span>23:30</span></div>
  </div>;
}
