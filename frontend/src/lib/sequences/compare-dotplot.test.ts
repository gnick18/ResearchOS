import { describe, it, expect } from "vitest";
import { computeDotplot, dotplotWordSize } from "./compare-dotplot";

describe("computeDotplot", () => {
  it("lights up the main diagonal for identical sequences", () => {
    const seq = "ATGCATGCATGCATGCATGCATGC"; // 24 bp
    const plot = computeDotplot(seq, seq, 24, 4);
    expect(plot.aLen).toBe(24);
    expect(plot.bLen).toBe(24);
    // Top-left cell (start of both) must be on.
    expect(plot.cells[0]).toBe(1);
    // Every diagonal cell should be lit (identical sequence => k-mers align on
    // the diagonal). Check a few.
    const g = plot.size;
    expect(plot.cells[0 * g + 0]).toBe(1);
    expect(plot.cells[1 * g + 1]).toBe(1);
  });

  it("clamps the grid to the shorter sequence", () => {
    const plot = computeDotplot("ATGCATGC", "ATGCATGC", 1000, 4);
    expect(plot.size).toBe(8);
    expect(plot.cells).toHaveLength(8 * 8);
  });

  it("returns an empty grid when sequences are shorter than k", () => {
    const plot = computeDotplot("ATG", "ATG", 50, 11);
    expect(plot.cells.every((c) => c === 0)).toBe(true);
  });

  it("has no matches for fully dissimilar sequences", () => {
    const a = "AAAAAAAAAAAAAAAA";
    const b = "GGGGGGGGGGGGGGGG";
    const plot = computeDotplot(a, b, 16, 6);
    expect(plot.cells.every((c) => c === 0)).toBe(true);
  });
});

describe("dotplotWordSize", () => {
  it("scales the word length with the shorter span", () => {
    expect(dotplotWordSize(10)).toBe(6);
    expect(dotplotWordSize(100)).toBe(8);
    expect(dotplotWordSize(1000)).toBe(11);
    expect(dotplotWordSize(50000)).toBe(14);
  });
});
