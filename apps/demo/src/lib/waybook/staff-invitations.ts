import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { controlDb, tenantDb, type TenantRecord } from "./database";

const roles = ["owner", "manager", "staff", "read-only"] as const;
type InviteRole = (typeof roles)[number];

export function isStaffInvitationToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function issueStaffInvitation(tenant: TenantRecord, ownerId: string, memberId: string) {
  const [staff] = await tenantDb(tenant)<{ email: string; name: string; role: InviteRole; identityId: string | null }[]>`
    SELECT lower(btrim(email)) AS email, name, role, identity_id AS "identityId" FROM team_members
    WHERE tenant_id = ${tenant.id} AND id = ${memberId} AND is_active AND archived_at IS NULL
  `;
  if (!staff?.email || !roles.includes(staff.role)) throw new Error("Only active staff with a work email can be invited.");
  if (staff.role === "owner" && staff.identityId !== ownerId) throw new Error("Owners can only link their own Google account.");

  const token = randomBytes(32).toString("base64url");
  await controlDb.begin(async (transaction) => {
    const tx = transaction as unknown as typeof controlDb;
    const [owner] = await tx<{ id: string }[]>`
      SELECT m.id FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = ${tenant.id} AND m.identity_id = ${ownerId} AND m.role = 'owner'
        AND t.lifecycle_status = 'active' FOR SHARE OF m, t
    `;
    if (!owner) throw new Error("Only an active workspace owner can issue an invitation.");
    const [ownerIdentity] = staff.role === "owner" ? await tx<{ email: string }[]>`
      SELECT lower(btrim(email)) AS email FROM identities WHERE id = ${ownerId}
    ` : [];
    const email = ownerIdentity?.email ?? staff.email;
    await tx`
      INSERT INTO identities (email, password_hash, display_name)
      SELECT ${email}, '', ${staff.name}
      WHERE NOT EXISTS (SELECT 1 FROM identities WHERE lower(email) = ${email})
      ON CONFLICT (email) DO NOTHING
    `;
    const identities = await tx<{ id: string; isPlatformAdmin: boolean }[]>`
      SELECT id, is_platform_admin AS "isPlatformAdmin" FROM identities
      WHERE lower(email) = ${email} LIMIT 2 FOR UPDATE
    `;
    const identity = identities[0];
    if (identities.length !== 1 || identity.isPlatformAdmin || (staff.identityId && staff.identityId !== identity.id)) {
      throw new Error("This work email cannot be used for this staff invitation.");
    }
    await tx`UPDATE waybook_staff_invitations SET revoked_at = now()
      WHERE tenant_id = ${tenant.id} AND team_member_id = ${memberId} AND claimed_at IS NULL AND revoked_at IS NULL`;
    const [invite] = await tx<{ id: string }[]>`
      INSERT INTO waybook_staff_invitations (tenant_id, team_member_id, identity_id, email, role, token_hash, invited_by, expires_at)
      VALUES (${tenant.id}, ${memberId}, ${identity.id}, ${email}, ${staff.role}, ${tokenHash(token)}, ${ownerId}, now() + interval '48 hours')
      RETURNING id
    `;
    await tx`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id)
      VALUES (${ownerId}, ${tenant.id}, 'staff.invitation.issued', 'staff_invitation', ${invite.id})`;
  });
  return token;
}

export async function revokeStaffInvitation(tenantId: string, ownerId: string, memberId: string) {
  await controlDb.begin(async (transaction) => {
    const tx = transaction as unknown as typeof controlDb;
    const [invite] = await tx<{ id: string }[]>`
      UPDATE waybook_staff_invitations SET revoked_at = now()
      WHERE tenant_id = ${tenantId} AND team_member_id = ${memberId} AND claimed_at IS NULL AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = ${tenantId} AND identity_id = ${ownerId} AND role = 'owner')
      RETURNING id
    `;
    if (invite) await tx`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id)
      VALUES (${ownerId}, ${tenantId}, 'staff.invitation.revoked', 'staff_invitation', ${invite.id})`;
  });
}

type Exchange = { subject: string; email: string };
type Acceptance = { identityId: string; tenantId?: string; tenantSlug?: string };
type Invitation = TenantRecord & {
  inviteId: string;
  identityId: string;
  teamMemberId: string;
  role: InviteRole;
  email: string;
  claimedAt: Date | null;
  hasPassword: boolean;
};

/** Consumes the short-lived OAuth session before granting application access. */
export async function redeemGoogleSession(sessionId: string, userId: string, token?: string): Promise<Acceptance | null> {
  return controlDb.begin(async (transaction) => {
    const tx = transaction as unknown as typeof controlDb;
    const [exchange] = await tx<Exchange[]>`
      WITH consumed AS (
        DELETE FROM waybook_oauth_sessions WHERE id = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > now()
        RETURNING "userId"
      )
      SELECT a."accountId" AS subject, lower(btrim(u.email)) AS email
      FROM consumed c JOIN waybook_oauth_users u ON u.id = c."userId"
      JOIN waybook_oauth_accounts a ON a."userId" = u.id AND a."providerId" = 'google'
      WHERE u."emailVerified" AND length(a."accountId") BETWEEN 1 AND 255
    `;
    if (!exchange) return null;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`waybook-google:${exchange.subject}`}, 0))`;
    const [linked] = await tx<{ identityId: string }[]>`
      SELECT g.identity_id AS "identityId" FROM waybook_google_identities g
      WHERE g.google_subject = ${exchange.subject}
    `;
    if (!token) {
      if (!linked) return null;
      const [active] = await tx<{ identityId: string }[]>`
        SELECT i.id AS "identityId" FROM identities i
        JOIN tenant_memberships m ON m.identity_id = i.id JOIN tenants t ON t.id = m.tenant_id
        WHERE i.id = ${linked.identityId} AND NOT i.is_platform_admin AND t.lifecycle_status = 'active' LIMIT 1
      `;
      return active ?? null;
    }
    if (!isStaffInvitationToken(token)) return null;

    const [invite] = await tx<Invitation[]>`
      SELECT v.id AS "inviteId", v.identity_id AS "identityId", v.team_member_id AS "teamMemberId",
        v.role, v.email, v.claimed_at AS "claimedAt", i.password_hash <> '' AS "hasPassword", t.id, t.slug, t.name, t.timezone,
        t.lifecycle_status AS "lifecycleStatus", t.database_env_key AS "databaseEnvKey"
      FROM waybook_staff_invitations v JOIN tenants t ON t.id = v.tenant_id
      JOIN identities i ON i.id = v.identity_id
      WHERE v.token_hash = ${tokenHash(token)} AND v.email = ${exchange.email}
        AND lower(btrim(i.email)) = v.email AND NOT i.is_platform_admin AND t.lifecycle_status = 'active'
        AND v.revoked_at IS NULL AND v.expires_at > now()
      FOR UPDATE OF v, i FOR SHARE OF t
    `;
    if (!invite || (linked && linked.identityId !== invite.identityId)) return null;
    const [otherGoogle] = await tx<{ subject: string }[]>`
      SELECT google_subject AS subject FROM waybook_google_identities WHERE identity_id = ${invite.identityId}
    `;
    if (otherGoogle && otherGoogle.subject !== exchange.subject) return null;

    const [membership] = await tx<{ role: string }[]>`
      SELECT role FROM tenant_memberships WHERE tenant_id = ${invite.id} AND identity_id = ${invite.identityId}
      FOR UPDATE
    `;
    if ((membership && membership.role !== invite.role) || (invite.role === "owner" && !membership)) return null;
    if (invite.claimedAt && (!linked || !membership)) return null;
    if (!membership && invite.hasPassword) {
      // A tenant-issued password must not gain access to a second workspace through this claim.
      const [other] = await tx`SELECT 1 FROM tenant_memberships WHERE identity_id = ${invite.identityId} AND tenant_id <> ${invite.id} LIMIT 1`;
      if (other) return null;
    }
    const [staff] = await tenantDb(invite)<{ id: string }[]>`
      UPDATE team_members m SET identity_id = ${invite.identityId}, updated_at = CASE WHEN m.identity_id IS NULL THEN now() ELSE m.updated_at END
      WHERE m.tenant_id = ${invite.id} AND m.id = ${invite.teamMemberId} AND m.is_active AND m.archived_at IS NULL
        AND m.role = ${invite.role}
        AND (lower(btrim(m.email)) = ${invite.email} OR (m.role = 'owner' AND m.identity_id = ${invite.identityId}))
        AND (m.identity_id IS NULL OR m.identity_id = ${invite.identityId})
        AND NOT EXISTS (SELECT 1 FROM team_members other
          WHERE other.tenant_id = m.tenant_id AND other.id <> m.id AND other.identity_id = ${invite.identityId})
      RETURNING id
    `;
    if (!staff) return null;
    if (!invite.claimedAt) {
      if (!linked) await tx`INSERT INTO waybook_google_identities (google_subject, identity_id) VALUES (${exchange.subject}, ${invite.identityId})`;
      if (!membership) await tx`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${invite.id}, ${invite.identityId}, ${invite.role})`;
      await tx`UPDATE waybook_staff_invitations SET claimed_at = now() WHERE id = ${invite.inviteId}`;
      await tx`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id, metadata)
        VALUES (${invite.identityId}, ${invite.id}, 'staff.invitation.claimed', 'staff_invitation', ${invite.inviteId},
          jsonb_build_object('role', ${invite.role}::text, 'teamMemberId', ${invite.teamMemberId}::text))`;
    }
    return { identityId: invite.identityId, tenantId: invite.id, tenantSlug: invite.slug };
  });
}
