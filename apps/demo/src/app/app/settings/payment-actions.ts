"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { stripeLiveConfig, stripeWorkspaceSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { liveMerchantStatus, liveOnboardingUrl } from "@/lib/waybook/stripe-live";
import { stripeAppointmentPaymentConfig } from "@/lib/waybook/stripe-payment-mode";
import { sandboxConnection, sandboxOnboardingUrl } from "@/lib/waybook/stripe-sandbox";
import { openSandboxRehearsal, rehearsalAmountCents, sandboxRehearsalPaid } from "@/lib/waybook/stripe-sandbox-rehearsal";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sandboxSettingsContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  const config = stripeWorkspaceSandboxConfig(process.env);
  if (membership.role !== "owner" || !config) notFound();
  const collection = stripeAppointmentPaymentConfig(process.env);
  if (collection?.livemode && collection.allowNewPayments && await liveMerchantStatus(tenant.id, collection) === "ready") notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  const settingsPath = tenantPath(slug, "/app/settings?tab=payments");
  const feedbackKey = process.env.VERCEL_ENV === "production" ? "sandbox" : "stripe";
  return { tenant, config, settingsPath, feedbackKey, salesPath: tenantPath(slug, "/app/sales/retail") } as const;
}

export async function startStripeSandboxOnboarding() {
  const { tenant, config, settingsPath, feedbackKey } = await sandboxSettingsContext();
  let destination: string;
  try {
    destination = await sandboxOnboardingUrl(tenant.id, config, settingsPath, feedbackKey);
  } catch {
    redirect(`${settingsPath}&${feedbackKey}=unavailable`);
  }
  redirect(destination);
}

export async function checkStripeSandboxStatus() {
  const { settingsPath, feedbackKey } = await sandboxSettingsContext();
  revalidatePath("/app/settings");
  redirect(`${settingsPath}&${feedbackKey}=checked`);
}

export async function startStripeSandboxRehearsal(formData: FormData) {
  const { tenant, config, settingsPath, salesPath } = await sandboxSettingsContext();
  const connection = await sandboxConnection(tenant.id);
  const nonce = formData.get("nonce");
  if (!connection?.accountId || typeof nonce !== "string" || !uuidPattern.test(nonce)) notFound();
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (tx) => {
    const [sale] = await tx.unsafe<{ id: string }[]>(`
      INSERT INTO commerce_sales (id, tenant_id, is_stripe_practice, opened_by_identity_id)
      VALUES ($1,$2,true,$3) ON CONFLICT (id) DO NOTHING RETURNING id
    `, [nonce, tenant.id, identity.id]);
    if (sale) await tx.unsafe(`
      INSERT INTO commerce_sale_lines (tenant_id, sale_id, line_kind, title_snapshot, unit_price_cents)
      VALUES ($1,$2,'custom','Stripe sandbox practice payment',$3)
    `, [tenant.id, nonce, rehearsalAmountCents]);
  });
  const [pending] = await db<{ sessionId: string | null }[]>`
    SELECT stripe_practice_session_id AS "sessionId" FROM commerce_sales
    WHERE id=${nonce} AND tenant_id=${tenant.id} AND is_stripe_practice
      AND stripe_practice_cleared_at IS NULL AND status='draft'
  `;
  if (!pending) redirect(`${salesPath}?sale=${nonce}`);
  let destination: string;
  try {
    const session = await openSandboxRehearsal(config, connection.accountId, salesPath, nonce);
    const [saved] = await db<{ id: string }[]>`
      UPDATE commerce_sales SET stripe_practice_session_id=${session.id}
      WHERE id=${nonce} AND tenant_id=${tenant.id} AND is_stripe_practice AND stripe_practice_cleared_at IS NULL
        AND (stripe_practice_session_id IS NULL OR stripe_practice_session_id=${session.id}) RETURNING id
    `;
    if (!saved) throw new Error("Stripe practice sale was cleared.");
    destination = session.url;
  } catch {
    redirect(`${settingsPath}&sandbox=payment-unavailable`);
  }
  redirect(destination);
}

export async function checkStripePracticePayment(formData: FormData) {
  const { tenant, config, salesPath } = await sandboxSettingsContext();
  const id = formData.get("saleId");
  if (typeof id !== "string" || !uuidPattern.test(id)) notFound();
  const connection = await sandboxConnection(tenant.id);
  const db = tenantDb(tenant);
  const [sale] = await db<{ sessionId: string | null; status: string }[]>`
    SELECT stripe_practice_session_id AS "sessionId", status FROM commerce_sales
    WHERE tenant_id=${tenant.id} AND id=${id} AND is_stripe_practice AND stripe_practice_cleared_at IS NULL
  `;
  const href = `${salesPath}?sale=${id}`;
  if (!sale || !connection?.accountId || !sale.sessionId) notFound();
  if (sale.status === "closed") redirect(href);
  const paid = await sandboxRehearsalPaid(config, connection.accountId, sale.sessionId, id).catch(() => null);
  if (paid !== true) redirect(`${href}&sandbox=${paid === null ? "payment-unavailable" : "payment-pending"}`);
  const identity = await requireIdentity();
  await db.begin(async (tx) => {
    const [pending] = await tx.unsafe<{ id: string }[]>(`
      SELECT id FROM commerce_sales WHERE id=$1 AND tenant_id=$2 AND is_stripe_practice
        AND stripe_practice_cleared_at IS NULL AND status='draft' AND stripe_practice_session_id=$3 FOR UPDATE
    `, [id, tenant.id, sale.sessionId]);
    if (!pending) return;
    await tx.unsafe(`INSERT INTO commerce_sale_transactions
      (tenant_id,sale_id,kind,method,amount_cents,processor_reference,recorded_by_identity_id)
      VALUES ($1,$2,'payment','card',$3,$4,$5)`, [tenant.id, id, rehearsalAmountCents, sale.sessionId, identity.id]);
    await tx.unsafe(`UPDATE commerce_sales SET status='closed',closed_at=now(),closed_by_identity_id=$1,updated_at=now()
      WHERE id=$2 AND tenant_id=$3`, [identity.id, id, tenant.id]);
  });
  redirect(href);
}

export async function clearStripePracticeSales(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner" || formData.get("confirmClear") !== "on") notFound();
  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  await db.begin(async (tx) => {
    const [{ count }] = await tx.unsafe<{ count: number }[]>(`
      WITH cleared AS (
        UPDATE commerce_sales SET stripe_practice_cleared_at=now()
        WHERE tenant_id=$1 AND is_stripe_practice AND stripe_practice_cleared_at IS NULL RETURNING id
      ) SELECT count(*)::int AS count FROM cleared
    `, [tenant.id]);
    if (!count) return;
    await tx.unsafe(`INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata)
      VALUES ($1,$2,'stripe_practice.cleared','workspace',$1::uuid::text,$3::jsonb)`, [tenant.id, identity.id, { count }]);
  });
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(tenantPath(slug, "/app/settings?tab=payments&sandbox=cleared"));
}

export async function startStripeLiveOnboarding(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  const config = stripeLiveConfig(process.env);
  if (membership.role !== "owner" || !config) notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  const settingsPath = tenantPath(slug, "/app/settings?tab=payments");
  const selectedCountry = formData.get("country");
  const country = typeof selectedCountry === "string" && selectedCountry ? selectedCountry : null;
  if (country && !config.allowedCountries.includes(country)) redirect(`${settingsPath}&stripe=country`);
  let destination: string;
  try {
    destination = await liveOnboardingUrl(tenant.id, config, settingsPath, country);
  } catch {
    redirect(`${settingsPath}&stripe=unavailable`);
  }
  redirect(destination);
}

export async function checkStripeLiveStatus() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner" || !stripeLiveConfig(process.env)) notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath("/app/settings");
  redirect(tenantPath(slug, "/app/settings?tab=payments&stripe=checked"));
}
