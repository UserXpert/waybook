"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { TenantEditorDialog } from "./tenant-editor-dialog";

export function WorkspaceOptions({ label, active = false, children }: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activeId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  return <>
    <button ref={trigger} type="button" className="waybook-action waybook-action--secondary workspace-options-trigger"
      aria-haspopup="dialog" aria-expanded={open} aria-describedby={active ? activeId : undefined} onClick={() => setOpen(true)}>
      <SlidersHorizontal size={16} aria-hidden="true" /> Options
      {active ? <span className="workspace-options-trigger__indicator" aria-hidden="true" /> : null}
    </button>
    {active ? <span id={activeId} className="sr-only">Filters applied</span> : null}
    {open ? <TenantEditorDialog title={label + " options"} onDismiss={close} cycleFocus>
        <div className="tenant-drawer workspace-options-drawer">
          <header>
            <div><p>{label}</p><h2>Options</h2></div>
            <button type="button" className="tenant-drawer-close" aria-label="Close options" onClick={close}><X size={18} aria-hidden="true" /></button>
          </header>
          {children}
        </div>
      </TenantEditorDialog> : null}
  </>;
}

export function ListFilterOptions({ action, label, active, clearHref, children }: {
  action?: string;
  label: string;
  active?: boolean;
  clearHref?: string;
  children: React.ReactNode;
}) {
  return <WorkspaceOptions label={label} active={active}>
    <form action={action} method="get" className="workspace-options-form">
      <div className="workspace-options-fields">{children}</div>
      <footer>
        {active && clearHref ? <a className="waybook-action waybook-action--secondary" href={clearHref}>Clear filters</a> : null}
        <button className="waybook-action" type="submit">Apply</button>
      </footer>
    </form>
  </WorkspaceOptions>;
}
