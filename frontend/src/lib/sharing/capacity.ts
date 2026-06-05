// Infrastructure capacity / cost planning for the operator dashboard (/admin).
//
// Pulls a real usage figure from each paid-but-free-tier service ResearchOS runs
// on, so Grant can see how much headroom is left before a service needs an
// upgrade, and which one. Three storage services plus email:
//
//   - Neon Postgres  (the directory + relay tables)      -> pg_database_size
//   - Cloudflare R2  (the encrypted relay bundles)        -> ListObjectsV2 sum
//   - Upstash Redis  (rate-limit windows + OTP codes)     -> DBSIZE (key count)
//   - Resend         (OTP + share-invite emails)          -> our own send log
//
// Every measurement is wrapped so one failing service degrades to "unavailable"
// on the dashboard rather than 500-ing the whole page. No per-user data: byte
// totals, object/key counts, and email volume only.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { FREE_TIER } from "@/lib/sharing/capacity-shared";
import {
  getDatabaseSizeBytes,
  getEmailMetrics,
  type EmailMetrics,
} from "@/lib/sharing/directory/db";
import { getRedisKeyCount } from "@/lib/sharing/directory/ratelimit";
import { getBucketUsage } from "@/lib/sharing/relay/storage";

export { FREE_TIER };

export interface CapacityMetrics {
  neon: { usedBytes: number | null; limitBytes: number };
  r2: { usedBytes: number | null; objectCount: number | null; limitBytes: number };
  upstash: {
    keyCount: number | null;
    storageLimitBytes: number;
    commandsPerMonthLimit: number;
  };
  resend: {
    sentToday: number | null;
    sentLast30Days: number | null;
    byKind: EmailMetrics["byKind"];
    perDayLimit: number;
    perMonthLimit: number;
  };
}

/**
 * Measures all four services concurrently. Each measurement falls back to null
 * on any error (missing credential, provider hiccup) so the dashboard can render
 * "unavailable" for that one service instead of failing the whole request.
 */
export async function getCapacityMetrics(): Promise<CapacityMetrics> {
  const [neonBytes, r2, redisKeys, email] = await Promise.all([
    getDatabaseSizeBytes().catch(() => null),
    getBucketUsage().catch(() => null),
    getRedisKeyCount().catch(() => null),
    getEmailMetrics().catch(() => null),
  ]);

  return {
    neon: {
      usedBytes: neonBytes,
      limitBytes: FREE_TIER.neonStorageBytes,
    },
    r2: {
      usedBytes: r2 ? r2.totalBytes : null,
      objectCount: r2 ? r2.objectCount : null,
      limitBytes: FREE_TIER.r2StorageBytes,
    },
    upstash: {
      keyCount: redisKeys,
      storageLimitBytes: FREE_TIER.upstashStorageBytes,
      commandsPerMonthLimit: FREE_TIER.upstashCommandsPerMonth,
    },
    resend: {
      sentToday: email ? email.sentToday : null,
      sentLast30Days: email ? email.sentLast30Days : null,
      byKind: email ? email.byKind : [],
      perDayLimit: FREE_TIER.resendPerDay,
      perMonthLimit: FREE_TIER.resendPerMonth,
    },
  };
}
