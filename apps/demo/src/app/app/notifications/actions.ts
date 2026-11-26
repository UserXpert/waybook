"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { providerArrivalInbox } from "@/lib/waybook/provider-arrival-alerts";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export async function markArrivalAlertRead(form: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "calendars");
  if (membership.role === "read-only") throw new Error("Waiting room alerts are unavailable.");
  const bookingId = String(form.get("bookingId") ?? "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookingId)) return;
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db`
    WITH visible AS (
      SELECT alert.booking_id, alert.team_member_id
      ${providerArrivalInbox(db, tenant.id, identity.id)}
      AND alert.booking_id = ${bookingId} AND alert.read_at IS NULL
    )
    UPDATE provider_arrival_alerts alert SET read_at = now()
    FROM visible WHERE alert.tenant_id = ${tenant.id}
      AND alert.booking_id = visible.booking_id AND alert.team_member_id = visible.team_member_id
      AND alert.read_at IS NULL
  `;
  revalidatePath("/app/notifications");
}

export async function saveArrivalAlertsSetting(form: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("Only workspace managers can change arrival alerts.");
  await requireFeature(tenant.id, "calendars");
  const db = tenantDb(tenant);
  await db`UPDATE tenant_settings SET provider_arrival_alerts_enabled = ${form.get("providerAlerts") === "on"}, updated_at = now()
    WHERE tenant_id = ${tenant.id}`;
  revalidatePath("/app/notifications");
  revalidatePath("/app/calendars");
}
