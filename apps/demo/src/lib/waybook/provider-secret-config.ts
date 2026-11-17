import "server-only";
import type { ProviderSecretKey } from "./provider-secret";
import { providerKeyring } from "./provider-keyring";

/** Server configuration only; never return this key to the browser or logs. */
export function configuredProviderKey(): ProviderSecretKey | null {
  return configuredProviderKeyring()?.active ?? null;
}

export function configuredProviderKeyring() {
  return providerKeyring({ activeId: process.env.WAYBOOK_PROVIDER_KEY_ID, activeHex: process.env.WAYBOOK_PROVIDER_KEY_HEX, previousId: process.env.WAYBOOK_PROVIDER_PREVIOUS_KEY_ID, previousHex: process.env.WAYBOOK_PROVIDER_PREVIOUS_KEY_HEX });
}
