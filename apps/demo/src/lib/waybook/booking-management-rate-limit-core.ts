import { createHash } from "node:crypto";

type Transaction = { unsafe: (query: string, parameters: string[]) => PromiseLike<unknown> };

/** One transaction protects both buckets. No email address is retained. */
export async function consumeManagementBuckets(transaction: Transaction, tenantId: string, bookingId: string): Promise<boolean> {
  const referenceHash = createHash("sha256").update(bookingId.toLowerCase()).digest("hex");
  const global = await transaction.unsafe(`
    INSERT INTO booking_management_rate_limits (tenant_id, bucket_key, window_start, attempts)
    VALUES ($1, 'global', now(), 1)
    ON CONFLICT (tenant_id, bucket_key) DO UPDATE SET
      window_start = CASE WHEN booking_management_rate_limits.window_start <= now() - interval '1 minute' THEN now() ELSE booking_management_rate_limits.window_start END,
      attempts = CASE WHEN booking_management_rate_limits.window_start <= now() - interval '1 minute' THEN 1 ELSE LEAST(booking_management_rate_limits.attempts + 1, 100000) END
    RETURNING attempts
  `, [tenantId]) as { attempts: number }[];
  if (!global[0] || global[0].attempts > 120) return false;
  const reference = await transaction.unsafe(`
    INSERT INTO booking_management_rate_limits (tenant_id, bucket_key, window_start, attempts)
    VALUES ($1, $2, now(), 1)
    ON CONFLICT (tenant_id, bucket_key) DO UPDATE SET
      window_start = CASE WHEN booking_management_rate_limits.window_start <= now() - interval '10 minutes' THEN now() ELSE booking_management_rate_limits.window_start END,
      attempts = CASE WHEN booking_management_rate_limits.window_start <= now() - interval '10 minutes' THEN 1 ELSE LEAST(booking_management_rate_limits.attempts + 1, 100000) END
    RETURNING attempts
  `, [tenantId, `reference:${referenceHash}`]) as { attempts: number }[];
  if (global[0].attempts === 1) await transaction.unsafe("DELETE FROM booking_management_rate_limits WHERE tenant_id=$1 AND bucket_key <> 'global' AND window_start < now() - interval '20 minutes'", [tenantId]);
  return Boolean(reference[0] && reference[0].attempts <= 20);
}
