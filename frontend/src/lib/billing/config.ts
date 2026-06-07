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
