// Metered-storage billing, configuration + pure helpers (no server imports).
//
// Flat-block model (Grant, 2026-06-05): a lab buys a recurring subscription
// block that adds a fixed chunk of storage to its quota. Buy more blocks for
// more storage. The dollar amount lives in Stripe (the price the checkout
// uses); the storage a block grants lives here. Both are placeholders until the
// real pricing is set, ideally with the accountant, to clear Neon's
// $0.35/GB-month plus Stripe fees.
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

/** Storage one purchased block grants. A placeholder until pricing is finalized. */
export const GB_PER_BLOCK = 10;

const BYTES_PER_GB = 1024 ** 3;

/** Bytes one block grants. */
export const BYTES_PER_BLOCK = GB_PER_BLOCK * BYTES_PER_GB;

/**
 * Free server-storage allowance per owner before any paid block is needed.
 * 1 GB (Grant 2026-06-05), aligned with the relay inbox cap FREE_STORAGE_BYTES
 * in sharing/relay/limits.ts. Enforcement (free allowance plus purchased blocks)
 * is the phase-2b quota layer; this pins the intended value.
 */
export const FREE_ALLOWANCE_BYTES = 1 * BYTES_PER_GB;

/** Paid storage bytes for a given active block count (never negative). */
export function paidStorageBytes(blocks: number): number {
  if (!Number.isFinite(blocks) || blocks <= 0) return 0;
  return Math.floor(blocks) * BYTES_PER_BLOCK;
}

// --- recommended pricing (cost-plus, Grant 2026-06-05) ---
//
// A block's price covers its DATA cost (Neon storage) plus Stripe's processing
// fee plus a $1 wiggle buffer, and nothing more. Tax is NOT baked in here,
// Stripe adds it on top (Automatic / exclusive behavior), so the customer pays
// any tax separately (usually $0). This keeps the rationale explicit and lets
// the number be recomputed if Neon pricing, the block size, or the buffer move.
// The actual charged price is the Stripe Price; this is the recommendation that
// price should be set to.

export const NEON_STORAGE_USD_PER_GB_MONTH = 0.35;
export const STRIPE_FEE_PCT = 0.029;
export const STRIPE_FEE_FLAT_CENTS = 30;
export const PRICE_WIGGLE_CENTS = 100; // the $1 cushion

/**
 * Recommended monthly price (cents) for one storage block. Grosses the price up
 * so that after Stripe's percentage + flat fee, the LLC still nets the block's
 * data cost plus the $1 buffer. Tax is added by Stripe on top, not included here.
 */
export function recommendedBlockPriceCents(gbPerBlock: number = GB_PER_BLOCK): number {
  const dataCostCents = Math.round(gbPerBlock * NEON_STORAGE_USD_PER_GB_MONTH * 100);
  const netNeededCents = dataCostCents + PRICE_WIGGLE_CENTS;
  // P - (pct*P + flat) = netNeeded  =>  P = (netNeeded + flat) / (1 - pct)
  return Math.ceil((netNeededCents + STRIPE_FEE_FLAT_CENTS) / (1 - STRIPE_FEE_PCT));
}
