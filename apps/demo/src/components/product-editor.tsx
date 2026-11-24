"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { saveProduct } from "@/app/app/products/actions";

export function ProductEditor({ title, closeHref, children }: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(saveProduct, {});
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    editor.showModal();
    editor.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return () => editor.close();
  }, []);

  return <dialog ref={dialog} className="tenant-drawer-layer product-editor-dialog" aria-label={title} onCancel={(event) => {
    event.preventDefault();
    dialog.current?.close();
    router.push(closeHref, { scroll: false });
  }}>
    <Link className="tenant-drawer-scrim" href={closeHref} tabIndex={-1} aria-hidden="true" scroll={false} onClick={() => dialog.current?.close()} />
    <aside className="tenant-drawer product-editor-drawer" aria-label={title}>
      <header>
        <div><p>CATALOGUE</p><h2>{title}</h2><span>Product changes apply only to future retail sale lines.</span></div>
        <div className="tenant-drawer-header-actions">
          <button type="submit" form="product-editor-form" disabled={pending}>{pending ? "Saving…" : "Save product"}</button>
        </div>
        <Link className="tenant-drawer-close" href={closeHref} aria-label="Close product editor" scroll={false} onClick={() => dialog.current?.close()}>Close</Link>
      </header>
      <form id="product-editor-form" action={action} className="tenant-drawer-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}>
        {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
        {children}
      </form>
    </aside>
  </dialog>;
}
