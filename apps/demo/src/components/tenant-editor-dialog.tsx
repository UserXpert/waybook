"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function TenantEditorDialog({ title, closeHref, initialField, centered = false, showScrim = true, cycleFocus = false, children }: {
  title: string;
  closeHref: string;
  initialField?: "name" | "title" | "code" | "scopeType";
  centered?: boolean;
  showScrim?: boolean;
  cycleFocus?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    const focusSelector = initialField ? `form [name="${initialField}"]`
      : cycleFocus ? ".tenant-drawer-close" : 'form input:not([type="hidden"])';
    const initialControl = editor.querySelector<HTMLElement>(focusSelector);
    initialControl?.focus();
    return () => editor.close();
  }, [initialField, cycleFocus]);

  function navigateControls(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (!cycleFocus || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
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

  return (
    <dialog ref={dialog} className={`tenant-editor-dialog ${centered ? "client-form-modal-layer" : "tenant-drawer-layer"}`} aria-label={title} onKeyDown={navigateControls} onCancel={(event) => {
      event.preventDefault();
      dialog.current?.close();
      router.push(closeHref, { scroll: false });
    }}>
      {showScrim ? <Link className={centered ? "client-form-modal__scrim" : "tenant-drawer-scrim"} href={closeHref} tabIndex={-1} aria-hidden="true" scroll={false} onNavigate={() => dialog.current?.close()} /> : null}
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
  const link = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={link} className={className} aria-label={label} href={href} scroll={false} onNavigate={() => link.current?.closest("dialog")?.close()}>
      {children}
    </Link>
  );
}
