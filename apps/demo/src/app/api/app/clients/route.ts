import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
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
    "SELECT c.id,c.name,c.email,c.phone,c.tags,count(b.id)::int AS \"bookingCount\",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS \"bookedValueCents\",max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS \"lastBookingAt\",min(b.starts_at) FILTER (WHERE b.status IN ('confirmed','arrived') AND b.starts_at >= now()) AS \"nextBookingAt\" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.email ILIKE $3 OR coalesce(c.phone,'') ILIKE $3) AND ($4::uuid IS NULL OR (c.name,c.id) > (coalesce((SELECT name FROM customers WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid)) GROUP BY c.id ORDER BY c.name,c.id LIMIT $5",
    [tenant.id, query, `%${query}%`, cursor, limit + 1],
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return NextResponse.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store" } });
}
