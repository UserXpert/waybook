import assert from "node:assert/strict";
import postgres from "postgres";
import { workspaceHostname, workspaceMembershipQuery } from "../apps/demo/src/lib/waybook/workspace-lookup-query.ts";

// Temporary tables only; reject remote connections before creating the fixture.
const url = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL to a local PostgreSQL database.");

async function main() {
  const db = postgres(url!, { max: 1, ssl: false });
  try {
    await db.begin(async (tx) => {
      await tx.unsafe("CREATE TEMP TABLE tenants (id text, slug text, name text, lifecycle_status text, database_env_key text, timezone text) ON COMMIT DROP");
      await tx.unsafe("CREATE TEMP TABLE tenant_domains (tenant_id text, hostname text) ON COMMIT DROP");
      await tx.unsafe("CREATE TEMP TABLE tenant_memberships (tenant_id text, identity_id text, role text) ON COMMIT DROP");
      await tx.unsafe("INSERT INTO tenants VALUES ('a','alpha','Alpha','active','A','UTC'),('b','beta','Beta','active','B','UTC'),('c','closed','Closed','suspended','C','UTC')");
      await tx.unsafe("INSERT INTO tenant_domains VALUES ('a','alpha.localhost'),('b','beta.localhost'),('c','closed.localhost')");
      await tx.unsafe("INSERT INTO tenant_memberships VALUES ('a','one','owner'),('b','two','staff'),('c','one','owner')");
      async function lookup(slug: string, identity: string) {
        const host = workspaceHostname(slug);
        return host ? (await tx.unsafe(workspaceMembershipQuery, [identity, host]))[0] ?? null : null;
      }
      const owner = await lookup(" Alpha ", "one");
      assert.equal(owner?.id, "a");
      assert.equal(owner?.membershipRole, "owner");
      assert.equal(owner?.databaseEnvKey, "A");
      assert.equal((await lookup("beta", "two"))?.membershipRole, "staff");
      for (const slug of ["beta", "closed", "unknown", "alpha.localhost", "alpha/../beta", "alpha' OR TRUE--"]) assert.equal(await lookup(slug, "one"), null);
      await tx.unsafe("DELETE FROM tenant_memberships WHERE tenant_id='a' AND identity_id='one'");
      assert.equal(await lookup("alpha", "one"), null, "removed membership must not retain access");
      console.log("Workspace membership, isolation, lifecycle, route validation and removal checks passed.");
    });
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
