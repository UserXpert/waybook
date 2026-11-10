import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { controlDb, tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { deliverOneEmail } from "@/lib/waybook/email-delivery-worker";
import { configuredProviderKey } from "@/lib/waybook/provider-secret-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Protected worker endpoint. No schedule is enabled until a timely trigger is configured. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.WAYBOOK_EMAIL_DELIVERY_ENABLED !== "true") return NextResponse.json({ error: "Email delivery is disabled." }, { status: 503 });
  const key = configuredProviderKey();
  if (!key) return NextResponse.json({ error: "Email delivery is unavailable." }, { status: 503 });
  const tenants = await controlDb<TenantRecord[]>`SELECT id,slug,name,lifecycle_status AS "lifecycleStatus",database_env_key AS "databaseEnvKey",timezone FROM tenants WHERE lifecycle_status='active' ORDER BY id`;
  const deadline = Date.now() + 25_000;
  let processed = 0, failures = 0;
  for (const tenant of tenants) {
    if (Date.now() >= deadline) break;
    try {
      for (let count = 0; count < 2 && Date.now() < deadline; count++) {
        const result = await deliverOneEmail(tenantDb(tenant), tenant.id, (id) => id === key.id ? key.key : undefined);
        if (result !== "processed") break;
        processed++;
      }
    } catch {
      failures++;
      // Database and provider errors may contain secrets or customer details.
      console.error("email_delivery_tenant_failed", { tenant: tenant.slug });
    }
  }
  console.info("email_delivery_run_completed", { processed, failures });
  return NextResponse.json({ processed, failures }, { status: failures ? 500 : 200 });
}
