"use client";

import { useEffect } from "react";

/** Legacy drawer boolean fields share the tenant-drawer-check wrapper. Keep
 * their native checkbox submission behaviour while exposing the correct
 * switch role to assistive technology. Multi-select checkbox lists are not
 * inside this wrapper and remain ordinary checkboxes. */
export function DrawerToggleSemantics() {
  useEffect(() => {
    const apply = () => document.querySelectorAll<HTMLInputElement>(".tenant-drawer-check > input[type='checkbox']").forEach((input) => input.setAttribute("role", "switch"));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
