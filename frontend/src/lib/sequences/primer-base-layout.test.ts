// primer bases bot — unit tests for the base-level primer layout math. Truth by
// construction: every assertion pins which oligo base anneals vs tails, the
// FORWARD template column it lands on, and mismatch styling, for both strands.

import { describe, expect, it } from "vitest";
import type { BindingSite } from "./primer";
import { layoutPrimerBases } from "./primer-base-layout";

function site(partial: Partial<BindingSite> & Pick<BindingSite, "start" | "end" | "direction">): BindingSite {
  return {
    annealedLength: partial.end - partial.start,
    fullMatch: true,
    ...partial,
  };
}

describe("layoutPrimerBases — forward primer", () => {
  it("maps a clean full-match oligo column-for-column over the template", () => {
    const s = site({ start: 0, end: 4, direction: 1 });
    const out = layoutPrimerBases("ATGC", s)!;
    expect(out).not.toBeNull();
    expect(out.direction).toBe(1);
    expect(out.tailLength).toBe(0);
    expect(out.cells.map((c) => c.column)).toEqual([0, 1, 2, 3]);
    expect(out.cells.map((c) => c.role)).toEqual(["anneal", "anneal", "anneal", "anneal"]);
    expect(out.cells.map((c) => c.base)).toEqual(["A", "T", "G", "C"]);
  });

  it("places a non-annealing 5' tail to the LEFT of the annealed start", () => {
    // oligo GGGG + ATGC; only ATGC anneals at [4, 8).
    const s = site({ start: 4, end: 8, direction: 1, annealedLength: 4 });
    const out = layoutPrimerBases("GGGGATGC", s)!;
    expect(out.tailLength).toBe(4);
    // tail bases (oligo 0..3) sit at columns 0..3, just left of the annealed start.
    expect(out.cells.slice(0, 4).map((c) => c.column)).toEqual([0, 1, 2, 3]);
    expect(out.cells.slice(0, 4).map((c) => c.role)).toEqual(["tail", "tail", "tail", "tail"]);
    // annealed bases (oligo 4..7) sit over the template [4, 8).
    expect(out.cells.slice(4).map((c) => c.column)).toEqual([4, 5, 6, 7]);
    expect(out.cells.slice(4).map((c) => c.role)).toEqual(["anneal", "anneal", "anneal", "anneal"]);
  });

  it("tail columns hang off the left edge as negative when the site starts at 0", () => {
    const s = site({ start: 0, end: 4, direction: 1, annealedLength: 4 });
    const out = layoutPrimerBases("GGATGC", s)!; // 2-base tail
    expect(out.tailLength).toBe(2);
    expect(out.cells.slice(0, 2).map((c) => c.column)).toEqual([-2, -1]);
    expect(out.cells.slice(2).map((c) => c.column)).toEqual([0, 1, 2, 3]);
  });

  it("flags internal mismatch columns as mismatch role", () => {
    const s = site({ start: 0, end: 5, direction: 1, annealedLength: 5, fullMatch: false, mismatches: [2] });
    const out = layoutPrimerBases("ATGCA", s)!;
    expect(out.cells.map((c) => c.role)).toEqual(["anneal", "anneal", "mismatch", "anneal", "anneal"]);
    expect(out.cells[2].column).toBe(2);
  });
});

describe("layoutPrimerBases — reverse primer", () => {
  it("orders 5'->3' right-to-left over the annealed region", () => {
    // anneals to the bottom strand at forward [2, 6); 3' end pairs with col 2.
    const s = site({ start: 2, end: 6, direction: -1, annealedLength: 4 });
    const out = layoutPrimerBases("ACGT", s)!;
    expect(out.direction).toBe(-1);
    expect(out.tailLength).toBe(0);
    // oligo 5' end (i=0) lands on the RIGHT (col 5); 3' end (i=3) on the LEFT (col 2).
    expect(out.cells.map((c) => c.column)).toEqual([5, 4, 3, 2]);
    expect(out.cells.map((c) => c.role)).toEqual(["anneal", "anneal", "anneal", "anneal"]);
  });

  it("places a reverse 5' tail to the RIGHT of the annealed region", () => {
    // L=6, anneals at forward [2, 6) (4 bases), 2-base 5' tail.
    const s = site({ start: 2, end: 6, direction: -1, annealedLength: 4 });
    const out = layoutPrimerBases("TTACGT", s)!;
    expect(out.tailLength).toBe(2);
    // tail (oligo 0..1) to the right of the annealed region (cols 7, 6).
    expect(out.cells.slice(0, 2).map((c) => c.column)).toEqual([7, 6]);
    expect(out.cells.slice(0, 2).map((c) => c.role)).toEqual(["tail", "tail"]);
    // annealed (oligo 2..5) over cols 5..2.
    expect(out.cells.slice(2).map((c) => c.column)).toEqual([5, 4, 3, 2]);
  });

  it("flags reverse mismatch columns by forward position", () => {
    const s = site({ start: 2, end: 6, direction: -1, annealedLength: 4, fullMatch: false, mismatches: [4] });
    const out = layoutPrimerBases("ACGT", s)!;
    // column 4 is oligo index 1 (cols are [5,4,3,2]).
    expect(out.cells[1].role).toBe("mismatch");
    expect(out.cells[0].role).toBe("anneal");
  });
});

describe("layoutPrimerBases — guards", () => {
  it("returns null when the annealed length exceeds the oligo length", () => {
    const s = site({ start: 0, end: 10, direction: 1, annealedLength: 10 });
    expect(layoutPrimerBases("ATGC", s)).toBeNull();
  });

  it("returns null for a zero-length annealed region", () => {
    const s = site({ start: 0, end: 0, direction: 1, annealedLength: 0 });
    expect(layoutPrimerBases("ATGC", s)).toBeNull();
  });

  it("covers every oligo base exactly once", () => {
    const s = site({ start: 4, end: 8, direction: 1, annealedLength: 4 });
    const out = layoutPrimerBases("GGGGATGC", s)!;
    expect(out.cells.map((c) => c.oligoIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
