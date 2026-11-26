"use client";

import { useEffect } from "react";

const primarySubmit = /^(save|create|issue|set)\b/i;

/**
 * Tenant drawers are rendered by both server and client components. Promote
 * their primary persistence action into the common header without changing its
 * native form ownership, validation, or server-action submission behaviour.
 */
export function DrawerHeaderSubmitActions() {
  useEffect(() => {
    let nextId = 0;
    const promote = () => document.querySelectorAll<HTMLElement>(".tenant-drawer:not([data-drawer-inline-actions])").forEach((drawer) => {
      const header = drawer.querySelector<HTMLElement>(":scope > header");
      if (!header) return;
      const forms = drawer.querySelectorAll<HTMLFormElement>("form.tenant-drawer-form:not([data-drawer-submit-in-header])");
      forms.forEach((form) => {
        const submit = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((button) => primarySubmit.test(button.textContent?.trim() ?? ""));
        if (!submit || submit.dataset.drawerHeaderSubmit === "true") return;
        const id = form.id || `drawer-form-${nextId++}`;
        form.id = id;
        if (header.querySelector<HTMLButtonElement>(`button[data-drawer-header-submit][form="${id}"]`)) return;
        const close = header.querySelector<HTMLElement>(":scope > .tenant-drawer-close");
        const actions = header.querySelector<HTMLElement>(".tenant-drawer-header-actions, .appointment-drawer__header-actions") ?? (() => {
          const element = document.createElement("div");
          element.className = "tenant-drawer-header-actions";
          header.insertBefore(element, close);
          return element;
        })();
        actions.classList.add("tenant-drawer-header-actions");
        if (close && actions.nextElementSibling !== close) header.insertBefore(actions, close);
        submit.dataset.drawerHeaderSubmit = "true";
        submit.setAttribute("form", id);
        actions.prepend(submit);
      });
    });
    promote();
    const observer = new MutationObserver(promote);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
