"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Team-only availability preference. Staff scope belongs to the main staff
 * picker, so this intentionally does not duplicate it with a roster search. */
export function CalendarRosterControls({ includeOffShift }: { includeOffShift: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggleOffShift = (enabled: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("showOffShift", enabled ? "1" : "0");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="calendar-roster-controls">
      <span className="calendar-roster-controls__label">Availability</span>
      <label className="calendar-off-shift-toggle">
        <input type="checkbox" role="switch" checked={includeOffShift} onChange={(event) => toggleOffShift(event.target.checked)} />
        <span aria-hidden="true" />
        <span className="calendar-off-shift-toggle__text">Include off-shift staff</span>
      </label>
    </div>
  );
}
