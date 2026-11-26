import "server-only";

import { createHash } from "node:crypto";
import { tenantDb, type TenantRecord } from "./database";
import { issueStaffInvitation, staffInvitationMayBeEmailed } from "./staff-invitations";
import { sendStaffInvitationEmail, staffRequestInvitationToken, type InvitationEmailSnapshot, type StaffInvitationEmailConfig } from "./staff-invitation-email";

type RequestContact = { name: string; email: string; phone: string };
export type StaffAccessRequest = RequestContact & { id: string };
type InviteResult = { sent: true } | { error: string };

export async function submitStaffAccessRequest(tenant: TenantRecord, contact: RequestContact, receipt: string) {
  const db = tenantDb(tenant);
  const receiptHash = createHash("sha256").update(receipt).digest("hex");
  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"staff-access:" + tenant.id}, 0))`;
    const [existing] = await tx<{ emailed: boolean; hasReceipt: boolean | null }[]>`
      SELECT invited_at IS NOT NULL AND email_started_at IS NOT NULL AS emailed, receipt_hash = ${receiptHash} AS "hasReceipt"
      FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND email = ${contact.email}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    if (existing) return existing.emailed && existing.hasReceipt ? "emailed" : "received";
    const [recent] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM staff_access_requests
      WHERE tenant_id = ${tenant.id} AND created_at >= now() - interval '1 hour'
    `;
    if (recent.count >= 30) return "limited";
    await tx`
      INSERT INTO staff_access_requests (tenant_id, name, email, phone, receipt_hash)
      VALUES (${tenant.id}, ${contact.name}, ${contact.email}, ${contact.phone}, ${receiptHash})
      ON CONFLICT (tenant_id, email) WHERE invited_at IS NULL DO NOTHING
    `;
    return "received";
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

export async function inviteFromStaffAccessRequest(
  tenant: TenantRecord, ownerId: string, requestId: string, config: StaffInvitationEmailConfig,
): Promise<InviteResult> {
  const db = tenantDb(tenant);
  const token = staffRequestInvitationToken(config.secret, tenant.id, requestId);
  const prepared = await db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    const [request] = await tx<Array<StaffAccessRequest & { prepared: boolean }>>`
      SELECT id, name, email, phone, email_started_at IS NOT NULL AS prepared FROM staff_access_requests
      WHERE tenant_id = ${tenant.id} AND id = ${requestId} AND invited_at IS NULL FOR UPDATE
    `;
    if (!request) return { error: "This request has already been handled or is unavailable." };
    if (request.prepared) return {};

    await tx`
      INSERT INTO team_members (id, tenant_id, name, email, phone, role, is_active)
      SELECT ${request.id}, ${tenant.id}, ${request.name}, ${request.email}, ${request.phone}, 'staff', true
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

    await issueStaffInvitation(tenant, ownerId, member.id, tx, "staff", { id: requestId, token });
    await tx`
      UPDATE staff_access_requests SET email_started_at = now(), email_sender = ${config.sender},
        email_origin = ${config.origin}, email_workspace_name = ${tenant.name}
      WHERE tenant_id = ${tenant.id} AND id = ${requestId}
    `;
    return {};
  });
  if (prepared.error) return { error: prepared.error };

  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    const [snapshot] = await tx<Array<InvitationEmailSnapshot & { sent: boolean }>>`
      SELECT id, email, email_started_at AS "emailStartedAt", email_sender AS "emailSender",
        email_origin AS "emailOrigin", email_workspace_name AS "emailWorkspaceName", invited_at IS NOT NULL AS sent
      FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND id = ${requestId}
        AND email_started_at IS NOT NULL FOR UPDATE
    `;
    if (!snapshot) return { error: "This invitation could not be prepared." };
    if (snapshot.sent) return { sent: true };
    if (!(await staffInvitationMayBeEmailed(tenant.id, requestId, token))) {
      return { error: "The prepared invitation is no longer available. Review the staff profile before retrying." };
    }

    const delivery = await sendStaffInvitationEmail(config.apiKey, snapshot, token);
    if (delivery.kind !== "accepted") {
      return { error: delivery.kind === "retry" ? "Email could not be confirmed. Retry to send the same invitation."
        : delivery.kind === "rejected" ? "The email provider rejected the invitation. Check the sender configuration and try again."
        : "The email delivery needs review before it can be retried." };
    }
    await tx`UPDATE staff_access_requests SET invited_at = now() WHERE tenant_id = ${tenant.id} AND id = ${requestId}`;
    return { sent: true };
  });
}
