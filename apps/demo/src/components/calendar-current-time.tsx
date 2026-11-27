"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

export function CalendarCurrentTime({ now, timezone, dates, start, end, team }: {
  now: number;
  timezone: string;
  dates: readonly string[];
  start: number;
  end: number;
  team?: boolean;
}) {
  const [instant, setInstant] = useState(now);
  useEffect(() => {
    const update = () => setInstant(Date.now());
    update();
    const timer = window.setInterval(update, 15_000);
    return () => window.clearInterval(timer);
  }, [now]);

  const [date, time] = formatInTimeZone(instant, timezone, "yyyy-MM-dd HH:mm").split(" ");
  const index = dates.indexOf(date);
  const [hour, minute] = time.split(":").map(Number);
  const minutes = hour * 60 + minute;
  if (index < 0 || minutes < start || minutes >= end) return null;
  return <div className="calendar-current-time" role="img" aria-label={`Current time ${time}`}
    style={{ gridColumn: "2 / -1", gridRow: team ? "2 / -1" : index + 2 }}>
    <span style={{ insetInlineStart: `${(minutes - start) / (end - start) * 100}%` }}>
      <b>{time}</b>
    </span>
  </div>;
}
