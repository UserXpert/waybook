-- Better Auth manages Google OAuth and its short-lived exchange sessions.
-- Waybook identities, memberships, and application sessions remain authoritative.
CREATE TABLE waybook_oauth_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE waybook_oauth_sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES waybook_oauth_users(id) ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT
);
CREATE INDEX waybook_oauth_sessions_user_idx ON waybook_oauth_sessions ("userId");

CREATE TABLE waybook_oauth_accounts (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL CHECK ("providerId" = 'google'),
  "userId" TEXT NOT NULL REFERENCES waybook_oauth_users(id) ON DELETE CASCADE,
  "accessToken" TEXT CHECK ("accessToken" IS NULL),
  "refreshToken" TEXT CHECK ("refreshToken" IS NULL),
  "idToken" TEXT CHECK ("idToken" IS NULL),
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT CHECK (password IS NULL),
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  UNIQUE ("providerId", "accountId"),
  UNIQUE ("userId", "providerId")
);

CREATE TABLE waybook_oauth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX waybook_oauth_verifications_identifier_idx ON waybook_oauth_verifications (identifier);

CREATE TABLE waybook_google_identities (
  google_subject TEXT PRIMARY KEY CHECK (length(google_subject) BETWEEN 1 AND 255),
  identity_id UUID NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE waybook_staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL,
  identity_id UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email <> '' AND email = lower(btrim(email))),
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'read-only')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES identities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  CHECK (role <> 'owner' OR invited_by = identity_id),
  CHECK (expires_at > created_at),
  CHECK (claimed_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX waybook_staff_invitations_pending_idx
  ON waybook_staff_invitations (tenant_id, team_member_id)
  WHERE claimed_at IS NULL AND revoked_at IS NULL;
