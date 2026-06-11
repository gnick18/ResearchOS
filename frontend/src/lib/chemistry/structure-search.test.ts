// Unit tests for the pure `tanimoto` helper in structure-search.ts.
//
// The RDKit-backed functions (substructureMatches, similarityRank) require the
// wasm module and are browser-only; they are verified live in the workbench,
// not here.

import { describe, expect, it } from "vitest";

import { tanimoto } from "./structure-search";

describe("tanimoto", () => {
  it("returns 1 for identical non-empty bit strings", () => {
    expect(tanimoto("101010", "101010")).toBe(1);
  });

  it("returns 0 for completely disjoint bit strings", () => {
    // "10" and "01" share no set bits: intersection=0, union=2.
    expect(tanimoto("10", "01")).toBe(0);
  });

  it("computes the correct coefficient for a partial overlap", () => {
    // "110" vs "101": intersection = bit 0 only (both have '1' at pos 0)
    // union = bits 0, 1, 2 => 3 set positions across both
    // intersection = 1, union = 3, score = 1/3
    expect(tanimoto("110", "101")).toBeCloseTo(1 / 3, 10);
  });

  it("returns 0 for length-mismatched strings", () => {
    expect(tanimoto("1010", "10")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(tanimoto("", "")).toBe(0);
    expect(tanimoto("", "1010")).toBe(0);
    expect(tanimoto("1010", "")).toBe(0);
  });

  it("returns 0 when both strings are all zeros (no set bits)", () => {
    expect(tanimoto("000", "000")).toBe(0);
  });

  it("handles a longer realistic bit string correctly", () => {
    // 4 bits set in a, 4 in b, 2 in common: score = 2/6
    const a = "11001100";
    const b = "00110011";
    // No bits in common, union = 8.
    expect(tanimoto(a, b)).toBe(0);
  });

  it("handles a non-trivial overlap in a longer string", () => {
    // intersection = 2 (pos 0 and 4), union = 6
    const a = "10001100";
    const b = "10001010";
    // a bits: 0,4,5  b bits: 0,4,6  intersection: 0,4  union: 0,4,5,6 -> 2/4
    expect(tanimoto(a, b)).toBeCloseTo(2 / 4, 10);
  });
});
