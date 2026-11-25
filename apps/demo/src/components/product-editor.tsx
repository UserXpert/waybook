"use client";

import { startTransition, useActionState } from "react";
import { saveProduct } from "@/app/app/products/actions";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";

export function ProductEditor({ title, closeHref, children }: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(saveProduct, {});

  return <TenantEditorDialog title={title} closeHref={closeHref} initialField="title">
    <aside className="tenant-drawer product-editor-drawer" aria-label={title}>
      <header>
        <div><p>CATALOGUE</p><h2>{title}</h2><span>Product changes apply only to future retail sale lines.</span></div>
        <div className="tenant-drawer-header-actions">
          <button type="submit" form="product-editor-form" disabled={pending}>{pending ? "Saving…" : "Save product"}</button>
        </div>
        <TenantEditorClose href={closeHref} label="Close product editor">Close</TenantEditorClose>
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
  </TenantEditorDialog>;
}
