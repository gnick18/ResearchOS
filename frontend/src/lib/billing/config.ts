// Flat-plan billing, configuration + pure helpers (no server imports).
//
// Flat bundle plans (Grant 2026-06-07): every user is on a PLAN that pairs a
// storage allowance with a monthly activity allowance for one flat price (see
// plans.ts). The free plan is the default, so nobody is charged without choosing
// a paid plan. This file holds the free tier constant + the operations-cost
// helper used to estimate (never bill) what activity costs us.
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
 * Free server-storage allowance per user, the storage the free plan grants. 1 GB
 * (Grant 2026-06-05), aligned with the relay inbox cap. An account stays on this
 * until the user chooses a paid plan.
 */
export const FREE_ALLOWANCE_BYTES = 1 * BYTES_PER_GB;

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

