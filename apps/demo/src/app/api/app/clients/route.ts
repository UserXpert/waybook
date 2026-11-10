import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { clientLookupQuery } from "@/lib/waybook/client-lookup-query";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant- and permission-scoped client lookup for operational selectors. */
export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace(request.headers);
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canViewClients && !permissions.canManageClients) return NextResponse.json({ error: "You do not have permission to search clients." }, { status: 403 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawCursor = (request.nextUrl.searchParams.get("cursor") ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawCursor) ? rawCursor : null;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const db = tenantDb(tenant);
  const rows = await db.unsafe<{ id: string; name: string; email: string; phone: string | null; tags: string[]; bookingCount: number; bookedValueCents: number; lastBookingAt: Date | null; nextBookingAt: Date | null }[]>(
    clientLookupQuery,
    [tenant.id, query, `%${query}%`, cursor, limit + 1],
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return NextResponse.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store" } });
}
