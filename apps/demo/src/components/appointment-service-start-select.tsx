"use client";

import { useEffect, useId, useState } from "react";
import { getLinkedServiceStartOptions } from "@/app/app/calendars/actions";

type Props = {
  label: string;
  locationId: string;
  date: string;
  serviceId?: string;
  providerId?: string;
  earliest?: string;
  sequentialTime: string;
  value: string;
  bookingId?: string;
  segmentId?: string;
  onChange: (time: string) => void;
};

type Options = Awaited<ReturnType<typeof getLinkedServiceStartOptions>>;

export function AppointmentServiceStartSelect({
  label, locationId, date, serviceId, providerId, earliest, sequentialTime, value, bookingId, segmentId, onChange,
}: Props) {
  const selectId = useId();
  const key = JSON.stringify([locationId, date, serviceId, providerId, earliest, bookingId, segmentId]);
  const [loaded, setLoaded] = useState<{ key: string; options: Options | null }>();
  const canLoad = Boolean(serviceId && providerId && earliest);
  const result = loaded?.key === key ? loaded.options : undefined;

  useEffect(() => {
    if (!serviceId || !providerId || !earliest) return;
    let cancelled = false;
    void getLinkedServiceStartOptions({ locationId, date, serviceId, teamMemberId: providerId, earliest, bookingId, segmentId })
      .then((options) => { if (!cancelled) setLoaded({ key, options }); })
      .catch(() => { if (!cancelled) setLoaded({ key, options: null }); });
    return () => { cancelled = true; };
  }, [key, locationId, date, serviceId, providerId, earliest, bookingId, segmentId]);

  const times = result?.times ?? [];
  const currentIsListed = !value || value === sequentialTime || times.includes(value);
  return <div className="appointment-service-start">
    <label htmlFor={selectId}>{label}</label>
    <select id={selectId} value={value} disabled={!canLoad || !result} onChange={(event) => onChange(event.target.value)}>
      <option value={value === sequentialTime ? value : ""} disabled={Boolean(result && !result.sequentialAvailable)}>
        {sequentialTime ? `${sequentialTime}${result && !result.sequentialAvailable ? " (unavailable)" : ""}` : "Choose the preceding service time"}
      </option>
      {!currentIsListed ? <option value={value} disabled>{value}</option> : null}
      {times.filter((time) => time !== sequentialTime).map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
    {canLoad && result === undefined ? <small role="status">Checking available times…</small> : null}
    {canLoad && result === null ? <small role="status">Could not load available times. Close and reopen these options to retry.</small> : null}
  </div>;
}
