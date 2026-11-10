/** The caller must persist the exact message and first-attempt time before sending. */
export type ResendMessage = { from: string; to: string; subject: string; text: string };
export type ResendResult =
  | { kind: "accepted"; providerId: string }
  | { kind: "retry"; retryAfterSeconds?: number }
  | { kind: "rejected" }
  | { kind: "review" };

// Resend retains idempotency keys for 24 hours. Stop before that boundary so
// a delayed worker cannot silently send a duplicate after an uncertain result.
const retryWindowMs = 23 * 60 * 60 * 1000;

export async function sendWithResend(input: {
  apiKey: string;
  idempotencyKey: string;
  firstAttemptAt: Date;
  message: ResendMessage;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<ResendResult> {
  const age = (input.now ?? new Date()).getTime() - input.firstAttemptAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age >= retryWindowMs) return { kind: "review" };
  if (!input.apiKey.trim() || /[\r\n]/.test(input.apiKey) || !input.idempotencyKey || input.idempotencyKey.length > 256 || /[\r\n]/.test(input.idempotencyKey)) return { kind: "rejected" };
  const { from, to, subject, text } = input.message;
  if (!from.trim() || !to.trim() || !subject.trim() || !text.trim() || /[\r\n]/.test(from + to + subject)) return { kind: "rejected" };
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // A timeout or network error does not prove the provider did not accept it.
    return { kind: "retry" };
  }
  const result: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const id = result && typeof result === "object" && "id" in result ? result.id : null;
    return typeof id === "string" && id.length > 0 ? { kind: "accepted", providerId: id } : { kind: "review" };
  }
  if (response.status === 409) {
    const name = result && typeof result === "object" && "name" in result ? result.name : null;
    return name === "concurrent_idempotent_requests" ? { kind: "retry" } : { kind: "review" };
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    return seconds !== undefined && Number.isSafeInteger(seconds) ? { kind: "retry", retryAfterSeconds: Math.min(seconds, 3600) } : { kind: "retry" };
  }
  return { kind: "rejected" };
}
