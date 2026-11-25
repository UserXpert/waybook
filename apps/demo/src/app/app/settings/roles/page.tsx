import { notFound, redirect } from "next/navigation";
import { requirePageFeature } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

export default async function LegacyStaffRolesPage({ searchParams }: { searchParams: Promise<{ role?: string; new?: string }> }) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") notFound();
  await requirePageFeature(tenant.id, "team");
  const [params, slug] = await Promise.all([searchParams, currentTenantRouteSlug(tenant.slug)]);
  const query = new URLSearchParams({ tab: "roles" });
  if (typeof params.role === "string") query.set("role", params.role);
  if (params.new === "1") query.set("new", "1");
  redirect(tenantPath(slug, `/app/settings?${query}`));
}
