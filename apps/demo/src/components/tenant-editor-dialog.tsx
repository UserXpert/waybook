"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export function cycleDialogTab(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea')]
    .filter((control) => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length > 0);
  if (!controls.length) return;
  // WebKit can skip links in its native Tab order, including the only control in a details drawer.
  event.preventDefault();
  const current = controls.findIndex((control) => control === document.activeElement);
  if (current < 0) {
    const edge = event.shiftKey ? controls.at(-1) : controls[0];
    edge?.focus();
    return;
  }
  const direction = event.shiftKey ? -1 : 1;
  controls[(current + direction + controls.length) % controls.length]?.focus();
}

type DialogDismissal = { closeHref: string; onDismiss?: never } | { onDismiss: () => void; closeHref?: never };

export function TenantEditorDialog({ title, closeHref, onDismiss, initialField, centered = false, showScrim = true, cycleFocus = false, children }: DialogDismissal & {
  title: string;
  initialField?: "name" | "title" | "code" | "scopeType";
  centered?: boolean;
  showScrim?: boolean;
  cycleFocus?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    const focusSelector = initialField ? `form [name="${initialField}"]`
      : cycleFocus ? ".tenant-drawer-close" : 'form input:not([type="hidden"])';
    const initialControl = editor.querySelector<HTMLElement>(focusSelector);
    initialControl?.focus();
    return () => editor.close();
  }, [initialField, cycleFocus]);

  const scrimClass = centered ? "client-form-modal__scrim" : "tenant-drawer-scrim";
  function dismiss() {
    if (onDismiss) {
      dialog.current?.close();
      onDismiss();
    } else {
      // Keep the opener inert until navigation removes the route-backed editor.
      router.push(closeHref, { scroll: false });
    }
  }

  return (
    <dialog ref={dialog} className={`tenant-editor-dialog ${centered ? "client-form-modal-layer" : "tenant-drawer-layer"}`} aria-label={title} onKeyDown={cycleFocus ? cycleDialogTab : undefined} onCancel={(event) => {
      event.preventDefault();
      dismiss();
    }}>
      {showScrim && (closeHref !== undefined
        ? <Link className={scrimClass} href={closeHref} tabIndex={-1} aria-hidden="true" scroll={false} />
        : <button type="button" className={scrimClass} tabIndex={-1} aria-hidden="true" onClick={dismiss} />)}
      {children}
    </dialog>
  );
}

export function TenantEditorClose({ href, label, className = "tenant-drawer-close", children }: {
  href: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link className={className} aria-label={label} href={href} scroll={false}>
      {children}
    </Link>
  );
}
