/** Drain in rounds so each business gets a turn before any gets another. */
export async function drainEmailQueues<T>(input: {
  tenants: T[];
  deadline: number;
  now?: () => number;
  perTenantLimit?: number;
  process: (tenant: T) => Promise<"processed" | "empty" | "not_configured" | "lost_claim">;
  completed: (tenant: T) => Promise<void>;
  failed: (tenant: T) => void;
}): Promise<{ processed: number; failures: number; incomplete: boolean }> {
  const now = input.now ?? Date.now;
  let remaining = input.tenants.map((tenant) => ({ tenant, count: 0 }));
  let processed = 0, failures = 0;
  while (remaining.length && now() < input.deadline) {
    const next: typeof remaining = [];
    for (let i = 0; i < remaining.length; i++) {
      if (now() >= input.deadline) return { processed, failures, incomplete: true };
      const item = remaining[i];
      try {
        const result = await input.process(item.tenant);
        if (item.count === 0) await input.completed(item.tenant);
        if (result === "processed") {
          processed++;
          item.count++;
          if (item.count < (input.perTenantLimit ?? 20)) next.push(item);
        }
      } catch {
        failures++;
        input.failed(item.tenant);
      }
    }
    remaining = next;
  }
  return { processed, failures, incomplete: remaining.length > 0 && now() >= input.deadline };
}
