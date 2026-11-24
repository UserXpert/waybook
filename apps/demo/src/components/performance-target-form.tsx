"use client";

import { defaultTenantTerminology, titleTerminology, type TenantTerminology } from "@/lib/waybook/terminology-labels";
import { TenantEditorClose } from "@/components/tenant-editor-dialog";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useActionState, useEffect, useState } from "react";
import { savePerformanceTarget } from "@/app/app/targets/actions";
import { showSuccessToast } from "@/lib/waybook/toast";

type Scope = { id: string; name: string };
type ScopeSearchResult = Scope | { id: string; title: string };

export function PerformanceTargetEditor({ closeHref, defaultMonth, terminology = defaultTenantTerminology }: { closeHref: string; defaultMonth: string; terminology?: TenantTerminology }) {
  const [scopeType, setScopeType] = useState<'staff' | 'service'>('staff');
  const [metric, setMetric] = useState<'bookings' | 'booked_value_cents'>('bookings');
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [state, formAction, pending] = useActionState(savePerformanceTarget, { error: null, success: null });
  useEffect(() => {
    if (state.success) showSuccessToast(state.success);
  }, [state]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const endpoint = scopeType === 'staff' ? '/api/app/staff' : '/api/app/services';
      try {
        const response = await fetch(`${tenantApiPrefix()}${endpoint}?q=${encodeURIComponent(query)}&limit=20`, { signal: controller.signal });
        const data: { items: ScopeSearchResult[] } = response.ok ? await response.json() : { items: [] };
        if (!controller.signal.aborted) {
          setScopes(data.items.map((item) => ({ id: item.id, name: "title" in item ? item.title : item.name })));
        }
      } catch {
        if (!controller.signal.aborted) setScopes([]);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, scopeType]);
  return <aside className="tenant-drawer" aria-label="Set monthly target">
    <header>
      <div><p>Monthly targets</p><h2>Set target</h2></div>
      <div className="tenant-drawer-header-actions">
        <button type="submit" form="performance-target-form" disabled={pending || !scopes.length}>{pending ? 'Saving…' : 'Save target'}</button>
      </div>
      <TenantEditorClose label="Close target editor" href={closeHref}>×</TenantEditorClose>
    </header>
    <form id="performance-target-form" action={formAction} className="tenant-drawer-form" data-drawer-submit-in-header>
    <label>Target applies to<select name="scopeType" value={scopeType} onChange={(event) => { setScopes([]); setScopeType(event.target.value as 'staff' | 'service'); setQuery(''); }}><option value="staff">{titleTerminology(terminology.staffMember)}</option><option value="service">Service</option></select></label>
    <label>{scopeType === 'staff' ? titleTerminology(terminology.staffMember) : 'Service'}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${scopeType === 'staff' ? terminology.staffPlural : 'services'}`} aria-label={`Search target ${scopeType}`} autoComplete="off" /><select name="scopeId" required disabled={!scopes.length} key={scopeType}><option value="">Choose {scopeType === 'staff' ? terminology.staffPlural : 'service'}</option>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></label>
    <label>Measure<select name="metric" value={metric} onChange={(event) => setMetric(event.target.value as 'bookings' | 'booked_value_cents')}><option value="bookings">Non-cancelled bookings</option><option value="booked_value_cents">Booked service value</option></select></label>
    <label>Month<input name="periodStart" type="month" required defaultValue={defaultMonth} /></label>
    <label>{metric === 'bookings' ? 'Monthly booking target' : 'Monthly value target (DKK)'}<input name="targetValue" type="number" min="1" max="100000000" step="1" required /></label>
    <p className="tenant-drawer-note">Booked value is the immutable service value at confirmation, not paid revenue. Saving the same target replaces its value and writes an audit event.</p>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    </form>
  </aside>;
}
