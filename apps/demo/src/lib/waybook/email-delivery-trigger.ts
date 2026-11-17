import "server-only";
import { after } from "next/server";
import { tenantDb, type TenantRecord } from "./database";
import { deliverOneEmail } from "./email-delivery-worker";
import { configuredProviderKeyring } from "./provider-secret-config";
import { isFeatureEnabled } from "./features";

/** The outbox is durable; this is a best-effort prompt, never a substitute for retries. */
export function promptEmailDelivery(tenant: TenantRecord, outboxId: string | null | undefined): void {
  if (!outboxId || process.env.WAYBOOK_EMAIL_DELIVERY_ENABLED !== "true") return;
  const keyring = configuredProviderKeyring();
  if (!keyring) return;
  try {
    after(async () => {
      try {
        if (await isFeatureEnabled(tenant.id, "email-notifications")) {
          await deliverOneEmail(tenantDb(tenant), tenant.id, keyring.resolve, undefined, outboxId);
        }
      }
      catch { console.error("email_delivery_prompt_failed", { tenant: tenant.slug }); }
    });
  } catch {
    // A scheduling failure must not turn an already-committed booking into an error.
    console.error("email_delivery_schedule_failed", { tenant: tenant.slug });
  }
}
