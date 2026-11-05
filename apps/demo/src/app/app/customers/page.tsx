import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { logout } from "../../actions";
import { saveCustomer } from "./actions";

type CustomerRow = { id: string; name: string; email: string; phone: string | null; createdAt: Date; bookingCount: number };

export default async function CustomersPage() {
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const memberships = await controlDb<{ tenantId: string; role: string }[]>`SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2`;
  if (memberships.length !== 1) throw new Error("This local identity must have exactly one tenant membership.");
  const tenant = await findTenantById(memberships[0].tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  if (!await isFeatureEnabled(tenant.id, "clients")) redirect("/app");
  const customers = await tenantDb(tenant)<CustomerRow[]>`
    SELECT c.id, c.name, c.email, c.phone, c.created_at AS "createdAt", count(b.id)::int AS "bookingCount"
    FROM customers c LEFT JOIN bookings b ON b.customer_id = c.id AND b.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenant.id}
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100
  `;
  const canManage = ["owner", "manager"].includes(memberships[0].role);
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantName={tenant.name} active="clients" /><header><div><p>CLIENTS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{memberships[0].role} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header>{canManage ? <section className="waybook-data-card"><h2>Add or update a client</h2><form action={saveCustomer} className="waybook-customer-form"><label>Name<input name="name" required /></label><label>Email<input name="email" type="email" required /></label><label>Phone<input name="phone" type="tel" /></label><button type="submit">Save client</button></form></section> : <p className="waybook-permission-note">Read-only access: client records cannot be changed with your role.</p>}<section className="waybook-data-card"><h2>Clients</h2><p>{customers.length} persisted customer{customers.length === 1 ? "" : "s"}. Confirmed public bookings appear here automatically.</p><div className="waybook-table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Bookings</th><th>Added</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td>{customer.name}</td><td><a href={`mailto:${customer.email}`}>{customer.email}</a>{customer.phone ? <small>{customer.phone}</small> : null}</td><td>{customer.bookingCount}</td><td>{customer.createdAt.toLocaleDateString("en-GB", { timeZone: tenant.timezone })}</td></tr>)}{customers.length === 0 ? <tr><td colSpan={4}>No clients yet.</td></tr> : null}</tbody></table></div></section></main>;
}
