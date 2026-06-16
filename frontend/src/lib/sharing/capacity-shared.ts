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
 * Published storage unit prices (USD per GB-month), checked 2026-06-07. Used to
 * turn measured usage into a rough monthly cost estimate for the business
 * tracker. Storage only, these deliberately ignore compute and bandwidth, which
 * the dashboard does not measure. Verify against the provider's current pricing.
 *
 * The collab doc store (the metered durable content) is migrating off Neon onto
 * Cloudflare Durable Objects SQLite, so `do` is the binding rate now. `neon` is
 * kept only for the transition.
 */
export const STORAGE_PRICE_USD_PER_GB_MONTH = {
  neon: 0.35, // legacy, being retired
  do: 0.2, // Cloudflare Durable Objects SQLite (collab docs)
  r2: 0.015, // Cloudflare R2 (relay bundles + future file attachments)
} as const;

/**
 * Storage included free before per-GB billing starts (account-wide, on the paid
 * plans). Usage below these costs nothing, so a realistic estimate subtracts
 * them. This is why a modest free user base is effectively free to host.
 */
export const STORAGE_FREE_TIER_BYTES = {
  do: 5 * GB, // Durable Objects SQLite: 5 GB included
  r2: 10 * GB, // R2: 10 GB included
} as const;

/**
 * Fixed monthly platform base, independent of usage or user count. Cloudflare
 * Workers Paid ($5) plus Vercel Pro ($20, active as of 2026-06-07). Vercel Pro
 * includes $20 of metered usage each month, which offsets the first $20 of
 * Vercel-side overages. This is the floor you pay at any scale; storage
 * overages stack on top.
 */
export const FIXED_MONTHLY_BASE_CENTS = 2500;

/**
 * Recurring ANNUAL fees, kept as a breakdown so the cost panel can show them as
 * their MONTHLY equivalent (Grant 2026-06-09, "it really is a monthly cost,
 * $120/yr = $10/mo"). Edit these as real invoices land. One-time fees (Google
 * Play $25 registration, etc.) do NOT belong here, only recurring yearly ones.
 */
export const ANNUAL_RECURRING_FEES_CENTS = {
  appleDeveloper: 9900, // $99/yr Apple Developer Program
  wiAnnualReport: 2500, // $25/yr Wisconsin LLC annual report, online filing (DFI, verified 2026-06; $40 only if filed on paper)
  domain: 999, // $9.99/yr research-os.app (Grant's actual)
  domainCom: 1044, // ~$10.44/yr research-os.com (Cloudflare Registrar at-cost; VERIFY Grant's actual renewal)
};

/** The annual recurring fees expressed as a monthly run-rate (sum / 12). */
export const AMORTIZED_ANNUAL_CENTS = Math.round(
  (ANNUAL_RECURRING_FEES_CENTS.appleDeveloper +
    ANNUAL_RECURRING_FEES_CENTS.wiAnnualReport +
    ANNUAL_RECURRING_FEES_CENTS.domain +
    ANNUAL_RECURRING_FEES_CENTS.domainCom) /
    12,
);

export interface InfraCostEstimate {
  /** Durable Objects (collab doc) storage above its free tier. */
  doCents: number;
  /** R2 storage above its free tier. */
  r2Cents: number;
  /** Fixed Workers Paid + Vercel Pro base, billed regardless of usage. */
  fixedBaseCents: number;
  /** Recurring annual fees (Apple, LLC report, domain) as a monthly equivalent. */
  amortizedAnnualCents: number;
  totalCents: number;
}

/**
 * A rough monthly infra cost from the measured byte totals plus the fixed base.
 * Each storage figure is charged only above its free tier, and a null usage
 * figure contributes zero (the service was unavailable), so the estimate never
 * throws. Storage + fixed base only, see the constants above.
 */
export function estimateMonthlyInfraCostCents(
  collabBytes: number | null,
  r2Bytes: number | null,
): InfraCostEstimate {
  const billableGb = (bytes: number | null, freeBytes: number): number =>
    bytes == null ? 0 : Math.max(0, bytes - freeBytes) / GB;
  const doCents = Math.round(
    billableGb(collabBytes, STORAGE_FREE_TIER_BYTES.do) *
      STORAGE_PRICE_USD_PER_GB_MONTH.do *
      100,
  );
  const r2Cents = Math.round(
    billableGb(r2Bytes, STORAGE_FREE_TIER_BYTES.r2) *
      STORAGE_PRICE_USD_PER_GB_MONTH.r2 *
      100,
  );
  return {
    doCents,
    r2Cents,
    fixedBaseCents: FIXED_MONTHLY_BASE_CENTS,
    amortizedAnnualCents: AMORTIZED_ANNUAL_CENTS,
    totalCents:
      doCents + r2Cents + FIXED_MONTHLY_BASE_CENTS + AMORTIZED_ANNUAL_CENTS,
  };
}
