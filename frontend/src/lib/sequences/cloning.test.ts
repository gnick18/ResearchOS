// cloning bot — UNIT TESTS for the pure overlap-assembly engine.
//
// Correctness-critical molecular biology: a wrong product is a real bug. Each
// test INDEPENDENTLY reconstructs the expected product sequence and primers
// (without calling into the engine's internals) and asserts the engine agrees.

import { describe, it, expect } from "vitest";
import {
  assembleGibson,
  rebaseFeatures,
  DEFAULT_OVERLAP_BP,
  type Fragment,
} from "./cloning";
import { reverseComplement } from "./primer";

// Deterministic pseudo-random DNA so tests are stable but not trivially periodic.
function dna(len: number, seed: number): string {
  const A = "ACGT";
  let x = seed >>> 0;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += A[(x >>> 8) % 4];
  }
  return out;
}

describe("assembleGibson — product sequence", () => {
  it("2-fragment linear join: product = A + B, length = lenA + lenB, no overlap duplication", () => {
    const a = dna(200, 1);
    const b = dna(180, 2);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false, overlap: { kind: "length", bp: 25 } },
    );
    // Independently reconstruct: the seamless product is the bodies concatenated;
    // the homology lives ONCE at the seam, so the length is the simple sum.
    expect(res.product.seq).toBe(a + b);
    expect(res.product.seq.length).toBe(a.length + b.length);
    expect(res.product.circular).toBe(false);
    // The boundary base count is exact (no dropped / duplicated overlap bases).
    expect(res.product.seq.slice(0, a.length)).toBe(a);
    expect(res.product.seq.slice(a.length)).toBe(b);
    expect(res.warnings).toHaveLength(0);
  });

  it("3-fragment linear join: product = A + B + C, exact length, two junctions", () => {
    const a = dna(150, 11);
    const b = dna(120, 22);
    const c = dna(140, 33);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
        { name: "C", seq: c },
      ],
      { circular: false },
    );
    expect(res.product.seq).toBe(a + b + c);
    expect(res.product.seq.length).toBe(a.length + b.length + c.length);
    // Linear: n-1 = 2 junctions.
    expect(res.junctions).toHaveLength(2);
    expect(res.junctions[0]).toMatchObject({ fragmentIndex: 0, nextFragmentIndex: 1 });
    expect(res.junctions[1]).toMatchObject({ fragmentIndex: 1, nextFragmentIndex: 2 });
  });

  it("circular assembly (insert + vector): product closes the loop, length is the sum, flagged circular", () => {
    const insert = dna(300, 7);
    const vector = dna(2500, 8);
    const res = assembleGibson(
      [
        { name: "insert", seq: insert },
        { name: "vector", seq: vector },
      ],
      { circular: true, overlap: { kind: "length", bp: 30 } },
    );
    // Circular product string is still the concatenation; the loop closes the
    // last->first junction. Length = sum of bodies (homology counted once).
    expect(res.product.seq).toBe(insert + vector);
    expect(res.product.seq.length).toBe(insert.length + vector.length);
    expect(res.product.circular).toBe(true);
    // Circular: n junctions (1->2 and the closing 2->1).
    expect(res.junctions).toHaveLength(2);
    expect(res.junctions[1]).toMatchObject({ fragmentIndex: 1, nextFragmentIndex: 0 });
  });
});

describe("assembleGibson — junction primers", () => {
  it("forward primer = 5' homology tail (upstream 3' end) + 3' annealing region (own 5' end)", () => {
    const a = dna(200, 101);
    const b = dna(200, 202);
    const overlap = 25;
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false, overlap: { kind: "length", bp: overlap } },
    );
    const pB = res.primers[1]; // fragment B
    // B's forward primer tail must be A's last `overlap` bases (the homology that
    // bridges the A|B junction onto B's amplicon).
    const expectedTail = a.slice(a.length - overlap);
    expect(pB.forward.tail).toBe(expectedTail);
    // The annealing region must be a prefix of B (B's own 5' end), and the full
    // oligo is tail + anneal.
    expect(b.startsWith(pB.forward.anneal)).toBe(true);
    expect(pB.forward.sequence).toBe(pB.forward.tail + pB.forward.anneal);
    expect(pB.forward.length).toBe(pB.forward.sequence.length);
    // The fragment's amplicon (forward primer + ... ) thus begins with A's
    // homology then B — i.e. the amplicon left end == A's right end. Verify the
    // tail equals the junction overlap sequence.
    expect(pB.forward.tail).toBe(res.junctions[0].overlapSeq);
  });

  it("reverse primer = 5' homology tail (revcomp of downstream 5' end) + 3' annealing region (revcomp of own 3' end)", () => {
    const a = dna(200, 303);
    const b = dna(200, 404);
    const overlap = 25;
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false, overlap: { kind: "length", bp: overlap } },
    );
    const pA = res.primers[0]; // fragment A's reverse primer carries the A|B homology
    // A's reverse primer tail = revcomp of B's first `overlap` bases.
    const expectedTail = reverseComplement(b.slice(0, overlap));
    expect(pA.reverse.tail).toBe(expectedTail);
    // The annealing region is the revcomp of A's own 3'-terminal bases (so the
    // primer anneals to A's bottom strand and extends leftward).
    const annealTemplate = reverseComplement(pA.reverse.anneal);
    expect(a.endsWith(annealTemplate)).toBe(true);
    expect(pA.reverse.sequence).toBe(pA.reverse.tail + pA.reverse.anneal);
  });

  it("annealing region is sized to reach the Tm target (~60 C) within the length window", () => {
    const a = dna(200, 55);
    const b = dna(200, 66);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false, annealTargetTm: 60, annealMinBp: 18, annealMaxBp: 36 },
    );
    for (const p of res.primers) {
      expect(p.forward.anneal.length).toBeGreaterThanOrEqual(18);
      expect(p.forward.anneal.length).toBeLessThanOrEqual(36);
      // Tm should be a finite number (NN model applies for >= 8 nt unambiguous).
      expect(Number.isFinite(p.forward.annealTm)).toBe(true);
    }
  });

  it("circular: the closing junction's homology lands on fragment 0's forward primer and the last fragment's reverse primer", () => {
    const insert = dna(120, 71);
    const vector = dna(900, 72);
    const overlap = 30;
    const res = assembleGibson(
      [
        { name: "insert", seq: insert },
        { name: "vector", seq: vector },
      ],
      { circular: true, overlap: { kind: "length", bp: overlap } },
    );
    // Closing junction is vector(1) -> insert(0). Its homology:
    //   - insert's FORWARD primer tail = vector's last `overlap` bases.
    //   - vector's REVERSE primer tail = revcomp(insert's first `overlap` bases).
    expect(res.primers[0].forward.tail).toBe(vector.slice(vector.length - overlap));
    expect(res.primers[1].reverse.tail).toBe(reverseComplement(insert.slice(0, overlap)));
    // And the internal junction insert(0) -> vector(1):
    //   - vector's FORWARD primer tail = insert's last `overlap` bases.
    //   - insert's REVERSE primer tail = revcomp(vector's first `overlap` bases).
    expect(res.primers[1].forward.tail).toBe(insert.slice(insert.length - overlap));
    expect(res.primers[0].reverse.tail).toBe(reverseComplement(vector.slice(0, overlap)));
  });
});

describe("assembleGibson — features carried + rebased", () => {
  it("carries features from each fragment, rebased to product coordinates", () => {
    const a = dna(100, 9);
    const b = dna(80, 10);
    const res = assembleGibson(
      [
        {
          name: "A",
          seq: a,
          features: [{ name: "promA", start: 10, end: 30, strand: 1, type: "promoter" }],
        },
        {
          name: "B",
          seq: b,
          features: [{ name: "cdsB", start: 5, end: 50, strand: 1, type: "CDS" }],
        },
      ],
      { circular: false },
    );
    // A's feature keeps its coordinates (offset 0).
    const promA = res.product.features.find((f) => f.name === "promA");
    expect(promA).toMatchObject({ start: 10, end: 30, type: "promoter" });
    // The bases under the rebased feature equal the original fragment slice.
    expect(res.product.seq.slice(promA!.start, promA!.end)).toBe(a.slice(10, 30));

    // B's feature shifts by len(A) = 100.
    const cdsB = res.product.features.find((f) => f.name === "cdsB");
    expect(cdsB).toMatchObject({ start: 105, end: 150, type: "CDS" });
    expect(res.product.seq.slice(cdsB!.start, cdsB!.end)).toBe(b.slice(5, 50));
  });

  it("3-fragment feature rebasing matches an independent cumulative-offset reconstruction", () => {
    const a = dna(60, 1);
    const b = dna(70, 2);
    const c = dna(50, 3);
    const fa: Fragment = { name: "A", seq: a, features: [{ name: "fA", start: 0, end: 10, strand: 1 }] };
    const fb: Fragment = { name: "B", seq: b, features: [{ name: "fB", start: 20, end: 40, strand: -1 }] };
    const fc: Fragment = { name: "C", seq: c, features: [{ name: "fC", start: 5, end: 25, strand: 1 }] };
    const res = assembleGibson([fa, fb, fc], { circular: false });

    // Independent reconstruction of expected absolute coordinates.
    const expected = [
      { name: "fA", start: 0, end: 10 },
      { name: "fB", start: 60 + 20, end: 60 + 40 },
      { name: "fC", start: 130 + 5, end: 130 + 25 },
    ];
    for (const e of expected) {
      const got = res.product.features.find((f) => f.name === e.name);
      expect(got).toMatchObject({ start: e.start, end: e.end });
    }
  });

  it("rebaseFeatures is a pure additive shift and does not mutate the input", () => {
    const input = [{ name: "x", start: 5, end: 15, strand: 1 as const }];
    const out = rebaseFeatures(input, 100);
    expect(out[0]).toMatchObject({ start: 105, end: 115 });
    expect(input[0]).toMatchObject({ start: 5, end: 15 }); // untouched
  });
});

describe("assembleGibson — warnings + edge cases", () => {
  it("warns when fewer than two fragments are supplied", () => {
    const res = assembleGibson([{ name: "solo", seq: dna(100, 1) }], { circular: false });
    expect(res.warnings.join(" ")).toMatch(/at least two fragments/i);
  });

  it("no feasible overlap: a fragment too short for the homology shortens the overlap and warns", () => {
    const a = dna(200, 1);
    const tiny = dna(10, 2); // 10 bp, shorter than the 25 bp requested overlap
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "tiny", seq: tiny },
      ],
      { circular: false, overlap: { kind: "length", bp: 25 } },
    );
    // The overlap is capped to the short fragment's length.
    expect(res.junctions[0].overlapBp).toBe(10);
    expect(res.junctions[0].warning).toMatch(/shortened/i);
  });

  it("empty fragment yields a zero-overlap junction with a clear warning", () => {
    const a = dna(100, 1);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "empty", seq: "" },
      ],
      { circular: false },
    );
    expect(res.warnings.join(" ")).toMatch(/empty/i);
    expect(res.junctions[0].overlapBp).toBe(0);
  });

  it("non-ACGT characters are dropped and flagged", () => {
    const res = assembleGibson(
      [
        { name: "A", seq: "ACGTACGTACGTNNNNACGTACGT" },
        { name: "B", seq: dna(100, 5) },
      ],
      { circular: false },
    );
    expect(res.warnings.join(" ")).toMatch(/non-ACGT/i);
    // The cleaned product must contain no N.
    expect(res.product.seq.includes("N")).toBe(false);
  });

  it("ambiguous assembly: two junctions sharing an identical overlap are flagged", () => {
    // Build A, B, C such that A's 3' end == B's 3' end (so junction overlaps match).
    const tail = dna(25, 1);
    const a = dna(100, 2) + tail;
    const b = dna(100, 3) + tail;
    const c = dna(100, 4);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
        { name: "C", seq: c },
      ],
      { circular: false, overlap: { kind: "length", bp: 25 } },
    );
    expect(res.warnings.join(" ")).toMatch(/ambiguous/i);
  });
});

describe("assembleGibson — Tm-sized overlap mode", () => {
  it("grows the overlap until its Tm reaches the target", () => {
    const a = dna(300, 12);
    const b = dna(300, 13);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false, overlap: { kind: "tm", targetTm: 55, minBp: 15, maxBp: 60 } },
    );
    const jn = res.junctions[0];
    // The overlap sequence must be A's 3'-terminal `overlapBp` bases.
    expect(jn.overlapSeq).toBe(a.slice(a.length - jn.overlapBp));
    // Either Tm reached the target, or we hit the max length.
    expect(jn.overlapTm >= 55 || jn.overlapBp === 60).toBe(true);
  });
});

describe("default overlap", () => {
  it("defaults to ~25 bp when no overlap mode is given", () => {
    const a = dna(200, 1);
    const b = dna(200, 2);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false },
    );
    expect(res.junctions[0].overlapBp).toBe(DEFAULT_OVERLAP_BP);
  });
});
