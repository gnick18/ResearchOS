import { describe, expect, it } from "vitest";
import { alignGlobal, alignLocal, alignSemiGlobal, opsToCigar } from "./core";
import { dnaScoring } from "./scoring";

// All expected values below are hand-worked against the documented scoring
// (default DNA: match +2, mismatch -1; default affine gaps: open 5, extend 1,
// so a gap of length L costs 5 + L). Identity = matches / alignment length.

describe("opsToCigar", () => {
  it("run-length encodes op lists", () => {
    expect(opsToCigar(["M", "M", "M", "X", "M"])).toBe("3M1X1M");
    expect(opsToCigar(["M", "I", "I", "D"])).toBe("1M2I1D");
    expect(opsToCigar([])).toBe("");
  });
});

describe("alignGlobal (Needleman-Wunsch)", () => {
  it("aligns identical sequences end-to-end", () => {
    const r = alignGlobal("ACGT", "ACGT");
    expect(r.score).toBe(8); // 4 matches * 2
    expect(r.cigar).toBe("4M");
    expect(r.ops).toEqual(["M", "M", "M", "M"]);
    expect(r.identity).toBe(1);
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([0, 4, 0, 4]);
    expect(r.alignedA).toBe("ACGT");
    expect(r.alignedB).toBe("ACGT");
  });

  it("places a single mismatch in the middle (substring search cannot do this)", () => {
    // ACGTACGT vs ACGAACGT: position 3 (0-based) differs T vs A.
    const r = alignGlobal("ACGTACGT", "ACGAACGT");
    expect(r.score).toBe(13); // 7 matches*2 - 1 mismatch = 14 - 1
    expect(r.cigar).toBe("3M1X4M");
    expect(r.ops).toEqual(["M", "M", "M", "X", "M", "M", "M", "M"]);
    expect(r.identity).toBeCloseTo(7 / 8, 10);
    expect(r.aEnd).toBe(8);
    expect(r.bEnd).toBe(8);
  });

  it("introduces an affine gap rather than many mismatches", () => {
    // a has an extra base (T) at index 4 relative to b -> one insertion in a.
    const r = alignGlobal("ACGTACGT", "ACGTCGT", { gapOpen: 5, gapExtend: 1 });
    expect(r.cigar).toBe("4M1I3M");
    expect(r.alignedA).toBe("ACGTACGT");
    expect(r.alignedB).toBe("ACGT-CGT");
    // 7 matches*2 - (gapOpen 5 + 1*extend 1) = 14 - 6 = 8
    expect(r.score).toBe(8);
    expect(r.ops).toEqual(["M", "M", "M", "M", "I", "M", "M", "M"]);
  });

  it("prefers one long gap (one open) over two short gaps (two opens)", () => {
    // b is missing two adjacent bases vs a. Affine: a single length-2 gap costs
    // 5 + 2 = 7, versus two length-1 gaps 2*(5+1) = 12. The optimal traceback
    // must yield one contiguous gap.
    const r = alignGlobal("ACGTTTACGT", "ACGTACGT", { gapOpen: 5, gapExtend: 1 });
    // One contiguous length-2 gap (2I), not two separate 1I runs. The gap lands
    // at the leftmost optimal position; the score is what proves single-open.
    expect(r.cigar).toBe("3M2I5M");
    expect(r.alignedB).toBe("ACG--TACGT");
    // 8 matches*2 - (5 + 2*1) = 16 - 7 = 9
    expect(r.score).toBe(9);
  });
});

describe("alignLocal (Smith-Waterman)", () => {
  it("extracts the best local subalignment, trimming flanks", () => {
    const r = alignLocal("TTTACGTACGTTTT", "ACGTACGT");
    expect(r.score).toBe(16); // 8 matches * 2
    expect(r.cigar).toBe("8M");
    expect(r.identity).toBe(1);
    expect(r.aStart).toBe(3);
    expect(r.aEnd).toBe(11);
    expect(r.bStart).toBe(0);
    expect(r.bEnd).toBe(8);
    expect(r.alignedA).toBe("ACGTACGT");
  });

  it("returns an empty alignment when nothing scores positively", () => {
    const r = alignLocal("AAAA", "CCCC");
    expect(r.score).toBe(0);
    expect(r.ops).toEqual([]);
    expect(r.cigar).toBe("");
    expect(r.identity).toBe(0);
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([0, 0, 0, 0]);
  });
});

describe("alignSemiGlobal (glocal: query end-to-end, free target end gaps)", () => {
  it("places a whole query into a flanked target with no end-gap penalty", () => {
    const r = alignSemiGlobal("GGGGGACGTACGTGGGGG", "ACGTACGT");
    expect(r.score).toBe(16); // 8 matches * 2, flanks free
    expect(r.cigar).toBe("8M");
    expect(r.aStart).toBe(5);
    expect(r.aEnd).toBe(13);
    expect(r.bStart).toBe(0);
    expect(r.bEnd).toBe(8);
  });

  it("keeps an internal mismatch when placing the query", () => {
    const r = alignSemiGlobal("GGGGGACGAACGTGGGGG", "ACGTACGT");
    expect(r.score).toBe(13); // 7 matches*2 - 1
    expect(r.cigar).toBe("3M1X4M");
    expect(r.aStart).toBe(5);
    expect(r.aEnd).toBe(13);
    expect(r.identity).toBeCloseTo(7 / 8, 10);
  });
});

describe("determinism", () => {
  it("produces identical results across repeated calls", () => {
    const inputs: [string, string] = ["TTTACGTACGTTTT", "ACGAACGT"];
    const a = JSON.stringify(alignLocal(...inputs));
    const b = JSON.stringify(alignLocal(...inputs));
    expect(a).toBe(b);
    const g1 = JSON.stringify(alignGlobal("ACGTACGT", "ACGTCGT"));
    const g2 = JSON.stringify(alignGlobal("ACGTACGT", "ACGTCGT"));
    expect(g1).toBe(g2);
  });
});

describe("custom scoring is pluggable", () => {
  it("uses a caller-supplied non-IUPAC simple scheme", () => {
    const simple = dnaScoring({ match: 1, mismatch: -2, iupac: false });
    const r = alignGlobal("ACGT", "ACGT", { scoring: simple });
    expect(r.score).toBe(4); // 4 matches * 1
  });
});
