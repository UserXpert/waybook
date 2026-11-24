"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function TenantEditorDialog({ title, closeHref, initialField, centered = false, showScrim = true, linkNavigation = false, children }: {
  title: string;
  closeHref: string;
  initialField?: "name" | "title" | "code";
  centered?: boolean;
  showScrim?: boolean;
  linkNavigation?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    const firstField = initialField ? `input[name="${initialField}"]` : 'form input:not([type="hidden"])';
    const initialControl = editor.querySelector<HTMLElement>(linkNavigation ? ".tenant-drawer-close" : firstField);
    initialControl?.focus();
    return () => editor.close();
  }, [initialField, linkNavigation]);

  function navigateLinks(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (!linkNavigation || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]:not([tabindex="-1"])')]
      .filter((link) => link.getClientRects().length > 0);
    if (!links.length) return;
    // WebKit can skip anchors in its native Tab order. This dialog's controls are links.
    event.preventDefault();
    const current = links.findIndex((link) => link === document.activeElement);
    if (current < 0) {
      const edge = event.shiftKey ? links.at(-1) : links[0];
      edge?.focus();
      return;
    }
    const direction = event.shiftKey ? -1 : 1;
    links[(current + direction + links.length) % links.length]?.focus();
  }

  return (
    <dialog ref={dialog} className={`tenant-editor-dialog ${centered ? "client-form-modal-layer" : "tenant-drawer-layer"}`} aria-label={title} onKeyDown={navigateLinks} onCancel={(event) => {
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
