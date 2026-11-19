"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { configuredProviderKey, configuredProviderKeyring } from "@/lib/waybook/provider-secret-config";
import { disconnectEmailConnection, replaceEmailConnection } from "@/lib/waybook/email-provider-connection";
import { requireIdentity } from "@/lib/waybook/auth";
import { confirmEmailProviderTest, sendEmailProviderTest } from "@/lib/waybook/email-provider-verification";
import { queueRejectedEmail } from "@/lib/waybook/email-retry";
import { promptEmailDelivery } from "@/lib/waybook/email-delivery-trigger";
import { emailTemplateError } from "@/lib/waybook/email-template-render";
import { configuredResendOnboardingTest, sendResendOnboardingTest } from "@/lib/waybook/resend-onboarding-test";
import { canManageEmailProvider } from "@/lib/waybook/email-provider-access";
import { emailTemplates } from "@/lib/waybook/email-templates";
import { renderBookingEmail } from "@/lib/waybook/email-template-render";

export async function saveEmailTemplate(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "email-notifications");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to manage email templates.");
  const key = String(formData.get("template") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!["booking", "confirmation", "cancellation", "sale", "reminder"].includes(key) || emailTemplateError(subject, body)) throw new Error("Enter a valid template with supported placeholders.");
  const db = tenantDb(tenant);
  await db.begin(async (tx) => {
    await tx.unsafe(`INSERT INTO email_templates (tenant_id,template_key,subject,body) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,template_key) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_at=now()`, [tenant.id,key,subject,body]);
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES ($1,'email_template.saved','email_template',$2,$3::jsonb)", [tenant.id,key,JSON.stringify({ template: key })]);
  });
  const path = tenantPath(await currentTenantRouteSlug(tenant.slug), "/app/emails");
  revalidatePath("/app/emails");
  redirect(`${path}?view=templates&template=${key}&saved=1`);
}

export async function saveReminderSettings(formData: FormData) {
  const { tenant, path } = await providerContext();
  const leadHours = Number(formData.get("leadHours"));
  if (!Number.isInteger(leadHours) || leadHours < 1 || leadHours > 168) throw new Error("Choose between 1 and 168 hours.");
  await tenantDb(tenant)`INSERT INTO email_reminder_settings (tenant_id,enabled,lead_hours) VALUES (${tenant.id},${formData.get("enabled") === "on"},${leadHours}) ON CONFLICT (tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled,lead_hours=EXCLUDED.lead_hours,updated_at=now()`;
  revalidatePath("/app/emails");
  redirect(`${path}?view=reminders&saved=1`);
}

async function providerContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "email-notifications");
  if (!canManageEmailProvider(await staffPermissionContext(tenant, membership))) throw new Error("You do not have permission to manage email settings.");
  const identity = await requireIdentity();
  const path = tenantPath(await currentTenantRouteSlug(tenant.slug), "/app/emails");
  return { tenant, identity, path };
}

export async function retryRejectedEmail(formData: FormData) {
  const { tenant, path } = await providerContext();
  const id = String(formData.get("emailId") ?? "");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid email.");
  const newId = await queueRejectedEmail(tenantDb(tenant), tenant.id, id);
  if (newId) promptEmailDelivery(tenant, newId);
  revalidatePath("/app/emails");
  redirect(newId ? `${path}?email=${newId}` : `${path}?email=${id}`);
}

export async function saveEmailProvider(formData: FormData) {
  const { tenant, identity, path } = await providerContext();
  const key = configuredProviderKey();
  if (!key) redirect(`${path}?view=connection&providerError=config`);
  const sender = String(formData.get("senderEmail") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender) || sender.length > 254 || !apiKey || /[\r\n]/.test(apiKey) || Buffer.byteLength(apiKey, "utf8") > 4096) redirect(`${path}?view=connection&providerError=invalid`);
  try {
    await replaceEmailConnection(tenantDb(tenant), tenant.id, sender, apiKey, key, identity.id);
  } catch {
    redirect(`${path}?view=connection&providerError=save`);
  }
  revalidatePath("/app/emails");
  redirect(`${path}?view=connection&providerSaved=1`);
}

export async function removeEmailProvider() {
  const { tenant, identity, path } = await providerContext();
  await disconnectEmailConnection(tenantDb(tenant), tenant.id, identity.id);
  revalidatePath("/app/emails");
  redirect(`${path}?view=connection&providerRemoved=1`);
}

export async function sendProviderTest() {
  const { tenant, path } = await providerContext();
  const keyring = configuredProviderKeyring();
  if (!keyring) redirect(`${path}?view=connection&providerError=config`);
  let result: Awaited<ReturnType<typeof sendEmailProviderTest>>;
  try {
    result = await sendEmailProviderTest(tenantDb(tenant), tenant.id, keyring.resolve);
  } catch {
    redirect(`${path}?view=connection&providerError=test`);
  }
  revalidatePath("/app/emails");
  if (result === "accepted") redirect(`${path}?view=connection&testSent=1`);
  redirect(`${path}?view=connection&providerError=${result}`);
}

/** A deployment-gated QA check. It is intentionally independent of provider verification and the email queue. */
export async function sendOnboardingProviderTest() {
  const { tenant, identity, path } = await providerContext();
  const config = configuredResendOnboardingTest();
  if (!config) redirect(`${path}?view=connection&providerError=config`);
  const db = tenantDb(tenant);
  const [savedTemplate] = await db.unsafe<Array<{ subject: string; body: string }>>("SELECT subject,body FROM email_templates WHERE tenant_id=$1 AND template_key='confirmation'", [tenant.id]);
  const fallback = emailTemplates.find((template) => template.key === "confirmation")!;
  let message: { subject: string; text: string };
  try {
    message = renderBookingEmail(savedTemplate?.subject ?? fallback.subject, savedTemplate?.body ?? fallback.body, {
      customer_name: "QA recipient",
      business_name: tenant.name,
      service_name: "Example service",
      appointment_date: "Friday, 1 January 2038 at 09:00",
      booking_number: "QA-TEST-0001",
    });
  } catch {
    redirect(`${path}?view=connection&providerError=test`);
  }
  const result = await sendResendOnboardingTest({ tenantId: tenant.id, config, message });
  if (result.kind !== "accepted") redirect(`${path}?view=connection&providerError=${result.kind}`);
  await db.unsafe("INSERT INTO tenant_audit_events (tenant_id,actor_identity_id,action,target_type,target_id,metadata) VALUES ($1,$2,'email_provider.onboarding_test_sent','tenant',$3,$4::text::jsonb)", [tenant.id, identity.id, tenant.id, JSON.stringify({ provider: "resend", mode: "onboarding_confirmation_format_test" })]);
  revalidatePath("/app/emails");
  redirect(`${path}?view=connection&onboardingTestSent=1`);
}

export async function confirmProviderTest() {
  const { tenant, identity, path } = await providerContext();
  const confirmed = await confirmEmailProviderTest(tenantDb(tenant), tenant.id, identity.id);
  revalidatePath("/app/emails");
  redirect(`${path}?view=connection&${confirmed ? "providerVerified=1" : "providerError=confirm"}`);
}
