// Pure capacity helpers + free-tier ceilings, with NO server imports.
//
// Split out from capacity.ts (which pulls in neon / aws-sdk / upstash) so the
// /admin client component and the unit tests can import the limit constants and
// the percentage math without dragging server-only modules into the browser
// bundle. capacity.ts re-uses everything here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/**
 * Free-tier ceilings as published on each provider's pricing page on
 * 2026-06-05. These are the limits you hit before a plan upgrade is needed.
 * They change, and your actual plan may differ, so the dashboard labels them
 * "free-tier ceiling, verify your plan". Update these in one place when a plan
 * or a provider's free tier changes.
 */
export const FREE_TIER = {
  neonStorageBytes: 0.5 * GB, // Neon Free plan: 0.5 GB storage
  r2StorageBytes: 10 * GB, // Cloudflare R2 free: 10 GB-month storage
  upstashStorageBytes: 256 * MB, // Upstash Redis free: 256 MB
  upstashCommandsPerMonth: 500_000, // Upstash Redis free: 500K commands/month
  resendPerDay: 100, // Resend free: 100 emails/day
  resendPerMonth: 3000, // Resend free: 3,000 emails/month
} as const;

export type CapacityStatus = "ok" | "watch" | "critical";

/**
 * Percentage of a ceiling used, clamped to 0..100. A non-positive limit reads as
 * 0 percent so a misconfigured limit never shows a divide-by-zero or a bar wider
 * than full.
 */
export function pctUsed(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

/**
 * Traffic-light status for a usage percentage. Under 70 is fine, 70 to 90 is
 * worth watching, 90 and over is close enough that an upgrade should be planned.
 */
export function capacityStatus(pct: number): CapacityStatus {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "watch";
  return "ok";
}

/**
 * Published storage unit prices (USD per GB-month), June 2026. Used to turn the
 * measured usage into a rough monthly cost estimate for the business tracker.
 * Storage only, these deliberately ignore compute and bandwidth, which the
 * dashboard does not measure. Verify against the provider's current pricing.
 */
export const STORAGE_PRICE_USD_PER_GB_MONTH = {
  neon: 0.35,
  r2: 0.015,
} as const;

export interface InfraCostEstimate {
  neonCents: number;
  r2Cents: number;
  totalCents: number;
}

/**
 * A rough monthly storage cost from the measured byte totals. A null usage
 * figure contributes zero (the service was unavailable), so the estimate never
 * throws. Storage only, see STORAGE_PRICE_USD_PER_GB_MONTH.
 */
export function estimateMonthlyInfraCostCents(
  neonBytes: number | null,
  r2Bytes: number | null,
): InfraCostEstimate {
  const GB = 1024 ** 3;
  const neonCents =
    neonBytes == null
      ? 0
      : Math.round((neonBytes / GB) * STORAGE_PRICE_USD_PER_GB_MONTH.neon * 100);
  const r2Cents =
    r2Bytes == null
      ? 0
      : Math.round((r2Bytes / GB) * STORAGE_PRICE_USD_PER_GB_MONTH.r2 * 100);
  return { neonCents, r2Cents, totalCents: neonCents + r2Cents };
}
