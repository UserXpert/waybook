"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function TenantEditorDialog({ title, closeHref, initialField, children }: {
  title: string;
  closeHref: string;
  initialField: "name" | "title";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    editor.querySelector<HTMLInputElement>(`input[name="${initialField}"]`)?.focus();
    return () => editor.close();
  }, [initialField]);

  return (
    <dialog ref={dialog} className="tenant-drawer-layer tenant-editor-dialog" aria-label={title} onCancel={(event) => {
      event.preventDefault();
      dialog.current?.close();
      router.push(closeHref, { scroll: false });
    }}>
      <Link className="tenant-drawer-scrim" href={closeHref} tabIndex={-1} aria-hidden="true" scroll={false} onNavigate={() => dialog.current?.close()} />
      {children}
    </dialog>
  );
}

export function TenantEditorClose({ href, label, children }: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={link} className="tenant-drawer-close" aria-label={label} href={href} scroll={false} onNavigate={() => link.current?.closest("dialog")?.close()}>
      {children}
    </Link>
  );
}
