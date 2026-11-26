"use server";

import { notFound, redirect } from "next/navigation";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { stripeSandboxConfig } from "@/lib/waybook/stripe-connect-api";
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
