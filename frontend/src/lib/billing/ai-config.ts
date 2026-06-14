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
 * The bare inference cost basis, LOCKED for beta go-live (2026-06-14). Set to the
 * Fireworks gpt-oss-120b standard-tier OUTPUT rate, $0.60 per 1M tokens (input is
 * cheaper at $0.15/1M; verified live at docs.fireworks.ai/serverless/pricing). We
 * debit total tokens at one rate, so using the output rate as the cost basis is the
 * safe never-undercharge choice across any input:output mix (worst case, an
 * all-output turn, is still covered). Real blended cost is lower because BeakerBot
 * is input-heavy, so this can be refined DOWN after instrumenting real tasks.
 * Every billing rate derives from this, so changing this one constant retunes the
 * whole token economy and nothing else.
 */
export const AI_BARE_COST_USD_PER_TOKEN = 0.6 / 1_000_000;

/**
 * The confirmed AI markups over bare cost (Grant 2026-06-11, see
 * docs/proposals/beakerbot-pricing-analysis.md "The markup"). The multipliers are
 * locked; the bare-cost dollars stay tunable. Individuals and labs pay 1.4x bare
 * (cost-recovery plus a thin buffer for Stripe on the block and the proxy
 * invocation, not profit). Departments and institutions pay 2.0x bare; that ~0.6x
 * gap is the sustaining surplus that funds the free individual sign-up trials and
 * AI development, the same solidarity logic as the storage tiers.
 */
export const AI_INDIVIDUAL_MARKUP = 1.4;
export const AI_ORG_MARKUP = 2.0;

/**
 * The individual/lab billing rate, what a user's prepaid dollars buy and what the
 * balance debits at. This is THE rate the packs, the balance, and the ledger use.
 * Bare cost times the 1.4x individual markup, about $0.84 per 1M tokens.
 */
export const AI_TOKEN_PRICE_USD = AI_BARE_COST_USD_PER_TOKEN * AI_INDIVIDUAL_MARKUP;

/**
 * The department/institution pool billing rate, bare cost times the 2.0x org
 * markup, about $1.20 per 1M tokens. Defined here so the rate lives in one place;
 * the org AI invoice line that consumes it is a later phase and is not wired yet.
 */
export const AI_ORG_TOKEN_PRICE_USD = AI_BARE_COST_USD_PER_TOKEN * AI_ORG_MARKUP;

/** Micro-dollars (millionths of a USD) per token, the integer unit we store in
 *  the ledger so token-to-dollar accounting never drifts on floats. */
export const USD_MICROS_PER_USD = 1_000_000;

/**
 * The one-time sign-up gift, in tokens. Granted once per owner on FIRST use
 * (LOCKED decision), keyed to the owner so it can never be re-minted. Sized at 25
 * cents of value at the individual billing rate (~298k tokens); because the basis
 * is the conservative output-rate cost, our actual worst-case exposure on an
 * all-output trial is under 18 cents, so the free liability is firmly capped. That
 * is dozens of real tasks, enough to genuinely try BeakerBot before deciding to
 * spend. A one-time trial, NOT a recurring monthly allowance (a recurring free pool
 * would be an unbounded liability, Grant 2026-06-11).
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

/** The three prepaid top-up tiers, by dollar amount, as the string the
 *  checkout route and the webhook carry in metadata. */
export type AiPack = "10" | "25" | "50";

/** The token amount a given pack credits, looked up from PACK_TOKENS by the
 *  pack's numeric value. The webhook uses this to credit the ledger. */
export function packTokens(pack: AiPack): number {
  return PACK_TOKENS[Number(pack) as 10 | 25 | 50];
}

/**
 * The Stripe Price id for a top-up pack, read from a SERVER-ONLY env var
 * (STRIPE_AI_PRICE_10 / _25 / _50). These are one-time prices the operator
 * creates in Stripe; they are NOT NEXT_PUBLIC because the client never needs the
 * price id (the checkout is created server-side from the pack name). Returns null
 * when the var is unset so the route can answer with a clear "pack_unconfigured"
 * rather than crashing. Phase 3 of the BeakerBot AI billing build.
 */
export function aiPackPriceId(pack: AiPack): string | null {
  switch (pack) {
    case "10":
      return process.env.STRIPE_AI_PRICE_10 ?? null;
    case "25":
      return process.env.STRIPE_AI_PRICE_25 ?? null;
    case "50":
      return process.env.STRIPE_AI_PRICE_50 ?? null;
    default:
      return null;
  }
}
