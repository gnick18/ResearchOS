// BeakerBot AI billing, pure token-math tests (Phase 1). No DB, no env.

import { describe, expect, it } from "vitest";

import {
  AI_TOKEN_PRICE_USD,
  PACK_TOKENS,
  STARTER_GRANT_TOKENS,
  usdMicrosForTokens,
} from "../ai-config";

describe("ai-config token math", () => {
  it("the starter grant is the round 750,000-token gift", () => {
    expect(STARTER_GRANT_TOKENS).toBe(750_000);
  });

  it("the per-token price is the placeholder 25 cents over 750k tokens", () => {
    expect(AI_TOKEN_PRICE_USD).toBeCloseTo(0.25 / 750_000, 12);
  });

  it("the starter grant is worth about 25 cents (250,000 micro-dollars)", () => {
    expect(usdMicrosForTokens(STARTER_GRANT_TOKENS)).toBe(250_000);
  });

  it("usdMicrosForTokens is zero or non-positive-safe", () => {
    expect(usdMicrosForTokens(0)).toBe(0);
    expect(usdMicrosForTokens(-100)).toBe(0);
    expect(usdMicrosForTokens(Number.NaN)).toBe(0);
  });

  it("usdMicrosForTokens scales linearly with the rate", () => {
    // 1,500,000 tokens is two grants, so about 50 cents.
    expect(usdMicrosForTokens(1_500_000)).toBe(500_000);
  });

  it("packs convert dollars to tokens at the current rate", () => {
    // 25 cents buys 750k tokens, so $10 buys 40x that, and the tiers scale.
    expect(PACK_TOKENS[10]).toBe(Math.round(10 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[25]).toBe(Math.round(25 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[50]).toBe(Math.round(50 / AI_TOKEN_PRICE_USD));
    expect(PACK_TOKENS[25]).toBeGreaterThan(PACK_TOKENS[10]);
    expect(PACK_TOKENS[50]).toBeGreaterThan(PACK_TOKENS[25]);
  });

  it("a $10 pack is 40 starter grants of tokens (30,000,000)", () => {
    expect(PACK_TOKENS[10]).toBe(30_000_000);
  });
});
