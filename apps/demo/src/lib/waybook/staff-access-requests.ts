import "server-only";

import { createHash } from "node:crypto";
import { controlDb, tenantDb, type TenantRecord } from "./database";
import { issueStaffInvitation, refreshStaffEmailInvitation, revokeStaffEmailInvitationForRequest, staffInvitationMayBeEmailed } from "./staff-invitations";
import { sendStaffInvitationEmail, staffRequestInvitationToken, type InvitationEmailSnapshot, type StaffInvitationEmailConfig } from "./staff-invitation-email";

type RequestContact = { name: string; email: string; phone: string };
export type StaffAccessRequest = RequestContact & { id: string };
export type OutstandingStaffAccessRequest = StaffAccessRequest & {
  status: "pending" | "invited" | "expired";
  sendNumber: number;
};
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

export async function outstandingStaffAccessRequests(tenant: TenantRecord): Promise<OutstandingStaffAccessRequest[]> {
  const db = tenantDb(tenant);
  // Older workspaces remain readable until the access request migration is applied.
  const [schema] = await db<{ available: boolean }[]>`SELECT to_regclass('public.staff_access_requests') IS NOT NULL AS available`;
  if (!schema.available) return [];
  const requests = await db<Array<StaffAccessRequest & { invited: boolean; legacyInvitation: boolean; sendNumber: number }>>`
    SELECT id, name, email, phone, invited_at IS NOT NULL AS invited,
      invited_at IS NOT NULL AND to_jsonb(r)->>'email_started_at' IS NULL AS "legacyInvitation",
      COALESCE((to_jsonb(r)->>'email_send_number')::integer, 0) AS "sendNumber"
    FROM staff_access_requests r WHERE tenant_id = ${tenant.id}
    ORDER BY created_at, id
  `;
  if (!requests.length) return [];
  const invitations = await controlDb<Array<{ requestId: string; claimed: boolean; expired: boolean }>>`
    SELECT email_request_id AS "requestId", claimed_at IS NOT NULL AS claimed, expires_at <= now() AS expired
    FROM waybook_staff_invitations WHERE tenant_id = ${tenant.id}
      AND email_request_id = ANY(${requests.map(({ id }) => id)}::uuid[])
  `;
  const statusById = new Map(invitations.map(invitation => [invitation.requestId, invitation]));
  const legacyEmails = requests.filter(request => request.legacyInvitation).map(({ email }) => email);
  const claimedLegacy = legacyEmails.length ? await controlDb<{ email: string }[]>`
    SELECT DISTINCT email FROM waybook_staff_invitations
    WHERE tenant_id = ${tenant.id} AND claimed_at IS NOT NULL AND email = ANY(${legacyEmails})
  ` : [];
  const claimedLegacyEmails = new Set(claimedLegacy.map(({ email }) => email));
  return requests.flatMap(({ invited, legacyInvitation, ...request }) => {
    const invitation = statusById.get(request.id);
    if (invitation?.claimed || (legacyInvitation && claimedLegacyEmails.has(request.email))) return [];
    return [{ ...request, status: invited ? invitation?.expired ? "expired" : "invited" : "pending" }];
  });
}

export async function inviteFromStaffAccessRequest(
  tenant: TenantRecord, ownerId: string, requestId: string, config: StaffInvitationEmailConfig,
  resendFrom?: number,
): Promise<InviteResult> {
  const db = tenantDb(tenant);
  const tokenFor = (sendNumber: number) => staffRequestInvitationToken(config.secret, tenant.id, requestId, sendNumber);
  const prepared = await db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    const [request] = await tx<Array<StaffAccessRequest & { prepared: boolean; invited: boolean; sendNumber: number; acceptedNumber: number | null }>>`
      SELECT id, name, email, phone, email_started_at IS NOT NULL AS prepared, invited_at IS NOT NULL AS invited,
        email_send_number AS "sendNumber", email_accepted_number AS "acceptedNumber"
      FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND id = ${requestId} FOR UPDATE
    `;
    if (!request) return { error: "This request has already been handled or is unavailable." };
    if (resendFrom !== undefined && !request.invited) return { error: "Grant access before resending an invitation." };
    if (request.prepared) {
      if (resendFrom === request.sendNumber && request.acceptedNumber === request.sendNumber) {
        const nextNumber = request.sendNumber + 1;
        const renewed = await refreshStaffEmailInvitation(tenant.id, ownerId, requestId, tokenFor(request.sendNumber), tokenFor(nextNumber));
        if (!renewed) return { error: "The invitation has already been claimed or is unavailable." };
        await tx`
          UPDATE staff_access_requests SET email_send_number = ${nextNumber}, email_started_at = now(),
            email_sender = ${config.sender}, email_origin = ${config.origin}, email_workspace_name = ${tenant.name}
          WHERE tenant_id = ${tenant.id} AND id = ${requestId}
        `;
      }
      return {};
    }

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

    await issueStaffInvitation(tenant, ownerId, member.id, tx, "staff", { id: requestId, token: tokenFor(request.sendNumber) });
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
      SELECT id, email, email_send_number AS "sendNumber", email_started_at AS "emailStartedAt", email_sender AS "emailSender",
        email_origin AS "emailOrigin", email_workspace_name AS "emailWorkspaceName", email_accepted_number = email_send_number AS sent
      FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND id = ${requestId}
        AND email_started_at IS NOT NULL FOR UPDATE
    `;
    if (!snapshot) return { error: "This invitation could not be prepared." };
    if (snapshot.sent) return { sent: true };
    const token = tokenFor(snapshot.sendNumber);
    if (!(await staffInvitationMayBeEmailed(tenant.id, requestId, token))) {
      return { error: "The prepared invitation is no longer available. Review the staff profile before retrying." };
    }

    const delivery = await sendStaffInvitationEmail(config.apiKey, snapshot, token);
    if (delivery.kind !== "accepted") {
      return { error: delivery.kind === "retry" ? "Email could not be confirmed. Retry to send the same invitation."
        : delivery.kind === "rejected" ? "The email provider rejected the invitation. Check the sender configuration and try again."
        : "The email delivery needs review before it can be retried." };
    }
    await tx`UPDATE staff_access_requests SET invited_at = now(), email_accepted_number = ${snapshot.sendNumber}
      WHERE tenant_id = ${tenant.id} AND id = ${requestId}`;
    return { sent: true };
  });
}

export async function deleteStaffAccessRequest(tenant: TenantRecord, ownerId: string, requestId: string) {
  const db = tenantDb(tenant);
  return db.begin(async (transaction) => {
    const tx = transaction as unknown as typeof db;
    const [request] = await tx`SELECT id FROM staff_access_requests
      WHERE tenant_id = ${tenant.id} AND id = ${requestId} FOR UPDATE`;
    if (!request) return true;
    if (!(await revokeStaffEmailInvitationForRequest(tenant.id, ownerId, requestId))) return false;
    await tx`DELETE FROM staff_access_requests WHERE tenant_id = ${tenant.id} AND id = ${requestId}`;
    return true;
  });
}
