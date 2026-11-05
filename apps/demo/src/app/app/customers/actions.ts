"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";

/** Creates or refreshes a client record only for an owner or manager in that tenant. */
export async function saveCustomer(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  if (!["owner", "manager"].includes(membership.role)) throw new Error("You do not have permission to manage clients.");
  await requireFeature(tenant.id, "clients");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name || !email.includes("@")) throw new Error("Enter a customer name and valid email.");
  await tenantDb(tenant)`
    INSERT INTO customers (tenant_id, name, email, phone)
    VALUES (${tenant.id}, ${name}, ${email}, ${phone || null})
    ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
  `;
  revalidatePath("/app");
  revalidatePath("/app/customers");
}
