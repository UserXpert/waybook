"use client";

import { useEffect } from "react";

export function CalendarNavigationLabel({ label }: { label: string }) {
  useEffect(() => {
    const controls = document.querySelectorAll<HTMLAnchorElement>(".waybook-calendar-toolbar__actions a");
    for (const control of controls) {
      if (control.textContent?.trim() === "Today" || control.getAttribute("aria-label")?.startsWith("Go to ")) {
        control.textContent = label;
        control.setAttribute("aria-label", `Go to ${label}`);
      }
    }
  }, [label]);

  return null;
}
