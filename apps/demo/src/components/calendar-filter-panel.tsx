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
      if (event.key !== "Escape" || event.defaultPrevented) return;
      document.querySelectorAll<HTMLDetailsElement>(".calendar-filter-panel[open]").forEach((panel) => {
        const hadFocus = panel.contains(document.activeElement);
        panel.open = false;
        if (hadFocus) panel.querySelector("summary")?.focus();
      });
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
