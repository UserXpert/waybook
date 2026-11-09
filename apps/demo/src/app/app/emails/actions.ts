"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";

export async function saveEmailTemplate(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "email-notifications");
  if (!(await staffPermissionContext(tenant, membership)).isManager) throw new Error("You do not have permission to manage email templates.");
  const key = String(formData.get("template") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!["booking", "confirmation", "cancellation", "sale"].includes(key) || !subject || subject.length > 200 || !body || body.length > 10000) throw new Error("Enter a subject and message within the length limits.");
  const db = tenantDb(tenant);
  await db.begin(async (tx) => {
    await tx.unsafe(`INSERT INTO email_templates (tenant_id,template_key,subject,body) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,template_key) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_at=now()`, [tenant.id,key,subject,body]);
    await tx.unsafe("INSERT INTO tenant_audit_events (tenant_id,action,target_type,target_id,metadata) VALUES ($1,'email_template.saved','email_template',$2,$3::jsonb)", [tenant.id,key,JSON.stringify({ template: key })]);
  });
  const path = tenantPath(await currentTenantRouteSlug(tenant.slug), "/app/emails");
  revalidatePath("/app/emails");
  redirect(`${path}?view=templates&template=${key}&saved=1`);
}
