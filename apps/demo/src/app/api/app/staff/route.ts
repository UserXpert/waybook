import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "calendars");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings && !permissions.canManageTeamAppointments && !permissions.canManageOwnAppointments) return NextResponse.json({ error: "You do not have permission to search staff." }, { status: 403 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawLocationId = (request.nextUrl.searchParams.get("locationId") ?? "").trim();
  const rawServiceId = (request.nextUrl.searchParams.get("serviceId") ?? "").trim();
  const isUuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  if ((rawLocationId && !isUuid(rawLocationId)) || (rawServiceId && !isUuid(rawServiceId))) return NextResponse.json({ items: [], nextCursor: null });
  const locationId = rawLocationId;
  const serviceId = rawServiceId;
  const rawCursor = (request.nextUrl.searchParams.get("cursor") ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawCursor) ? rawCursor : null;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const db = tenantDb(tenant);
  const rows = await db.unsafe<{ id: string; name: string; email: string }[]>("SELECT tm.id,tm.name,tm.email FROM team_members tm WHERE tm.tenant_id=$1 AND tm.is_active=TRUE AND ($2='' OR tm.name ILIKE $3 OR tm.email ILIKE $3) AND ($4='' OR EXISTS (SELECT 1 FROM team_member_locations tml WHERE tml.tenant_id=tm.tenant_id AND tml.team_member_id=tm.id AND tml.location_id=$4::uuid)) AND ($5='' OR EXISTS (SELECT 1 FROM service_team_members stm WHERE stm.tenant_id=tm.tenant_id AND stm.team_member_id=tm.id AND stm.service_id=$5::uuid)) AND ($6::uuid IS NULL OR (tm.name,tm.id) > (coalesce((SELECT name FROM team_members WHERE tenant_id=$1 AND id=$6::uuid),''),$6::uuid)) ORDER BY tm.name,tm.id LIMIT $7", [tenant.id, query, `%${query}%`, locationId, serviceId, cursor, limit + 1]);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return NextResponse.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null });
}
