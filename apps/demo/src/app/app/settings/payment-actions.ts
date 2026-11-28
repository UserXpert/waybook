"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { stripeLiveConfig, stripeSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { liveOnboardingUrl } from "@/lib/waybook/stripe-live";
import { sandboxOnboardingUrl } from "@/lib/waybook/stripe-sandbox";

export async function startStripeSandboxOnboarding() {
  const { tenant, membership } = await requireTenantWorkspace();
  const config = stripeSandboxConfig(process.env);
  if (membership.role !== "owner" || !config) notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  const settingsPath = tenantPath(slug, "/app/settings?tab=payments");
  let destination: string;
  try {
    destination = await sandboxOnboardingUrl(tenant.id, config, settingsPath);
  } catch {
    redirect(`${settingsPath}&stripe=unavailable`);
  }
  redirect(destination);
}

export async function checkStripeSandboxStatus() {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner" || !stripeSandboxConfig(process.env)) notFound();
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath("/app/settings");
  redirect(tenantPath(slug, "/app/settings?tab=payments&stripe=checked"));
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
