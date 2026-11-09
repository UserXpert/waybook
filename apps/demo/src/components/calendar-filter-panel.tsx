"use client";

import { useEffect } from "react";

export function CalendarFilterDismiss() {
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(".calendar-filter-panel[open]").forEach((panel) => {
        if (!panel.contains(event.target as Node)) panel.open = false;
      });
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".calendar-filter-panel[open]").forEach((panel) => { panel.open = false; });
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  return null;
}
