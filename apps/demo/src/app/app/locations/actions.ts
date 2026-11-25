"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { withSuccessToast } from "@/lib/waybook/toast";

function slug(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "location"; }

type LocationSaveState = { error?: string };

export async function saveLocation(_: LocationSaveState, formData: FormData): Promise<LocationSaveState> {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, 'booking-essentials');
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error('You do not have permission to manage locations.');
  const id = String(formData.get('locationId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const locationType = String(formData.get('locationType') ?? 'fixed');
  if (!name || !['fixed', 'mobile'].includes(locationType)) return { error: 'Enter a location name and valid type.' };
  const db = tenantDb(tenant);
  const fields = [String(formData.get('phone') ?? '').trim() || null, String(formData.get('addressLine1') ?? '').trim() || null, String(formData.get('addressLine2') ?? '').trim() || null, String(formData.get('city') ?? '').trim() || null, String(formData.get('region') ?? '').trim() || null, String(formData.get('postalCode') ?? '').trim() || null];
  const online = formData.get('isOnlineBookable') === 'on';
  const active = formData.get('isActive') === 'on';
  type OpeningHour = { day: number; start: string; end: string };
  const legacyOpeningHours: OpeningHour[] = [1, 2, 3, 4, 5, 6, 0].flatMap((day) => {
    if (String(formData.get(`open-${day}`)) !== 'on') return [];
    const start = String(formData.get(`start-${day}`) ?? '09:00');
    const end = String(formData.get(`end-${day}`) ?? '17:00');
    return [{ day, start, end }];
  });
  let openingHours = legacyOpeningHours;
  const serializedHours = String(formData.get('openingHours') ?? '');
  if (serializedHours) {
    try {
      const parsed: unknown = JSON.parse(serializedHours);
      if (!Array.isArray(parsed) || !parsed.every((entry): entry is OpeningHour =>
        entry && typeof entry === 'object' && typeof entry.day === 'number' &&
        typeof entry.start === 'string' && typeof entry.end === 'string')) {
        return { error: 'Opening hours could not be read. Please try again.' };
      }
      openingHours = parsed;
    } catch {
      return { error: 'Opening hours could not be read. Please try again.' };
    }
  }
  const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (openingHours.some(({ day, start, end }) => !Number.isInteger(day) || day < 0 || day > 6 || !clockTime.test(start) || !clockTime.test(end) || end <= start)) {
    return { error: 'Each opening period must end after it starts.' };
  }
  const ordered = [...openingHours].sort((left, right) => left.day - right.day || left.start.localeCompare(right.start));
  if (ordered.some((hour, index) => index > 0 && hour.day === ordered[index - 1].day && hour.start < ordered[index - 1].end)) {
    return { error: 'Opening periods on the same day cannot overlap.' };
  }

  const locationId = await db.begin(async (transaction) => {
    let row: { id: string } | undefined;
    if (id) {
      [row] = await transaction.unsafe<{ id: string }[]>(
        'UPDATE locations SET name=$1, location_type=$2, is_online_bookable=$3, phone=$4, address_line_1=$5, address_line_2=$6, city=$7, region=$8, postal_code=$9, is_active=$10, updated_at=now() WHERE id=$11 AND tenant_id=$12 RETURNING id',
        [name, locationType, online, ...fields, active, id, tenant.id],
      );
    } else {
      const base = slug(name);
      const [count] = await transaction.unsafe<{ count: number }[]>('SELECT count(*)::int AS count FROM locations WHERE tenant_id=$1 AND slug LIKE $2', [tenant.id, base + '%']);
      [row] = await transaction.unsafe<{ id: string }[]>(
        'INSERT INTO locations (tenant_id, slug, name, location_type, is_online_bookable, phone, address_line_1, address_line_2, city, region, postal_code, timezone, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
        [tenant.id, count?.count ? base + '-' + (count.count + 1) : base, name, locationType, online, ...fields, tenant.timezone, active],
      );
    }
    if (!row) return null;
    await transaction.unsafe('DELETE FROM location_hours WHERE tenant_id=$1 AND location_id=$2', [tenant.id, row.id]);
    for (const { day, start, end } of ordered) {
      await transaction.unsafe('INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4,$5)', [tenant.id, row.id, day, start, end]);
    }
    await transaction.unsafe(
      "INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1,$2,'location',$3,$4::jsonb)",
      [tenant.id, id ? 'location.updated' : 'location.created', row.id, JSON.stringify({ name, locationType, online, active })],
    );
    return row.id;
  });
  if (!locationId) return { error: 'Location is unavailable.' };
  revalidatePath('/app'); revalidatePath('/app/locations'); revalidatePath('/app/team'); revalidatePath('/app/services'); revalidatePath('/app/calendars'); revalidatePath('/book');
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/locations")}?location=${locationId}`, "Location saved."));
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
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/locations")}?location=${locationId}`, "Closed date saved."));
}

export async function removeLocationClosedDate(formData: FormData) {
  const locationId = String(formData.get('locationId') ?? '');
  const closedDateId = String(formData.get('closedDateId') ?? '');
  const { tenant, db } = await editableLocation(locationId);
  const [removed] = await db<{ id: string; localDate: string }[]>`DELETE FROM location_closed_dates WHERE id=${closedDateId} AND location_id=${locationId} AND tenant_id=${tenant.id} RETURNING id, local_date::text AS "localDate"`;
  if (!removed) throw new Error('Closed date is unavailable.');
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'location.closed_date.removed', 'location', ${locationId}, ${JSON.stringify({ localDate: removed.localDate })}::jsonb)`;
  revalidateLocations();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  redirect(withSuccessToast(`${tenantPath(tenantSlug, "/app/locations")}?location=${locationId}`, "Closed date removed."));
}
