// BeakerBot AI billing, pure token-math tests (Phase 1). No DB, no env.

import { describe, expect, it } from "vitest";

import {
  AI_BARE_COST_USD_PER_TOKEN,
  AI_INDIVIDUAL_MARKUP,
  AI_MEASURED_BARE_COST_USD_PER_TOKEN,
  AI_ORG_MARKUP,
  AI_ORG_TOKEN_PRICE_USD,
  AI_TOKEN_PRICE_USD,
  PACK_TOKENS,
  STARTER_GRANT_TOKENS,
  usdMicrosForTokens,
} from "../ai-config";

describe("ai-config token math", () => {
  it("bare cost is the locked measured-plus-margin basis, $0.20 per 1M", () => {
    expect(AI_BARE_COST_USD_PER_TOKEN).toBeCloseTo(0.2 / 1_000_000, 12);
  });

  it("the confirmed markups are 1.4x individual and 2.0x org", () => {
    expect(AI_INDIVIDUAL_MARKUP).toBe(1.4);
    expect(AI_ORG_MARKUP).toBe(2.0);
  });

  it("the individual rate is bare cost times 1.4 (~$0.28 per 1M)", () => {
    expect(AI_TOKEN_PRICE_USD).toBeCloseTo(0.28 / 1_000_000, 12);
  });

  it("the org rate is bare cost times 2.0 (~$0.40 per 1M)", () => {
    expect(AI_ORG_TOKEN_PRICE_USD).toBeCloseTo(0.4 / 1_000_000, 12);
  });

  it("the starter grant is sized by measured cost (1,633,987 tokens)", () => {
    expect(STARTER_GRANT_TOKENS).toBe(1_633_987);
  });

  it("the starter grant costs us a clean 25 cents at measured cost", () => {
    expect(
      STARTER_GRANT_TOKENS * AI_MEASURED_BARE_COST_USD_PER_TOKEN,
    ).toBeCloseTo(0.25, 3);
  });

  it("the starter grant is worth about 46 cents of value at our price", () => {
    expect(usdMicrosForTokens(STARTER_GRANT_TOKENS)).toBe(457_516);
  });

  it("usdMicrosForTokens is zero or non-positive-safe", () => {
    expect(usdMicrosForTokens(0)).toBe(0);
    expect(usdMicrosForTokens(-100)).toBe(0);
    expect(usdMicrosForTokens(Number.NaN)).toBe(0);
  });

  it("usdMicrosForTokens scales linearly with the rate", () => {
    // 1,500,000 tokens at the $0.28 per 1M individual rate is $0.42 (420,000 micro).
    expect(usdMicrosForTokens(1_500_000)).toBe(420_000);
  });

  it("packs convert dollars to tokens at the current rate", () => {
    // 25 cents buys 750k tokens, so $10 buys 40x that, and the tiers scale.
    expect(PACK_TOKENS[10]).toBe(Math.round(10 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[25]).toBe(Math.round(25 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[50]).toBe(Math.round(50 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[25]).toBeGreaterThan(PACK_TOKENS[10]);
    expect(PACK_TOKENS[50]).toBeGreaterThan(PACK_TOKENS[25]);
  });

  it("a $10 pack is 35,714,286 tokens at the $0.28 per 1M individual rate", () => {
    expect(PACK_TOKENS[10]).toBe(35_714_286);
  });
});
