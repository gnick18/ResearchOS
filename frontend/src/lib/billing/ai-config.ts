// BeakerBot AI billing, pure token math + tunable rate config (Phase 1).
//
// The user-facing layer is TOKENS (the convention every AI tool uses, Grant
// 2026-06-11), the accounting layer behind Stripe and our own cost is DOLLARS.
// This file is the single bridge between the two, every token-to-dollar
// conversion goes through here so the rate lives in exactly one place and is
// trivially tunable at lock time. No server imports, no DB, pure functions, so
// it is fully unit-testable and safe to import from a client component for
// display-only pack amounts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * PLACEHOLDER, Grant sets this from the live Fireworks gpt-oss-120b rates before
 * go-live (see docs/proposals/beakerbot-pricing-analysis.md, "Re-pull Fireworks
 * rates at lock time"). It is pinned here so the starter-grant math lands on a
 * round 750,000-token gift, i.e. a one-time grant worth about 25 cents of
 * inference. Concretely 0.25 dollars divided across 750,000 tokens, about
 * 3.33e-7 dollars per token. Every other number in this file derives from it, so
 * changing this one constant retunes the whole token economy and nothing else.
 */
export const AI_TOKEN_PRICE_USD = 0.25 / 750_000;

/** Micro-dollars (millionths of a USD) per token, the integer unit we store in
 *  the ledger so token-to-dollar accounting never drifts on floats. */
export const USD_MICROS_PER_USD = 1_000_000;

/**
 * The one-time sign-up gift, in tokens. Granted once per owner on FIRST use
 * (LOCKED decision), keyed to the owner so it can never be re-minted. Worth about
 * 25 cents of inference at the placeholder rate above, which is dozens of real
 * tasks, enough to genuinely try BeakerBot before deciding to spend. A one-time
 * trial, NOT a recurring monthly allowance (a recurring free pool would be an
 * unbounded liability, Grant 2026-06-11).
 */
export const STARTER_GRANT_TOKENS = Math.round(0.25 / AI_TOKEN_PRICE_USD);

/**
 * Prepaid top-up packs, dollars to tokens at the current rate. Defined now for
 * the Phase 3 Stripe top-up wiring (not yet wired), and used today only to label
 * the display-only pack tiles with a token amount. Each pack tops up the balance
 * by price divided by the per-token price.
 */
export const PACK_TOKENS: Record<10 | 25 | 50, number> = {
  10: Math.round(10 / AI_TOKEN_PRICE_USD),
  25: Math.round(25 / AI_TOKEN_PRICE_USD),
  50: Math.round(50 / AI_TOKEN_PRICE_USD),
};

/**
 * Micro-dollars of inference that `tokens` represent, rounded to the nearest
 * micro-dollar. This is the dollar value we record alongside each ledger row so
 * our own cost accounting (and later Stripe reconciliation) is exact in integers.
 * A non-positive token count yields 0.
 */
export function usdMicrosForTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens * AI_TOKEN_PRICE_USD * USD_MICROS_PER_USD);
}
