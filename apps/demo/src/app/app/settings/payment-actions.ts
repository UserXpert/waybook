"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { stripeLiveConfig, stripeWorkspaceSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { liveMerchantStatus, liveOnboardingUrl } from "@/lib/waybook/stripe-live";
import { stripeAppointmentPaymentConfig } from "@/lib/waybook/stripe-payment-mode";
import { sandboxConnection, sandboxOnboardingUrl } from "@/lib/waybook/stripe-sandbox";
import { openSandboxRehearsal } from "@/lib/waybook/stripe-sandbox-rehearsal";

async function sandboxSettingsContext() {
  const { tenant, membership } = await requireTenantWorkspace();
  const config = stripeWorkspaceSandboxConfig(process.env);
  if (membership.role !== "owner" || !config) notFound();
  const collection = stripeAppointmentPaymentConfig(process.env);
  if (collection?.livemode && collection.allowNewPayments && await liveMerchantStatus(tenant.id, collection) === "ready") notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  const settingsPath = tenantPath(slug, "/app/settings?tab=payments");
  const feedbackKey = process.env.VERCEL_ENV === "production" ? "sandbox" : "stripe";
  return { tenant, config, settingsPath, feedbackKey } as const;
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
  const { tenant, config, settingsPath } = await sandboxSettingsContext();
  const connection = await sandboxConnection(tenant.id);
  const nonce = formData.get("nonce");
  if (!connection?.accountId || typeof nonce !== "string") notFound();
  let destination: string;
  try {
    destination = await openSandboxRehearsal(config, connection.accountId, settingsPath, nonce);
  } catch {
    redirect(`${settingsPath}&sandbox=payment-unavailable`);
  }
  redirect(destination);
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
