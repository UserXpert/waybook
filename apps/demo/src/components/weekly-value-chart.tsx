"use client";

import { useMemo, useState } from "react";
import type { WeeklyValueDay } from "@/lib/waybook/today-command-centre";

type ChartDay = WeeklyValueDay & { weekday: string; dayOfMonth: string; isToday: boolean; calendarHref: string };

function money(cents: number) {
  return new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);
}

export function WeeklyValueChart({ days, totals, comparison }: { days: ChartDay[]; totals: { scheduledCents: number; completedCents: number; lostCents: number }; comparison: { scheduled: string; completed: string; lost: string } }) {
  const initial = Math.max(0, days.findIndex((day) => day.isToday));
  const [selectedIndex, setSelectedIndex] = useState(initial);
  const selected = days[selectedIndex] ?? days[0];
  const maximum = useMemo(() => Math.max(1, ...days.map((day) => day.scheduledCents + day.completedCents + day.lostCents)), [days]);
  if (!selected) return null;
  return <section className="weekly-value waybook-data-card" aria-labelledby="weekly-value-title">
    <div className="waybook-section-heading weekly-value__heading"><div><p>WEEKLY SERVICE VALUE</p><h2 id="weekly-value-title">Booked value by appointment outcome</h2><span>Service value at booking; not paid revenue.</span></div><a href={selected.calendarHref}>Open week in Calendar →</a></div>
    <div className="weekly-value__totals"><article><span>Scheduled</span><strong>{money(totals.scheduledCents)}</strong><small>Confirmed and arrived · {comparison.scheduled}</small></article><article><span>Completed</span><strong>{money(totals.completedCents)}</strong><small>Delivered service value · {comparison.completed}</small></article><article><span>Lost</span><strong>{money(totals.lostCents)}</strong><small>Cancelled and no-show · {comparison.lost}</small></article></div>
    <div className="weekly-value__plot" aria-label="Weekly service value chart"><ol>{days.map((day, index) => {
      const total = day.scheduledCents + day.completedCents + day.lostCents;
      const description = `${day.weekday} ${day.dayOfMonth}: ${money(day.scheduledCents)} scheduled, ${money(day.completedCents)} completed, ${money(day.lostCents)} lost`;
      return <li key={day.localDate}><button type="button" aria-pressed={index === selectedIndex} aria-label={description} onClick={() => setSelectedIndex(index)} onMouseEnter={() => setSelectedIndex(index)} onFocus={() => setSelectedIndex(index)}><span className="weekly-value__bar" style={{ height: `${Math.max(total ? 12 : 2, (total / maximum) * 100)}%` }}><i className="is-completed" style={{ height: `${total ? (day.completedCents / total) * 100 : 0}%` }} /><i className="is-scheduled" style={{ height: `${total ? (day.scheduledCents / total) * 100 : 0}%` }} /><i className="is-lost" style={{ height: `${total ? (day.lostCents / total) * 100 : 0}%` }} /></span><strong>{day.weekday}</strong><small>{day.dayOfMonth}</small></button></li>;
    })}</ol></div>
    <div className="weekly-value__detail" aria-live="polite"><strong>{selected.weekday} {selected.dayOfMonth}</strong><dl><div><dt>Confirmed</dt><dd>{money(selected.confirmedCents)}</dd></div><div><dt>Arrived</dt><dd>{money(selected.arrivedCents)}</dd></div><div><dt>Completed</dt><dd>{money(selected.completedCents)}</dd></div><div><dt>Cancelled / no-show</dt><dd>{money(selected.lostCents)}</dd></div></dl></div>
    <div className="weekly-value__legend"><span><i className="is-scheduled" />Scheduled</span><span><i className="is-completed" />Completed</span><span><i className="is-lost" />Lost</span></div>
  </section>;
}
