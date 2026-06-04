import { describe, it, expect } from "vitest";
import { alignGlobal, dnaScoring } from "@/lib/align";
import {
  summarizeAlignment,
  toAlignmentBlocks,
  buildCompareModel,
  formatSummaryLine,
  type AlignmentBlock,
} from "./compare-format";
import type { AlignmentResult } from "@/lib/align";

/**
 * A hand-built alignment result so the formatting helper is tested against a
 * KNOWN column layout, independent of the DP engine. One mismatch (X) and one
 * gap (D, gap in A) in a 6-column alignment.
 *
 *   A:  A C G T - A   (5 residues, aStart 0)
 *   B:  A C A T G A   (6 residues, bStart 0)
 *   op: M M X M D M
 */
const HAND: AlignmentResult = {
  score: 7,
  aStart: 0,
  aEnd: 5,
  bStart: 0,
  bEnd: 6,
  identity: 4 / 6,
  alignedA: "ACGT-A",
  alignedB: "ACATGA",
  ops: ["M", "M", "X", "M", "D", "M"],
  cigar: "2M1X1M1D1M",
};

describe("summarizeAlignment", () => {
  it("counts match / mismatch / gap columns and identity", () => {
    const s = summarizeAlignment(HAND);
    expect(s.columns).toBe(6);
    expect(s.matches).toBe(4);
    expect(s.mismatches).toBe(1);
    expect(s.gaps).toBe(1);
    expect(s.identity).toBeCloseTo(4 / 6, 6);
    expect(s.identityPct).toBe(67); // round(66.67)
    expect(s.score).toBe(7);
  });

  it("handles an empty alignment", () => {
    const empty: AlignmentResult = {
      score: 0, aStart: 0, aEnd: 0, bStart: 0, bEnd: 0,
      identity: 0, alignedA: "", alignedB: "", ops: [], cigar: "",
    };
    const s = summarizeAlignment(empty);
    expect(s.columns).toBe(0);
    expect(s.identity).toBe(0);
    expect(s.identityPct).toBe(0);
  });
});

describe("toAlignmentBlocks", () => {
  it("produces a single block with the right midline and kinds", () => {
    const [block, ...rest] = toAlignmentBlocks(HAND, 60);
    expect(rest).toHaveLength(0);
    expect(block.aRow).toBe("ACGT-A");
    expect(block.bRow).toBe("ACATGA");
    // matches -> '|', mismatch/gap -> ' '
    expect(block.midline).toBe("|| | |");
    expect(block.kinds).toEqual([
      "match", "match", "mismatch", "match", "gap", "match",
    ]);
  });

  it("emits 1-based coordinate ticks that skip gaps", () => {
    const [block] = toAlignmentBlocks(HAND, 60);
    // A: A(1) C(2) G(3) T(4) [gap] A(5)
    expect(block.aStart).toBe(1);
    expect(block.aEnd).toBe(5);
    // B: A(1) C(2) A(3) T(4) G(5) A(6)
    expect(block.bStart).toBe(1);
    expect(block.bEnd).toBe(6);
  });

  it("wraps into fixed-width blocks with continuous coordinates", () => {
    const blocks = toAlignmentBlocks(HAND, 3);
    expect(blocks).toHaveLength(2);

    const [b1, b2] = blocks as [AlignmentBlock, AlignmentBlock];
    expect(b1.aRow).toBe("ACG");
    expect(b1.bRow).toBe("ACA");
    expect(b1.colStart).toBe(0);
    expect(b1.aStart).toBe(1);
    expect(b1.aEnd).toBe(3);

    expect(b2.aRow).toBe("T-A");
    expect(b2.bRow).toBe("TGA");
    expect(b2.colStart).toBe(3);
    // A continues at residue 4 (T) then 5 (A); the gap does not advance.
    expect(b2.aStart).toBe(4);
    expect(b2.aEnd).toBe(5);
    // B continues 4,5,6.
    expect(b2.bStart).toBe(4);
    expect(b2.bEnd).toBe(6);
  });

  it("respects a local-alignment start offset for ticks", () => {
    const local: AlignmentResult = {
      ...HAND,
      aStart: 100,
      bStart: 200,
    };
    const [block] = toAlignmentBlocks(local, 60);
    expect(block.aStart).toBe(101);
    expect(block.aEnd).toBe(105);
    expect(block.bStart).toBe(201);
    expect(block.bEnd).toBe(206);
  });

  it("returns no blocks for an empty alignment", () => {
    const empty: AlignmentResult = {
      score: 0, aStart: 0, aEnd: 0, bStart: 0, bEnd: 0,
      identity: 0, alignedA: "", alignedB: "", ops: [], cigar: "",
    };
    expect(toAlignmentBlocks(empty)).toEqual([]);
  });

  it("rejects a width below 1", () => {
    expect(() => toAlignmentBlocks(HAND, 0)).toThrow(RangeError);
  });
});

describe("formatSummaryLine", () => {
  it("renders identity / cols / score with thousands separators", () => {
    const s = summarizeAlignment(HAND);
    expect(formatSummaryLine(s)).toBe("67% identity over 6 cols, score 7");
  });

  it("singularizes a one-column alignment", () => {
    const one: AlignmentResult = {
      score: 2, aStart: 0, aEnd: 1, bStart: 0, bEnd: 1,
      identity: 1, alignedA: "A", alignedB: "A", ops: ["M"], cigar: "1M",
    };
    expect(formatSummaryLine(summarizeAlignment(one))).toBe(
      "100% identity over 1 col, score 2",
    );
  });
});

describe("buildCompareModel (engine round-trip)", () => {
  it("formats a real global alignment of two near-identical sequences", () => {
    const a = "ATGCAAAGGTTTCCCGGGTTTAAACCCGGGTTT";
    const b = "ATGCAAAGCTTTCCCGGGTTTAAACCCGGGTTT"; // one substitution at pos 9
    const result = alignGlobal(a, b, { scoring: dnaScoring({ iupac: true }) });
    const model = buildCompareModel(result, 60);
    expect(model.summary.columns).toBe(a.length);
    expect(model.summary.mismatches).toBe(1);
    expect(model.summary.gaps).toBe(0);
    expect(model.summary.identityPct).toBe(97);
    // One block (33 cols < 60), midline has exactly one space (the mismatch).
    expect(model.blocks).toHaveLength(1);
    const spaces = model.blocks[0].midline.split("").filter((c) => c === " ").length;
    expect(spaces).toBe(1);
  });
});
