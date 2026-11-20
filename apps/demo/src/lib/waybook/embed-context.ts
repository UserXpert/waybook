import { verifyEmbedSource } from "./embed-token";

type EmbedContextInput = {
  tenantId: string;
  source: string | null;
  token: string | null;
  allowedOrigins: string[];
};

type VerifyEmbedSource = (tenantId: string, source: string, token: string) => boolean;

export function validatedEmbedSource(input: EmbedContextInput, verify: VerifyEmbedSource = verifyEmbedSource): { source: string | null; error: string | null } {
  // A direct booking has neither field. Any partial embed context is invalid;
  // silently treating it as direct would lose the verified-source audit trail.
  if (input.source === null && input.token === null) return { source: null, error: null };
  if (!input.source || !input.token || !input.allowedOrigins.includes(input.source) || !verify(input.tenantId, input.source, input.token)) {
    return { source: null, error: "This embedded booking session has expired. Please reopen it from the website." };
  }
  return { source: input.source, error: null };
}
