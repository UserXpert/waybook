"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { issueGiftCard } from "@/app/app/gift-cards/actions";

export function GiftCardIssueDrawer({ closeHref, children }: { closeHref: string; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(issueGiftCard, {});
  return <aside className="tenant-drawer appointment-drawer" aria-label="Add gift card">
    <header>
      <div>
        <p>Gift cards</p>
        <h2>Add gift card</h2>
        <span>The full card number is hashed and never displayed after issue.</span>
      </div>
      <div className="tenant-drawer-header-actions">
        <button type="submit" form="gift-card-issue" disabled={pending}>{pending ? "Creating…" : "Create gift card"}</button>
      </div>
      <Link className="tenant-drawer-close" href={closeHref} aria-label="Close gift-card panel">Close</Link>
    </header>
    <form id="gift-card-issue" action={action} className="tenant-drawer-form" data-drawer-submit-in-header onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => action(data));
    }}>
      {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}
      {children}
    </form>
  </aside>;
}
