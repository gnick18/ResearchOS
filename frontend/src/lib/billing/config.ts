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

/** Whether AI (BeakerBot) metering + billing is on. Same fail-closed switch the
 *  proxy and /api/billing/ai-status read, exported here so server-rendered copy
 *  (pricing, terms, wiki) can show "free during the beta" vs live AI pricing in
 *  lockstep with enforcement. Storage and AI flip independently (the go-live
 *  sequence turns AI on first), so keep them as two reads. */
export function isAiBillingEnabled(): boolean {
  const v = process.env.AI_BILLING_ENABLED;
  return v === "1" || v === "true";
}

/** Net-terms window for org procurement invoices, in days. A sent invoice (PO
 *  number, ACH or card) is due this many days out, unlike the auto-charged card
 *  checkout individuals and labs use. */
export const ORG_INVOICE_NET_DAYS = 30;

/**
 * Free-trial length for a new lab-head signup, in days (Grant 2026-06-19). A lab
 * starts with NO card and is not charged for this many days regardless of usage,
 * so a PI can bring their whole team on and feel the value before any money is
 * involved. At day 90 a lab with a card on file resumes normal Model-A charging;
 * a lab with no card pauses (cloud accrual stops, the local app keeps working)
 * until a card is added, so we never silently run up an uncharged bill and there
 * is always an escape. We give the full term, not a token week, because a lab
 * adopts on a semester rhythm, not a weekend.
 */
export const LAB_TRIAL_DAYS = 90;

export const BYTES_PER_GB = 1024 ** 3;

/**
 * Free server-storage allowance per billing owner (a solo user, or a whole lab
 * pool, since a lab resolves to the PI's key). 5 GB (Grant 2026-06-09), a real
 * trial that bounds the free-tier cost. At R2 $0.015/GB-mo this is at most
 * $0.075/owner-mo if completely full, usually far less, and the cost breaker
 * caps the aggregate regardless. Sized for sustainability per
 * scripts/capacity-model.mjs, raise it as paying + sponsoring labs offset the
 * free cost. Separate from the relay inbox cap (FREE_STORAGE_BYTES, transient).
 */
export const FREE_ALLOWANCE_BYTES = 5 * BYTES_PER_GB;

/**
 * Metered storage price beyond the free allowance, in USD per GB-month. 3x our
 * R2 cost of $0.015/GB-mo (Grant 2026-06-09). Still about one-twentieth of a
 * per-seat ELN, funds free labs + a modest reinvestment surplus. Only heavy
 * image/video/big-data labs ever reach it. Used by the (future) metered + tier
 * pricing; the model is in scripts/capacity-model.mjs and
 * docs/proposals/PRICING_TRANSPARENCY.md.
 */
export const METERED_STORAGE_USD_PER_GB_MONTH = 0.045;

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

