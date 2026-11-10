import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounded service search for operational forms; submitted IDs stay server-validated. */
export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace(request.headers);
  await requireFeature(tenant.id, "calendars");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageWaitlist && !permissions.canManageTeamAppointments && !permissions.canManageOwnAppointments) return NextResponse.json({ error: "You do not have permission to search services." }, { status: 403 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const locationId = (request.nextUrl.searchParams.get("locationId") ?? "").trim();
  if (locationId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(locationId)) return NextResponse.json({ items: [] });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const rows = await tenantDb(tenant).unsafe<{ id: string; title: string; durationMinutes: number }[]>("SELECT s.id,s.title,s.duration_minutes AS \"durationMinutes\" FROM services s WHERE s.tenant_id=$1 AND s.is_active=TRUE AND ($2='' OR s.title ILIKE $3) AND ($4='' OR EXISTS (SELECT 1 FROM service_locations sl JOIN locations l ON l.id=sl.location_id AND l.tenant_id=sl.tenant_id WHERE sl.tenant_id=s.tenant_id AND sl.service_id=s.id AND sl.location_id=$4::uuid AND l.is_active=TRUE)) ORDER BY s.title,s.id LIMIT $5", [tenant.id, query, `%${query}%`, locationId, limit]);
  return NextResponse.json({ items: rows }, { headers: { "Cache-Control": "private, no-store" } });
}
