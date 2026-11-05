import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicBookingFlow } from "@/components/public-booking-flow";
import { findTenantByHostname, tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";

export const dynamic = "force-dynamic";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number };
type TeamMember = { id: string; name: string; serviceId: string };

/** The tenant is resolved from the request hostname before any operational data is queried. */
export default async function PublicBookingPage() {
  const host = (await headers()).get("host") ?? "";
  const tenant = await findTenantByHostname(host);
  if (!tenant) notFound();
  if (!await isFeatureEnabled(tenant.id, "booking-essentials")) notFound();
  const db = tenantDb(tenant);
  const [settings, services, teamMembers] = await Promise.all([
    db<{ name: string; timezone: string }[]>`SELECT name, timezone FROM tenant_settings WHERE tenant_id = ${tenant.id} LIMIT 1`,
    db<Service[]>`SELECT id, title, description, duration_minutes AS "durationMinutes", price_cents AS "priceCents" FROM services WHERE tenant_id = ${tenant.id} AND is_active = true ORDER BY title`,
    db<TeamMember[]>`SELECT tm.id, tm.name, stm.service_id AS "serviceId" FROM team_members tm JOIN service_team_members stm ON stm.team_member_id = tm.id AND stm.tenant_id = tm.tenant_id WHERE tm.tenant_id = ${tenant.id} AND tm.is_active = true ORDER BY tm.name`,
  ]);
  if (!settings[0]) notFound();
  return <PublicBookingFlow tenantName={settings[0].name} timezone={settings[0].timezone} services={services} teamMembers={teamMembers} />;
}
