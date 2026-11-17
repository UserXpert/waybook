import postgres from "postgres";
import { providerKeyring } from "../apps/demo/src/lib/waybook/provider-keyring";
import { rotateTenantProviderKeys } from "../apps/demo/src/lib/waybook/provider-key-rotation";

const databaseUrl = process.env.WAYBOOK_ROTATION_DATABASE_URL;
const tenantId = process.env.WAYBOOK_ROTATION_TENANT_ID;
const ring = providerKeyring({ activeId: process.env.WAYBOOK_PROVIDER_KEY_ID, activeHex: process.env.WAYBOOK_PROVIDER_KEY_HEX, previousId: process.env.WAYBOOK_PROVIDER_PREVIOUS_KEY_ID, previousHex: process.env.WAYBOOK_PROVIDER_PREVIOUS_KEY_HEX });
if (!databaseUrl || !tenantId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tenantId) || !ring || process.env.WAYBOOK_ROTATION_CONFIRM !== "rotate") {
  throw new Error("Explicit database, tenant, valid key configuration and WAYBOOK_ROTATION_CONFIRM=rotate are required.");
}
const db = postgres(databaseUrl, { max: 1 });
try {
  const count = await rotateTenantProviderKeys(db, tenantId, ring.active, ring.resolve);
  console.log(`Re-encrypted ${count} provider connection(s).`);
} catch {
  console.error("Provider key rotation failed; no changes were committed.");
  process.exitCode = 1;
} finally {
  await db.end();
}
