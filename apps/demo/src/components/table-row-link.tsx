"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent } from "react";

function interactiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,select,textarea,label"));
}

/** Lets the entire data-table row open a record while preserving native
 * interactive controls that may appear inside a cell. */
export function TableRowLink({ href, label, className, children }: { href: string; label: string; className?: string; children: any }) {
  const router = useRouter();
  const open = () => router.push(href);
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => { if (!interactiveTarget(event.target)) open(); };
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (interactiveTarget(event.target)) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  };
  return <tr className={`waybook-clickable-row ${className ?? ""}`.trim()} role="link" tabIndex={0} aria-label={label} onClick={onClick} onKeyDown={onKeyDown}>{children}</tr>;
}
