import "server-only";

import { tenantDb, type TenantRecord } from "./database";
import { issueStaffInvitation } from "./staff-invitations";

type RequestContact = { name: string; email: string; phone: string };
export type StaffAccessRequest = RequestContact & { id: string };
type InviteResult = { token: string } | { error: string };

export async function submitStaffAccessRequest(tenant: TenantRecord, contact: RequestContact) {
  const db = tenantDb(tenant);
  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"staff-access:" + tenant.id}, 0))`;
    const [existing] = await tx`
      SELECT 1 FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND email = ${contact.email} AND invited_at IS NULL
    `;
    if (existing) return true;
    const [recent] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM staff_access_requests
      WHERE tenant_id = ${tenant.id} AND created_at >= now() - interval '1 hour'
    `;
    if (recent.count >= 30) return false;
    await tx`
      INSERT INTO staff_access_requests (tenant_id, name, email, phone)
      VALUES (${tenant.id}, ${contact.name}, ${contact.email}, ${contact.phone})
      ON CONFLICT (tenant_id, email) WHERE invited_at IS NULL DO NOTHING
    `;
    return true;
  });
}

export async function pendingStaffAccessRequests(tenant: TenantRecord): Promise<StaffAccessRequest[]> {
  const db = tenantDb(tenant);
  // Older workspaces remain readable until the access request migration is applied.
  const [schema] = await db<{ available: boolean }[]>`SELECT to_regclass('public.staff_access_requests') IS NOT NULL AS available`;
  if (!schema.available) return [];
  return db<StaffAccessRequest[]>`
    SELECT id, name, email, phone FROM staff_access_requests
    WHERE tenant_id = ${tenant.id} AND invited_at IS NULL
    ORDER BY created_at, id LIMIT 50
  `;
}

export async function inviteFromStaffAccessRequest(tenant: TenantRecord, ownerId: string, requestId: string): Promise<InviteResult> {
  const db = tenantDb(tenant);
  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    const [request] = await tx<StaffAccessRequest[]>`
      SELECT id, name, email, phone FROM staff_access_requests
      WHERE tenant_id = ${tenant.id} AND id = ${requestId} AND invited_at IS NULL FOR UPDATE
    `;
    if (!request) return { error: "This request has already been handled or is unavailable." };

    await tx`
      INSERT INTO team_members (tenant_id, name, email, phone, role, is_active)
      SELECT ${tenant.id}, ${request.name}, ${request.email}, ${request.phone}, 'staff', true
      WHERE NOT EXISTS (
        SELECT 1 FROM team_members WHERE tenant_id = ${tenant.id} AND lower(btrim(email)) = ${request.email}
      )
      ON CONFLICT (tenant_id, email) DO NOTHING
    `;
    const members = await tx<{ id: string; eligible: boolean }[]>`
      SELECT id, role = 'staff' AND staff_role_id IS NULL AND is_active AND archived_at IS NULL
        AND identity_id IS NULL AS eligible
      FROM team_members WHERE tenant_id = ${tenant.id} AND lower(btrim(email)) = ${request.email}
      LIMIT 2
    `;
    const [member] = members;
    if (members.length !== 1 || !member.eligible) {
      return { error: "This email needs a profile review before an invitation can be created. Review it in Staff." };
    }

    const token = await issueStaffInvitation(tenant, ownerId, member.id, tx, "staff");
    await tx`UPDATE staff_access_requests SET invited_at = now() WHERE tenant_id = ${tenant.id} AND id = ${requestId}`;
    return { token };
  });
}
