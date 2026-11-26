import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { tableDateFilters } from "@/lib/waybook/table-date-filters";
import { clientDirectoryQuery, clientLookupQuery } from "@/lib/waybook/client-lookup-query";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant- and permission-scoped client lookup for operational selectors. */
export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace(request.headers);
  const forWaitlist = request.nextUrl.searchParams.get("purpose") === "waitlist";
  const forAppointment = request.nextUrl.searchParams.get("purpose") === "appointment";
  await requireFeature(tenant.id, forWaitlist || forAppointment ? "calendars" : "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  const canViewDirectory = permissions.isManager || permissions.canViewClients || permissions.canManageClients;
  const canLookup = forWaitlist ? permissions.canManageWaitlist : canViewDirectory;
  if (!permissions.isManager && !canLookup) return NextResponse.json({ error: "You do not have permission to search this directory." }, { status: 403 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawCursor = (request.nextUrl.searchParams.get("cursor") ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawCursor) ? rawCursor : null;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const db = tenantDb(tenant);
  const lookupParams = [tenant.id, query, `%${query}%`, cursor, limit + 1];
  const directory = !forAppointment && request.nextUrl.searchParams.get("directory") === "1";
  const dates = tableDateFilters({
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  }, tenant.timezone);
  const rows = forWaitlist
    ? await db.unsafe<{ id: string; name: string; email: string }[]>(`
      SELECT id, name, email FROM customers
      WHERE tenant_id=$1 AND ($2='' OR name ILIKE $3 OR email ILIKE $3 OR ($6 AND coalesce(phone,'') ILIKE $3))
        AND ($4::uuid IS NULL OR (name,id) > (SELECT name,id FROM customers WHERE tenant_id=$1 AND id=$4::uuid))
      ORDER BY name,id LIMIT $5
    `, [...lookupParams, canViewDirectory])
    : await db.unsafe<{ id: string; name: string; email: string; phone: string | null; bookingCount: number; bookedValueCents: number; lastBookingAt: Date | null; nextBookingAt: Date | null }[]>(directory ? clientDirectoryQuery : clientLookupQuery, directory ? [...lookupParams, dates.sort, dates.start, dates.end] : lookupParams);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return NextResponse.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store" } });
}
