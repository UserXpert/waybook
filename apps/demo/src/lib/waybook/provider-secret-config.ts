import "server-only";
import type { ProviderSecretKey } from "./provider-secret";

/** Server configuration only; never return this key to the browser or logs. */
export function configuredProviderKey(): ProviderSecretKey | null {
  const id = process.env.WAYBOOK_PROVIDER_KEY_ID ?? "";
  const hex = process.env.WAYBOOK_PROVIDER_KEY_HEX ?? "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[a-fA-F0-9]{64}$/.test(hex)) return null;
  return { id, key: Buffer.from(hex, "hex") };
}
