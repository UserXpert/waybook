"use server";

import { revalidatePath } from "next/cache";
import { tenantDb } from "@/lib/waybook/database";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { assertNoOperationalFreeText } from "@/lib/waybook/operations-only-fields";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";

/** Shared tenant-authorized client persistence used by the form action entry points. */
async function persistCustomer(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "clients");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageClients) throw new Error("You do not have permission to manage this directory.");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "").trim();
  assertNoOperationalFreeText(formData, "internalNotes", "tags");
  if (!name || !email.includes("@")) throw new Error("Enter a name and valid email.");
  const db = tenantDb(tenant);
  const [customer] = customerId
    ? await db<{ id: string }[]>`UPDATE customers SET name = ${name}, email = ${email}, phone = ${phone || null}, updated_at = now() WHERE id = ${customerId} AND tenant_id = ${tenant.id} RETURNING id`
    : await db<{ id: string }[]>`INSERT INTO customers (tenant_id, name, email, phone) VALUES (${tenant.id}, ${name}, ${email}, ${phone || null}) ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now() RETURNING id`;
  if (!customer) throw new Error("This record is unavailable.");
  await db`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, ${customerId ? "customer.updated" : "customer.created"}, 'customer', ${customer.id}, ${JSON.stringify({ fields: ["name", "email", "phone"] })}::text::jsonb)`;
  revalidatePath("/app");
  revalidatePath("/app/customers");
}

/** Creates or refreshes a client record only for an owner or manager in that tenant. */
export async function saveCustomer(formData: FormData) {
  await persistCustomer(formData);
}

export type CustomerFormState = { error: string | null; success: string | null };

export async function saveCustomerForm(_previousState: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  try {
    await persistCustomer(formData);
    return { error: null, success: "Contact details saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save this record.", success: null };
  }
}
