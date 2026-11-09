import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { controlDb, type TenantRecord } from "@/lib/waybook/database";
import { closeOverdueConfirmedBookings } from "@/lib/waybook/overdue-bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  const providedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (!secret || providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenants = await controlDb<TenantRecord[]>`SELECT id,slug,name,lifecycle_status AS "lifecycleStatus",database_env_key AS "databaseEnvKey",timezone FROM tenants WHERE lifecycle_status='active'`;
  let updated = 0;
  const failures: string[] = [];
  for (const tenant of tenants) {
    try { updated += await closeOverdueConfirmedBookings(tenant, 1000); }
    catch { failures.push(tenant.slug); }
  }
  return NextResponse.json({ updated, failures }, { status: failures.length ? 500 : 200 });
}
