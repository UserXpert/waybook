import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace(request.headers);
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings && !permissions.canManageTeamAppointments && !permissions.canManageOwnAppointments) return NextResponse.json({ error: "You do not have permission to search locations." }, { status: 403 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawCursor = (request.nextUrl.searchParams.get("cursor") ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawCursor) ? rawCursor : null;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const rows = await tenantDb(tenant).unsafe<{ id: string; name: string }[]>("SELECT l.id,l.name FROM locations l WHERE l.tenant_id=$1 AND l.is_active=TRUE AND ($2='' OR l.name ILIKE $3) AND ($4::uuid IS NULL OR (l.name,l.id) > (coalesce((SELECT name FROM locations WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid)) ORDER BY l.name,l.id LIMIT $5", [tenant.id, query, `%${query}%`, cursor, limit + 1]);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return NextResponse.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store" } });
}
