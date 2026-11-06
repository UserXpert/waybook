"use server";

import { revalidatePath } from "next/cache";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";

function slug(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "location"; }

export async function saveLocation(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, 'booking-essentials');
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error('You do not have permission to manage locations.');
  const id = String(formData.get('locationId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const locationType = String(formData.get('locationType') ?? 'fixed');
  if (!name || !['fixed', 'mobile'].includes(locationType)) throw new Error('Enter a location name and valid type.');
  const db = tenantDb(tenant);
  const fields = [String(formData.get('phone') ?? '').trim() || null, String(formData.get('addressLine1') ?? '').trim() || null, String(formData.get('addressLine2') ?? '').trim() || null, String(formData.get('city') ?? '').trim() || null, String(formData.get('region') ?? '').trim() || null, String(formData.get('postalCode') ?? '').trim() || null];
  const online = String(formData.get('isOnlineBookable') ?? 'on') === 'on';
  const active = String(formData.get('isActive') ?? 'on') === 'on';
  const openingHours = [1, 2, 3, 4, 5, 6, 0].flatMap((day) => {
    if (String(formData.get(`open-${day}`)) !== 'on') return [];
    const start = String(formData.get(`start-${day}`) ?? '09:00');
    const end = String(formData.get(`end-${day}`) ?? '17:00');
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
      throw new Error('Each opening period must end after it starts.');
    }
    return [{ day, start, end }];
  });
  let locationId = id;
  if (id) {
    const [row] = await db<{ id: string }[]>`UPDATE locations SET name=${name}, location_type=${locationType}, is_online_bookable=${online}, phone=${fields[0]}, address_line_1=${fields[1]}, address_line_2=${fields[2]}, city=${fields[3]}, region=${fields[4]}, postal_code=${fields[5]}, is_active=${active}, updated_at=now() WHERE id=${id} AND tenant_id=${tenant.id} RETURNING id`;
    if (!row) throw new Error('Location is unavailable.');
  } else {
    const base = slug(name); const [count] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM locations WHERE tenant_id=${tenant.id} AND slug LIKE ${`${base}%`}`;
    const [row] = await db<{ id: string }[]>`INSERT INTO locations (tenant_id, slug, name, location_type, is_online_bookable, phone, address_line_1, address_line_2, city, region, postal_code, timezone, is_active) VALUES (${tenant.id}, ${count?.count ? `${base}-${count.count + 1}` : base}, ${name}, ${locationType}, ${online}, ${fields[0]}, ${fields[1]}, ${fields[2]}, ${fields[3]}, ${fields[4]}, ${fields[5]}, ${tenant.timezone}, ${active}) RETURNING id`;
    locationId = row.id;
  }
  await db`DELETE FROM location_hours WHERE tenant_id=${tenant.id} AND location_id=${locationId}`;
  for (const { day, start, end } of openingHours) {
    await db`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time) VALUES (${tenant.id}, ${locationId}, ${day}, ${start}, ${end})`;
  }
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${id ? 'location.updated' : 'location.created'}, 'location', ${locationId}, ${JSON.stringify({ name, locationType, online, active })}::jsonb)`;
  revalidatePath('/app'); revalidatePath('/app/locations'); revalidatePath('/app/team'); revalidatePath('/app/services'); revalidatePath('/app/calendars'); revalidatePath('/book');
}

async function editableLocation(locationId: string) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, 'booking-essentials');
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error('You do not have permission to manage locations.');
  const db = tenantDb(tenant);
  const [location] = await db<{ id: string }[]>`SELECT id FROM locations WHERE id=${locationId} AND tenant_id=${tenant.id}`;
  if (!location) throw new Error('Location is unavailable.');
  return { tenant, db };
}

function revalidateLocations() {
  revalidatePath('/app'); revalidatePath('/app/locations'); revalidatePath('/app/calendars'); revalidatePath('/book');
}

export async function addLocationClosedDate(formData: FormData) {
  const locationId = String(formData.get('locationId') ?? '');
  const localDate = String(formData.get('localDate') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || (reason && reason.length > 300)) throw new Error('Enter a valid date and a short closure reason.');
  const { tenant, db } = await editableLocation(locationId);
  await db`INSERT INTO location_closed_dates (tenant_id, location_id, local_date, reason) VALUES (${tenant.id}, ${locationId}, ${localDate}, ${reason}) ON CONFLICT (location_id, local_date) DO UPDATE SET reason=EXCLUDED.reason`;
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'location.closed_date.saved', 'location', ${locationId}, ${JSON.stringify({ localDate, reason })}::jsonb)`;
  revalidateLocations();
}

export async function removeLocationClosedDate(formData: FormData) {
  const locationId = String(formData.get('locationId') ?? '');
  const closedDateId = String(formData.get('closedDateId') ?? '');
  const { tenant, db } = await editableLocation(locationId);
  const [removed] = await db<{ id: string; localDate: string }[]>`DELETE FROM location_closed_dates WHERE id=${closedDateId} AND location_id=${locationId} AND tenant_id=${tenant.id} RETURNING id, local_date::text AS "localDate"`;
  if (!removed) throw new Error('Closed date is unavailable.');
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'location.closed_date.removed', 'location', ${locationId}, ${JSON.stringify({ localDate: removed.localDate })}::jsonb)`;
  revalidateLocations();
}
