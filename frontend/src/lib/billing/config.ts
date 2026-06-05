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

/** Paid storage bytes for a given active block count (never negative). */
export function paidStorageBytes(blocks: number): number {
  if (!Number.isFinite(blocks) || blocks <= 0) return 0;
  return Math.floor(blocks) * BYTES_PER_BLOCK;
}
