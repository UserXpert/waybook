"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";

/** Creates or refreshes a client record only for an owner or manager in that tenant. */
export async function saveCustomer(formData: FormData) {
  const identity = await requireIdentity();
  const membership = await controlDb<{ tenantId: string; role: string }[]>`
    SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2
  `;
  if (membership.length !== 1 || !["owner", "manager"].includes(membership[0].role)) throw new Error("You do not have permission to manage clients.");
  const tenant = await findTenantById(membership[0].tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
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
