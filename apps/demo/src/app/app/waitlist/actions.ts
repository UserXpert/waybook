"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";

export type WaitlistState = { error: string | null; success: string | null };

async function editableWaitlistTenant() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, 'calendars');
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageWaitlist) {
    throw new Error('You do not have permission to manage the waitlist.');
  }
  return tenant;
}

function revalidateWaitlist() {
  revalidatePath('/app');
  revalidatePath('/app/waitlist');
  revalidatePath('/app/calendars');
}

export async function addWaitlistEntry(_previousState: WaitlistState, formData: FormData): Promise<WaitlistState> {
  try {
    const customerId = String(formData.get('customerId') ?? '');
    const serviceId = String(formData.get('serviceId') ?? '');
    const locationId = String(formData.get('locationId') ?? '');
    const preferredTeamMemberId = String(formData.get('preferredTeamMemberId') ?? '') || null;
    const preferredLocalDate = String(formData.get('preferredLocalDate') ?? '') || null;
    const preferredStartTime = String(formData.get('preferredStartTime') ?? '') || null;
    const preferredEndTime = String(formData.get('preferredEndTime') ?? '') || null;
    const notes = String(formData.get('notes') ?? '').trim() || null;
    if (!customerId || !serviceId || !locationId || (preferredLocalDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredLocalDate)) || (preferredStartTime && !/^\d{2}:\d{2}$/.test(preferredStartTime)) || (preferredEndTime && !/^\d{2}:\d{2}$/.test(preferredEndTime)) || Boolean(preferredStartTime) !== Boolean(preferredEndTime) || (preferredStartTime && preferredEndTime && preferredEndTime <= preferredStartTime) || (notes?.length ?? 0) > 1000) {
      throw new Error('Choose a client, service, location, and a valid optional preference window.');
    }
    const tenant = await editableWaitlistTenant();
    const db = tenantDb(tenant);
    const [customer, service] = await Promise.all([
      db.unsafe<{ id: string }[]>('SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 LIMIT 1', [customerId, tenant.id]),
      db.unsafe<{ id: string }[]>('SELECT s.id FROM services s JOIN service_locations sl ON sl.service_id = s.id AND sl.tenant_id = s.tenant_id JOIN locations l ON l.id = sl.location_id AND l.tenant_id = s.tenant_id WHERE s.id = $1 AND s.tenant_id = $2 AND sl.location_id = $3 AND s.is_active = TRUE AND l.is_active = TRUE LIMIT 1', [serviceId, tenant.id, locationId]),
    ]);
    if (!customer[0] || !service[0]) throw new Error('The client, service, or location is no longer available.');
    if (preferredTeamMemberId) {
      const [staff] = await db.unsafe<{ id: string }[]>('SELECT tm.id FROM team_members tm JOIN team_member_locations tml ON tml.team_member_id = tm.id AND tml.tenant_id = tm.tenant_id JOIN service_team_members stm ON stm.team_member_id = tm.id AND stm.tenant_id = tm.tenant_id WHERE tm.id = $1 AND tm.tenant_id = $2 AND tm.is_active = TRUE AND tml.location_id = $3 AND stm.service_id = $4 LIMIT 1', [preferredTeamMemberId, tenant.id, locationId, serviceId]);
      if (!staff) throw new Error('That staff member cannot deliver this service at the selected location.');
    }
    const identity = await requireIdentity();
    const [entry] = await db.unsafe<{ id: string }[]>('INSERT INTO waitlist_entries (tenant_id, customer_id, service_id, location_id, preferred_team_member_id, preferred_local_date, preferred_start_time, preferred_end_time, notes, created_by_identity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [tenant.id, customerId, serviceId, locationId, preferredTeamMemberId, preferredLocalDate, preferredStartTime, preferredEndTime, notes, identity.id]);
    await db.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'waitlist.created', 'waitlist_entry', $3, $4::jsonb)", [tenant.id, identity.id, entry.id, JSON.stringify({ customerId, serviceId, locationId, preferredTeamMemberId })]);
    revalidateWaitlist();
    return { error: null, success: 'Client added to the waiting list.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add the client to the waitlist.', success: null };
  }
}

export async function saveWaitlistStatus(formData: FormData) {
  const entryId = String(formData.get('entryId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!entryId || !['waiting', 'offered', 'booked', 'cancelled'].includes(status)) throw new Error('Choose a valid waitlist status.');
  const tenant = await editableWaitlistTenant();
  const db = tenantDb(tenant); const identity = await requireIdentity();
  const [entry] = await db.unsafe<{ id: string }[]>('UPDATE waitlist_entries SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id', [status, entryId, tenant.id]);
  if (!entry) throw new Error('This waitlist entry is unavailable.');
  await db.unsafe("INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, 'waitlist_entry', $4, $5::jsonb)", [tenant.id, identity.id, 'waitlist.' + status, entry.id, JSON.stringify({ status })]);
  revalidateWaitlist();
}
