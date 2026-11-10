"use client";

import { tenantApiPrefix } from "@/lib/waybook/tenant-api-path";

import { useActionState, useEffect, useState } from "react";
import { savePerformanceTarget } from "@/app/app/targets/actions";

type Scope = { id: string; name: string };

export function PerformanceTargetForm({ defaultMonth }: { defaultMonth: string }) {
  const [scopeType, setScopeType] = useState<'staff' | 'service'>('staff');
  const [metric, setMetric] = useState<'bookings' | 'booked_value_cents'>('bookings');
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [state, formAction, pending] = useActionState(savePerformanceTarget, { error: null, success: null });
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { const endpoint = scopeType === 'staff' ? '/api/app/staff' : '/api/app/services'; fetch(`${tenantApiPrefix()}${endpoint}?q=${encodeURIComponent(query)}&limit=20`).then((response) => response.ok ? response.json() : { items: [] }).then((data: { items: Scope[] }) => { if (!cancelled) setScopes(data.items); }).catch(() => { if (!cancelled) setScopes([]); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [query, scopeType]);
  return <form action={formAction} className="tenant-drawer-form">
    <label>Target applies to<select name="scopeType" value={scopeType} onChange={(event) => { setScopeType(event.target.value as 'staff' | 'service'); setQuery(''); }}><option value="staff">Staff member</option><option value="service">Service</option></select></label>
    <label>{scopeType === 'staff' ? 'Staff member' : 'Service'}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${scopeType === 'staff' ? 'staff' : 'services'}`} aria-label={`Search target ${scopeType}`} autoComplete="off" /><select name="scopeId" required disabled={!scopes.length} key={scopeType}><option value="">Choose {scopeType === 'staff' ? 'staff' : 'service'}</option>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></label>
    <label>Measure<select name="metric" value={metric} onChange={(event) => setMetric(event.target.value as 'bookings' | 'booked_value_cents')}><option value="bookings">Non-cancelled bookings</option><option value="booked_value_cents">Booked service value</option></select></label>
    <label>Month<input name="periodStart" type="month" required defaultValue={defaultMonth} /></label>
    <label>{metric === 'bookings' ? 'Monthly booking target' : 'Monthly value target (DKK)'}<input name="targetValue" type="number" min="1" max="100000000" step="1" required /></label>
    <p className="tenant-drawer-note">Booked value is the immutable service value at confirmation, not paid revenue. Saving the same target replaces its value and writes an audit event.</p>
    {state.error ? <p className="manual-appointment__message is-error" role="alert">{state.error}</p> : null}{state.success ? <p className="manual-appointment__message is-success" role="status">{state.success}</p> : null}
    <button type="submit" disabled={pending || !scopes.length}>{pending ? 'Saving…' : 'Save target'}</button>
  </form>;
}
