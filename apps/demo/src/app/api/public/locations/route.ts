import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";

/** Public, tenant-resolved location lookup; exposes only online-bookable sites. */
export async function GET(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant || !await isFeatureEnabled(tenant.id, "booking-essentials")) return NextResponse.json({ items: [] }, { status: 404 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const rows = await tenantDb(tenant).unsafe<{ id: string; name: string; locationType: string }[]>("SELECT id,name,location_type AS \"locationType\" FROM locations WHERE tenant_id=$1 AND is_active=TRUE AND is_online_bookable=TRUE AND ($2='' OR name ILIKE $3) ORDER BY slug='primary' DESC,name,id LIMIT $4", [tenant.id, query, `%${query}%`, limit]);
  return NextResponse.json({ items: rows });
}
