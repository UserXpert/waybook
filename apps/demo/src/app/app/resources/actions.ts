"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";

export async function saveResource(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, 'resources');
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageResources) throw new Error('You do not have permission to manage resources.');
  const resourceId = String(formData.get('resourceId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const resourceType = String(formData.get('resourceType') ?? '').trim();
  const capacity = Number(formData.get('capacity'));
  const isMutuallyExclusive = String(formData.get('isMutuallyExclusive') ?? '') === 'on';
  const isActive = String(formData.get('isActive') ?? 'on') === 'on';
  const locationIds = formData.getAll('locationIds').map(String).filter(Boolean);
  const serviceIds = formData.getAll('serviceIds').map(String).filter(Boolean);
  if (!name || name.length > 120 || !resourceType || resourceType.length > 80 || capacity !== 1) throw new Error('Each resource is one exclusive capacity unit. Add another resource for another room, chair, or bay.');
  const db = tenantDb(tenant);
  const [locations, services] = await Promise.all([
    db.unsafe<{ id: string }[]>('SELECT id FROM locations WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_active=TRUE', [tenant.id, locationIds]),
    db.unsafe<{ id: string }[]>('SELECT id FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_active=TRUE', [tenant.id, serviceIds]),
  ]);
  if (locations.length !== locationIds.length || services.length !== serviceIds.length) throw new Error('One or more selected locations or services are unavailable.');
  const identity = await requireIdentity(); let id = resourceId;
  await db.begin(async (transaction) => {
    if (id) {
      const [resource] = await transaction.unsafe<{ id: string }[]>('UPDATE resources SET name=$1, resource_type=$2, capacity=$3, is_mutually_exclusive=$4, is_active=$5, updated_at=now() WHERE id=$6 AND tenant_id=$7 RETURNING id', [name, resourceType, capacity, isMutuallyExclusive, isActive, id, tenant.id]);
      if (!resource) throw new Error('Resource is unavailable.');
    } else {
      const [resource] = await transaction.unsafe<{ id: string }[]>('INSERT INTO resources (tenant_id,name,resource_type,capacity,is_mutually_exclusive,is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [tenant.id, name, resourceType, capacity, isMutuallyExclusive, isActive]);
      id = resource.id;
    }
    await transaction.unsafe('DELETE FROM resource_locations WHERE tenant_id=$1 AND resource_id=$2', [tenant.id, id]);
    for (const location of locations) await transaction.unsafe('INSERT INTO resource_locations (tenant_id,resource_id,location_id) VALUES ($1,$2,$3)', [tenant.id, id, location.id]);
    await transaction.unsafe('DELETE FROM service_resources WHERE tenant_id=$1 AND resource_id=$2', [tenant.id, id]);
    for (const service of services) await transaction.unsafe('INSERT INTO service_resources (tenant_id,service_id,resource_id) VALUES ($1,$2,$3)', [tenant.id, service.id, id]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,$3,'resource',$4,$5::jsonb)", [tenant.id, identity.id, resourceId ? 'resource.updated' : 'resource.created', id, JSON.stringify({ name, resourceType, capacity, isMutuallyExclusive, locationIds, serviceIds })]);
  });
  revalidatePath('/app/resources'); revalidatePath('/app/calendars'); revalidatePath('/app/services');
}
