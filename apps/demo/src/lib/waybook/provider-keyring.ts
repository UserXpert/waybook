import type { ProviderSecretKey } from "./provider-secret";

type KeyConfig = { activeId?: string; activeHex?: string; previousId?: string; previousHex?: string };
const validId = /^[a-zA-Z0-9_-]{1,64}$/;
const validHex = /^[a-fA-F0-9]{64}$/;

/** A previous key is retained only for decryption during rotation. */
export function providerKeyring(config: KeyConfig): { active: ProviderSecretKey; resolve: (id: string) => Buffer | undefined } | null {
  const { activeId = "", activeHex = "", previousId = "", previousHex = "" } = config;
  if (!validId.test(activeId) || !validHex.test(activeHex)) return null;
  if ((previousId || previousHex) && (!validId.test(previousId) || !validHex.test(previousHex) || previousId === activeId)) return null;
  const active = { id: activeId, key: Buffer.from(activeHex, "hex") };
  const previous = previousId ? { id: previousId, key: Buffer.from(previousHex, "hex") } : null;
  return { active, resolve: (id) => id === active.id ? active.key : id === previous?.id ? previous.key : undefined };
}
