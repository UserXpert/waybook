"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export type PerformanceTargetState = { error: string | null; success: string | null };

export async function savePerformanceTarget(_previousState: PerformanceTargetState, formData: FormData): Promise<PerformanceTargetState> {
  try {
    const { tenant, membership } = await requireTenantWorkspace();
    if (!['owner', 'manager'].includes(membership.role)) throw new Error('You do not have permission to set performance targets.');
    const scopeType = String(formData.get('scopeType') ?? '');
    const scopeId = String(formData.get('scopeId') ?? '');
    const metric = String(formData.get('metric') ?? '');
    const periodStart = String(formData.get('periodStart') ?? '');
    const targetInput = Number(formData.get('targetValue'));
    const targetValue = metric === 'booked_value_cents' ? Math.round(targetInput * 100) : targetInput;
    if (!['staff', 'service'].includes(scopeType) || !scopeId || !['bookings', 'booked_value_cents'].includes(metric) || !/^\d{4}-\d{2}$/.test(periodStart) || !Number.isSafeInteger(targetInput) || targetInput <= 0 || targetValue > 100_000_000) {
      throw new Error('Choose a staff member or service, a month, a metric, and a valid positive target.');
    }
    const db = tenantDb(tenant);
    const table = scopeType === 'staff' ? 'team_members' : 'services';
    const [scope] = await db.unsafe<{ id: string }[]>(`SELECT id FROM ${table} WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE LIMIT 1`, [scopeId, tenant.id]);
    if (!scope) throw new Error('That active staff member or service is no longer available.');
    const identity = await requireIdentity();
    const firstOfMonth = `${periodStart}-01`;
    await db.begin(async (transaction) => {
      const [target] = await transaction.unsafe<{ id: string }[]>("INSERT INTO performance_targets (tenant_id,scope_type,scope_id,metric,period_start,target_value,created_by_identity_id) VALUES ($1,$2,$3,$4,$5::date,$6,$7) ON CONFLICT (tenant_id,scope_type,scope_id,metric,period_start) DO UPDATE SET target_value=EXCLUDED.target_value,created_by_identity_id=EXCLUDED.created_by_identity_id,updated_at=now() RETURNING id", [tenant.id, scopeType, scopeId, metric, firstOfMonth, targetValue, identity.id]);
      await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'performance_target.saved','performance_target',$3,$4::jsonb)", [tenant.id, identity.id, target.id, JSON.stringify({ scopeType, scopeId, metric, periodStart: firstOfMonth, targetValue })]);
    });
    revalidatePath('/app/targets'); revalidatePath('/app/reports'); revalidatePath('/app');
    return { error: null, success: 'Monthly target saved.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save the monthly target.', success: null };
  }
}
