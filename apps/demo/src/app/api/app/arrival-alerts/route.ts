import { NextRequest, NextResponse } from "next/server";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { providerArrivalAlertPending } from "@/lib/waybook/provider-arrival-alerts";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { tenant, membership } = await requireTenantWorkspace(request.headers);
  const enabled = membership.role !== "read-only" && await isFeatureEnabled(tenant.id, "calendars");
  const pending = enabled && await providerArrivalAlertPending(tenantDb(tenant), tenant.id, (await requireIdentity()).id);
  return NextResponse.json({ pending }, { headers: { "Cache-Control": "private, no-store" } });
}
