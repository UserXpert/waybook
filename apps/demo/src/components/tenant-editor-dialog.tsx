"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function TenantEditorDialog({ title, closeHref, initialField, centered = false, children }: {
  title: string;
  closeHref: string;
  initialField?: "name" | "title" | "code";
  centered?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    const firstField = initialField ? `input[name="${initialField}"]` : 'form input:not([type="hidden"])';
    editor.querySelector<HTMLInputElement>(firstField)?.focus();
    return () => editor.close();
  }, [initialField]);

  return (
    <dialog ref={dialog} className={`tenant-editor-dialog ${centered ? "client-form-modal-layer" : "tenant-drawer-layer"}`} aria-label={title} onCancel={(event) => {
      event.preventDefault();
      dialog.current?.close();
      router.push(closeHref, { scroll: false });
    }}>
      <Link className={centered ? "client-form-modal__scrim" : "tenant-drawer-scrim"} href={closeHref} tabIndex={-1} aria-hidden="true" scroll={false} onNavigate={() => dialog.current?.close()} />
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
