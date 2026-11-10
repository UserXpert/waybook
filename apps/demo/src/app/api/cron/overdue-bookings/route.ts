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
    try {
      const count = await closeOverdueConfirmedBookings(tenant, 1000);
      updated += count;
      if (count === 1000) console.warn("overdue_booking_sweep_limit_reached", { tenant: tenant.slug, limit: 1000 });
    }
    catch {
      failures.push(tenant.slug);
      // Avoid logging database error objects, which may contain connection details.
      console.error("overdue_booking_sweep_failed", { tenant: tenant.slug });
    }
  }
  console.info("overdue_booking_sweep_completed", { tenants: tenants.length, updated, failures: failures.length });
  return NextResponse.json({ updated, failures }, { status: failures.length ? 500 : 200 });
}
