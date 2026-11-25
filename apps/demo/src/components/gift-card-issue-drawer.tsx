"use client";

import { startTransition, useActionState } from "react";
import { issueGiftCard } from "@/app/app/gift-cards/actions";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";

export function GiftCardIssueDrawer({ closeHref, children }: { closeHref: string; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(issueGiftCard, {});
  return <TenantEditorDialog title="Add gift card" closeHref={closeHref} initialField="code"><aside className="tenant-drawer appointment-drawer" aria-label="Add gift card">
    <header>
      <div>
        <p>Gift cards</p>
        <h2>Add gift card</h2>
        <span>The full card number is hashed and never displayed after issue.</span>
      </div>
      <div className="tenant-drawer-header-actions">
        <button type="submit" form="gift-card-issue" disabled={pending}>{pending ? "Creating…" : "Create gift card"}</button>
      </div>
      <TenantEditorClose href={closeHref} label="Close gift-card panel">Close</TenantEditorClose>
    </header>
    <form id="gift-card-issue" action={action} className="tenant-drawer-form" data-drawer-submit-in-header onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => action(data));
    }}>
      {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
      {children}
    </form>
  </aside></TenantEditorDialog>;
}
