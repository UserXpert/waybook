/** Errors that booking routes can safely translate to a slot-conflict response. */
export class BookingConflictError extends Error {
  readonly code = "BOOKING_CONFLICT";
  constructor() {
    super("This time slot is no longer available. Please choose a different time.");
    this.name = "BookingConflictError";
  }
}

export class SerializationRetryExhaustedError extends Error {
  readonly code = "SERIALIZATION_RETRY_EXHAUSTED";
  constructor(retries: number) {
    super(`Transaction failed after ${retries} retries due to concurrent access. Please try again.`);
    this.name = "SerializationRetryExhaustedError";
  }
}

type RetryOptions = { maxRetries?: number; baseDelayMs?: number };

/** Find a SQLSTATE in an error chain without looping on cyclic causes. */
function sqlState(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth <= 8 && typeof current === "object" && current !== null; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const entry = current as { code?: unknown; cause?: unknown };
    if (typeof entry.code === "string" && /^[0-9A-Z]{5}$/.test(entry.code)) return entry.code;
    current = entry.cause;
  }
  return undefined;
}

/** Retry only transactions that PostgreSQL has aborted for contention. */
export async function withSerializableRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.maxRetries ?? 3;
  const delayMs = options.baseDelayMs ?? 50;
  if (!Number.isInteger(retries) || retries < 0 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("Retry options must be non-negative and retries must be an integer.");
  }
  for (let attempts = 0; ; attempts++) {
    try {
      return await operation();
    } catch (error) {
      const state = sqlState(error);
      if (state === "23P01") throw new BookingConflictError();
      if (state !== "40001" && state !== "40P01") throw error;
      if (attempts >= retries) throw new SerializationRetryExhaustedError(retries);
      const base = delayMs * 2 ** attempts;
      await new Promise<void>((resolve) => setTimeout(resolve, base + Math.random() * base));
    }
  }
}
