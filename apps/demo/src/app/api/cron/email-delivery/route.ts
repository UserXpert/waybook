import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { controlDb, tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { deliverOneEmail } from "@/lib/waybook/email-delivery-worker";
import { configuredProviderKeyring } from "@/lib/waybook/provider-secret-config";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { queueDueReminders } from "@/lib/waybook/email-reminders";
import { suppressHistoricalEmails } from "@/lib/waybook/email-outbox-queue";
import { drainEmailQueues } from "@/lib/waybook/email-sweep";
import { isEmailDeliveryEnabledForTenant } from "@/lib/waybook/email-delivery-config";

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
  const keyring = configuredProviderKeyring();
  if (!keyring) return NextResponse.json({ error: "Email delivery is unavailable." }, { status: 503 });
  // Atomically rotate the starting tenant even when two scheduler calls overlap.
  const starts = await controlDb<{ lastStartTenantId: string }[]>`
    INSERT INTO email_worker_cursor (worker, last_start_tenant_id)
    SELECT 'delivery', id FROM tenants WHERE lifecycle_status = 'active' ORDER BY id LIMIT 1
    ON CONFLICT (worker) DO UPDATE SET last_start_tenant_id = COALESCE(
      (SELECT id FROM tenants WHERE lifecycle_status = 'active' AND id > email_worker_cursor.last_start_tenant_id ORDER BY id LIMIT 1),
      (SELECT id FROM tenants WHERE lifecycle_status = 'active' ORDER BY id LIMIT 1)
    )
    RETURNING last_start_tenant_id AS "lastStartTenantId"
  `;
  const start = starts[0]?.lastStartTenantId;
  if (!start) return NextResponse.json({ processed: 0, failures: 0 });
  const tenants = await controlDb<TenantRecord[]>`SELECT id,slug,name,lifecycle_status AS "lifecycleStatus",database_env_key AS "databaseEnvKey",timezone FROM tenants WHERE lifecycle_status='active' ORDER BY (id < ${start}::uuid), id`;
  const deadline = Date.now() + 25_000;
  let failures = 0, incomplete = false;
  const ready: TenantRecord[] = [];
  for (const tenant of tenants) {
    if (!isEmailDeliveryEnabledForTenant(tenant.slug)) continue;
    if (Date.now() >= deadline) { incomplete = true; break; }
    try {
      if (!await isFeatureEnabled(tenant.id, "email-notifications")) continue;
      await suppressHistoricalEmails(tenantDb(tenant), tenant.id);
      await queueDueReminders(tenantDb(tenant), tenant.id);
      ready.push(tenant);
    } catch {
      failures++;
      // Database and provider errors may contain secrets or customer details.
      console.error("email_delivery_tenant_failed", { tenant: tenant.slug });
    }
  }
  const drained = await drainEmailQueues({ tenants: ready, deadline, process: (tenant) => deliverOneEmail(tenantDb(tenant), tenant.id, keyring.resolve), completed: async (tenant) => { await controlDb`INSERT INTO email_worker_heartbeats (tenant_id,last_success_at) VALUES (${tenant.id},now()) ON CONFLICT (tenant_id) DO UPDATE SET last_success_at=EXCLUDED.last_success_at`; }, failed: (tenant) => console.error("email_delivery_tenant_failed", { tenant: tenant.slug }) });
  const processed = drained.processed;
  failures += drained.failures;
  incomplete ||= drained.incomplete;
  console.info("email_delivery_run_completed", { processed, failures, incomplete });
  return NextResponse.json({ processed, failures, incomplete }, { status: failures || incomplete ? 503 : 200 });
}
