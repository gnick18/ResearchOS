// Metered-storage billing, configuration + pure helpers (no server imports).
//
// Hybrid metered model (Grant, 2026-06-07): every user gets a free tier, then
// pays for the storage they ACTUALLY use above it, by the gigabyte-month, billed
// on the monthly average and aggregated into one Stripe invoice. There are no
// blocks to buy. Instead a user raises their own storage CAP, which is at once
// the enforcement wall, their monthly spend ceiling, and the opt-in (the default
// cap is the free tier, so nobody is billed without raising it).
//
// Cost basis is Cloudflare Durable Objects SQLite at $0.20/GB-month; the price
// adds a $0.10 margin to $0.30/GB-month. Operations (requests/compute) are not
// metered to users, they sit inside Cloudflare's free tiers and the fixed base.
//
// The whole billing surface is dark unless BILLING_ENABLED is "true", the same
// fail-closed pattern as SHARING_ENABLED, so a deploy without it configured can
// never charge anyone.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Whether the billing surface is on. Fails closed. */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

export const BYTES_PER_GB = 1024 ** 3;

/**
 * Free server-storage allowance per user before any metered charge. 1 GB (Grant
 * 2026-06-05), aligned with the relay inbox cap. Also the default cap, so an
 * account is never billed until the user raises the cap above this.
 */
export const FREE_ALLOWANCE_BYTES = 1 * BYTES_PER_GB;

// --- metered pricing (hybrid, Grant 2026-06-07) ---

/** Our cost for the metered store (Durable Objects SQLite). */
export const DO_STORAGE_USD_PER_GB_MONTH = 0.2;
/** Price charged per GB-month of usage above the free tier (cost + $0.10). */
export const STORAGE_RATE_USD_PER_GB_MONTH = 0.3;
/**
 * Minimum monthly charge. A computed charge below this is WAIVED (not accrued),
 * so Stripe's per-invoice fee ($0.30 + 2.9%) never exceeds the charge itself.
 */
export const MIN_MONTHLY_CHARGE_CENTS = 200;

/** Storage caps a user can pick, in GB. The cap is the wall + spend ceiling. */
export const CAP_OPTIONS_GB = [5, 25, 100, 250] as const;

// --- operations cost (tracked, not billed; Grant 2026-06-07) ---
//
// Storage is the only thing on a user's bill, but it misses the high-activity,
// low-storage case (constant edits compact away, so storage stays flat while
// rows-written, requests, and Durable Object duration keep costing us). We track
// write operations per owner and turn them into an ESTIMATED cost for /admin so
// an expensive owner is visible. These are OUR costs, never charged to the user.
//
// Published Cloudflare rates (infra-tiers.ts): a write is one SQLite row written
// (~$1.00 / M rows) plus roughly one request to reach the Durable Object
// (~$0.15 / M requests). Duration is left out of this estimate for now, it needs
// DO-side instrumentation to attribute fairly; rows + requests are the part we
// can attribute from the one write path.

/** Cost of a million rows written to the collab store (Durable Object SQLite). */
export const DO_WRITE_USD_PER_M_ROWS = 1.0;
/** Cost of a million requests to the collab Durable Object. */
export const DO_REQUEST_USD_PER_M = 0.15;

/**
 * Estimated cost (cents) of an owner's write operations over a period. Each
 * tracked write is one row written plus about one request. Duration is not
 * included yet (see above), so this is a floor, not the full compute cost.
 */
export function estimatedOpsCostCents(writes: number): number {
  const perMillionUsd = DO_WRITE_USD_PER_M_ROWS + DO_REQUEST_USD_PER_M;
  return Math.round((Math.max(0, writes) / 1_000_000) * perMillionUsd * 100);
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * BYTES_PER_GB);
}

export function bytesToGb(bytes: number): number {
  return bytes / BYTES_PER_GB;
}

/** Usage above the free allowance, never negative. This is what gets billed. */
export function billableBytes(usedBytes: number): number {
  return Math.max(0, usedBytes - FREE_ALLOWANCE_BYTES);
}

/** Raw monthly charge (cents) for an average usage, BEFORE the minimum rule. */
export function rawChargeCents(avgUsedBytes: number): number {
  const gb = billableBytes(avgUsedBytes) / BYTES_PER_GB;
  return Math.round(gb * STORAGE_RATE_USD_PER_GB_MONTH * 100);
}

/**
 * Monthly charge (cents) after the minimum rule. A raw amount under the minimum
 * is waived to 0 so a tiny overage is never billed at a loss.
 */
export function monthlyChargeCents(avgUsedBytes: number): number {
  const raw = rawChargeCents(avgUsedBytes);
  return raw >= MIN_MONTHLY_CHARGE_CENTS ? raw : 0;
}

/**
 * The maximum monthly cost a given GB cap can incur, the whole cap used above the
 * free tier. Shown beside each cap option so the user sees their spend ceiling.
 */
export function maxMonthlyCostCents(capGb: number): number {
  return rawChargeCents(gbToBytes(capGb));
}

/**
 * The billable GB to report to Stripe's meter for a month's average usage. This
 * is what the monthly report job sends. It is 0 when the charge would fall under
 * the minimum (so sub-minimum months are waived, not billed), otherwise the
 * billable gigabytes above the free tier. Stripe's metered price multiplies this
 * by the per-GB rate, so reporting 0 means a $0 invoice line.
 */
export function reportableGb(avgUsedBytes: number): number {
  if (monthlyChargeCents(avgUsedBytes) === 0) return 0;
  return billableBytes(avgUsedBytes) / BYTES_PER_GB;
}

// --- lab-level (consolidated) billing (chunk 3, Grant 2026-06-07) ---
//
// A PI sponsors the whole lab on one invoice. Each sponsored owner (the PI plus
// every accepted member) keeps their own 1 GB free, so the lab's free pool is
// 1 GB times the number of sponsored owners. The PI's invoice meters only the
// aggregate usage above that pool, so a small or light lab still pays $0. The
// same minimum-charge waiver and per-GB rate apply, just against the aggregate.

/**
 * The pooled free allowance for a lab, 1 GB per sponsored owner (the PI counts
 * as one). Clamped to at least one tier so a lab with no members still pools the
 * PI's own free gigabyte.
 */
export function labFreePoolBytes(sponsoredOwnerCount: number): number {
  return Math.max(1, Math.floor(sponsoredOwnerCount)) * FREE_ALLOWANCE_BYTES;
}

/** Aggregate lab usage above the pooled free tier, never negative. */
export function labBillableBytes(
  aggregateUsedBytes: number,
  sponsoredOwnerCount: number,
): number {
  return Math.max(0, aggregateUsedBytes - labFreePoolBytes(sponsoredOwnerCount));
}

/** Raw monthly charge (cents) for a lab's aggregate usage, before the minimum. */
export function labRawChargeCents(
  aggregateAvgBytes: number,
  sponsoredOwnerCount: number,
): number {
  const gb =
    labBillableBytes(aggregateAvgBytes, sponsoredOwnerCount) / BYTES_PER_GB;
  return Math.round(gb * STORAGE_RATE_USD_PER_GB_MONTH * 100);
}

/** Lab monthly charge (cents) after the minimum-charge waiver. */
export function labMonthlyChargeCents(
  aggregateAvgBytes: number,
  sponsoredOwnerCount: number,
): number {
  const raw = labRawChargeCents(aggregateAvgBytes, sponsoredOwnerCount);
  return raw >= MIN_MONTHLY_CHARGE_CENTS ? raw : 0;
}

/** The billable GB to report to Stripe for a lab's aggregate monthly average. */
export function labReportableGb(
  aggregateAvgBytes: number,
  sponsoredOwnerCount: number,
): number {
  if (labMonthlyChargeCents(aggregateAvgBytes, sponsoredOwnerCount) === 0) {
    return 0;
  }
  return labBillableBytes(aggregateAvgBytes, sponsoredOwnerCount) / BYTES_PER_GB;
}
