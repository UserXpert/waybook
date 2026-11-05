import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, findTenantRouteSlug } from "@/lib/waybook/database";

export default async function Home() {
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const [membership] = await controlDb<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2`;
  const tenant = membership ? await findTenantById(membership.tenantId) : null;
  if (!tenant) redirect("/login");
  redirect(`/${await findTenantRouteSlug(tenant.id, tenant.slug)}/app`);
}
