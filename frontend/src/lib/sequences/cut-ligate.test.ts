// cloning bot — UNIT TESTS for the cut-and-ligate engine mechanics (digestion
// geometry, end typing, ligation rules). The INDEPENDENT pydna cross-validation
// lives in cut-ligate.golden.test.ts; this file pins the internal biology with
// hand-reasoned expectations so a geometry regression is caught even without
// re-running the oracle.

import { describe, it, expect } from "vitest";
import {
  cutAndLigate,
  digestFragment,
  canonicalCircular,
  canonicalLinear,
  type LigateFragment,
} from "./cut-ligate";
import enzymes from "../../vendor/seqviz/enzymes";
import type { Enzyme } from "../../vendor/seqviz/elements";

const enz = (name: string) => (enzymes as Record<string, Enzyme>)[name.toLowerCase()];

describe("digestFragment — sticky-end geometry (EcoRI G^AATTC)", () => {
  it("cuts a single EcoRI site into two pieces, each with a 5' AATT overhang", () => {
    // EcoRI GAATTC, fcut=1 (G^AATTC), rcut=5 -> 4-nt 5' AATT overhang.
    const frag: LigateFragment = { name: "f", seq: "TTTGAATTCAAA" };
    const pieces = digestFragment(frag, [enz("ecori")]);
    expect(pieces).toHaveLength(2);
    // Left piece: original left end (blunt/original), enzyme 5' overhang on the right.
    expect(pieces[0].left).toMatchObject({ kind: "blunt", original: true });
    expect(pieces[0].right.kind).toBe("5overhang");
    // Right piece: enzyme 5' overhang on the left, original right end.
    expect(pieces[1].left.kind).toBe("5overhang");
    expect(pieces[1].right).toMatchObject({ kind: "blunt", original: true });
    // The two enzyme ends are complementary (AATT is self-complementary).
    expect(pieces[0].right.overhang).toBe("AATT");
    expect(pieces[1].left.overhang).toBe("AATT");
  });
});

describe("digestFragment — 3' overhang (PstI CTGCA^G) and blunt (SmaI CCC^GGG)", () => {
  it("PstI leaves a 3' overhang", () => {
    const pieces = digestFragment({ name: "f", seq: "TTTCTGCAGAAA" }, [enz("psti")]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].right.kind).toBe("3overhang");
    expect(pieces[1].left.kind).toBe("3overhang");
  });

  it("SmaI leaves a blunt end", () => {
    const pieces = digestFragment({ name: "f", seq: "TTTCCCGGGAAA" }, [enz("smai")]);
    expect(pieces).toHaveLength(2);
    // The internal enzyme ends are blunt (and NOT original termini).
    expect(pieces[0].right.kind).toBe("blunt");
    expect(pieces[0].right.original).toBeFalsy();
    expect(pieces[1].left.kind).toBe("blunt");
    expect(pieces[1].left.original).toBeFalsy();
  });
});

describe("cutAndLigate — restriction self-circularization sanity", () => {
  it("a linear fragment with two EcoRI sites re-circularizes via its enzyme ends", () => {
    // Two EcoRI sites; the middle piece (both ends AATT) closes into a circle.
    const res = cutAndLigate([{ name: "f", seq: "ttGAATTCaaacccgggtttGAATTCtt" }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    // The middle piece self-circularizes; its single junction overhang is AATT.
    const circle = res.products.find((p) => p.circular);
    expect(circle).toBeTruthy();
    expect(circle!.junctionOverhangs.every((o) => o === canonicalLinear("AATT"))).toBe(true);
  });

  it("original (uncut) ends never ligate: a single-cut linear fragment yields no circle", () => {
    // One EcoRI site -> two pieces, each with one original end + one enzyme end.
    // Neither piece can self-circularize (original end is non-ligatable), and the
    // two enzyme ends are on different pieces but each also has an original end,
    // so no all-enzyme-end circle exists.
    const res = cutAndLigate([{ name: "f", seq: "ttttttGAATTCtttttt" }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    expect(res.products.filter((p) => p.circular)).toHaveLength(0);
  });
});

describe("cutAndLigate — Golden Gate discards recognition flanks", () => {
  it("keeps only the central non-recognition pieces", () => {
    const part = "ttGGTCTCaAATGcatcatcatGGTTtGAGACCtt";
    const res = cutAndLigate([{ name: "p", seq: part }], {
      enzymeNames: ["bsai"],
      mode: "golden-gate",
      circularOnly: false,
      allowBlunt: false,
    });
    // The kept piece carries no BsaI recognition site.
    for (const p of res.pieces) {
      expect(p.hasSite).toBe(false);
      expect(p.seq.includes("GGTCTC")).toBe(false);
    }
  });
});

describe("cutAndLigate — warnings", () => {
  it("flags an unknown enzyme name", () => {
    const res = cutAndLigate([{ name: "f", seq: "ACGTACGT" }], {
      enzymeNames: ["notareal"],
      mode: "restriction",
    });
    expect(res.warnings.join(" ")).toMatch(/unknown enzyme/i);
  });

  it("flags when no ligatable product forms", () => {
    // Two fragments cut by enzymes that leave incompatible overhangs.
    const res = cutAndLigate(
      [
        { name: "a", seq: "ttGAATTCtt" }, // EcoRI AATT
        { name: "b", seq: "ttGGTACCtt" }, // KpnI GTAC (3' overhang, incompatible)
      ],
      { enzymeNames: ["ecori", "kpni"], mode: "restriction", circularOnly: true, allowBlunt: false },
    );
    expect(res.warnings.join(" ")).toMatch(/no assembled product|no ligatable/i);
  });
});

describe("canonicalCircular — documented rotation+strand normalization", () => {
  it("equal molecules under rotation collapse", () => {
    const s = "ATGCATGCATGC";
    for (let i = 0; i < s.length; i += 1) {
      const rot = s.slice(i) + s.slice(0, i);
      expect(canonicalCircular(rot)).toBe(canonicalCircular(s));
    }
  });
});

// ---------------------------------------------------------------------------
// Feature rebasing tests
// ---------------------------------------------------------------------------

describe("cutAndLigate — feature rebasing into assembled products", () => {
  // Design: fragment A has two EcoRI sites framing a body with a known feature.
  // EcoRI cuts G^AATTC: topCut = site+1, bottomCut = site+5 => L = site+1, R = site+5.
  // Piece seq spans [L_left, R_right). For a linear fragment:
  //   piece 0: [0, R_0)           original left, AATT right overhang
  //   piece 1: [L_0, R_1)         AATT left overhang, AATT right overhang  <-- kept
  //   piece 2: [L_1, n)           AATT left overhang, original right
  //
  // We place a feature INSIDE the middle piece body so it survives into the
  // self-circularized product.
  //
  // Fragment layout (0-based):
  //   0123456789...
  //   AAAGAATTCBBBBBBBBGAATTCCCC
  //   ^^^        ^^^   = EcoRI sites at positions 3 and 17
  //   Site 0 at pos 3: topCut=4, bottomCut=8, L=4, R=8
  //   Site 1 at pos 17: topCut=18, bottomCut=22, L=18, R=22
  //   Middle piece body: seq[4..22) = "AATTCBBBBBBBBG" (18 bases, includes both overhangs)
  //   Middle piece sourceStart = 4
  //   Feature "cds" at [9, 17) in the fragment => inside [4, 22)
  //   After self-circularization the middle piece closes on itself:
  //     circular product = piece.seq.slice(4) (strip leading AATT=4 bases)
  //     = "CBBBBBBBBG" (10 bases, but wait...)
  //   Let me recompute: piece seq = "AATTCBBBBBBBBG" (L_0=4 to R_1=22 => 18 bases)
  //   Self-circularized: strip first chain[0].left.overhang.length = 4 bases from front
  //   out = "AATTCBBBBBBBBG".slice(4) = "CBBBBBBBBG" => 10 bases
  //   Then canonicalCircular("CBBBBBBBBG").
  //
  // Feature "cds" at source [9,17): within [4,22).
  //   productOffset for piece 0 = 0 - circularLeadStrip(4) = -4.
  //   Rebased: start = 9 - 4 + (-4) = 1, end = 17 - 4 + (-4) = 9.
  //   Clamped to [0, 10): start=1, end=9. Valid.
  //   In canonical form the product may be rotated, so we check the feature's
  //   presence and that it has correct width (9-1=8 = 17-9=8 in source).

  it("features from a forward piece survive EcoRI self-circularization", () => {
    // fragment: AAA GAATTC BBBBBBBB GAATTC CCC
    //           000 3      9        17     23
    // 'B' = ACGT repeating for non-ambiguous DNA
    const body = "ACGTACGT"; // 8 bases as the internal body
    const frag: LigateFragment = {
      name: "ins",
      seq: "AAAGAATTC" + body + "GAATTCCCC",
      features: [
        // Feature sits at [9, 17) = the "BBBBBBBB" body (entirely within the middle piece [4,22))
        { name: "cds", start: 9, end: 17, strand: 1, type: "CDS" },
      ],
    };
    const res = cutAndLigate([frag], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const circle = res.products.find((p) => p.circular);
    expect(circle).toBeTruthy();
    // The product should carry exactly one feature named "cds".
    const feat = circle!.features.find((f) => f.name === "cds");
    expect(feat).toBeTruthy();
    // The feature width must be preserved: source width = 17-9 = 8 bases.
    expect(feat!.end - feat!.start).toBe(8);
    // Strand must be preserved (forward).
    expect(feat!.strand).toBe(1);
    // Feature must be within the product bounds.
    expect(feat!.start).toBeGreaterThanOrEqual(0);
    expect(feat!.end).toBeLessThanOrEqual(circle!.seq.length);
  });

  it("two-fragment restriction ligation carries features from both fragments", () => {
    // Design: two fragments each flanked by EcoRI sites (GAATTC, 4-nt 5' AATT overhang).
    // Use DIFFERENT interior sequences so the two-piece circle is distinct from
    // single-piece self-circularization, and EcoRI's AATT palindrome means all
    // AATT-overhang pieces can ligate. We look for the product that contains both
    // features by checking features of every circular product.
    //
    // Fragment A: XGAATTC + body_A + GAATTCY
    // Fragment B: XGAATTC + body_B + GAATTCY
    // EcoRI: fcut=1, rcut=5, L=site+1, R=site+5 => AATT overhang.
    // Middle piece A: sourceStart = site0.L = 1 (for site at pos 0),
    //   but we pad with extra bases: TTTGAATTC + AAAAAAAAAA + GAATTCCCC
    //   Site 0 at 3: L=4, R=8. Site 1 at 19: L=20, R=24.
    //   Middle piece: seq[4..24) = 20 bases. sourceStart=4.
    //   feature "featA" at [9, 19) = the 10 A's. Within [4, 24). Width=10.
    //
    // We find the product whose features array contains BOTH "featA" and "featB".
    const fragA: LigateFragment = {
      name: "A",
      seq: "TTTGAATTC" + "AAAAAAAAAA" + "GAATTCCCC",
      features: [{ name: "featA", start: 9, end: 19, strand: 1, type: "misc_feature" }],
    };
    // Use distinct non-self-complementary body to help identify the two-piece product.
    const fragB: LigateFragment = {
      name: "B",
      seq: "TTTGAATTC" + "CCCCCCCCCC" + "GAATTCGGG",
      features: [{ name: "featB", start: 9, end: 19, strand: -1, type: "misc_feature" }],
    };
    const res = cutAndLigate([fragA, fragB], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    // There may be several circular products (orientation-ambiguous AATT); find the
    // one that contains BOTH features.
    const circle = res.products.find(
      (p) => p.circular && p.features.some((f) => f.name === "featA") && p.features.some((f) => f.name === "featB"),
    );
    expect(circle).toBeTruthy();
    const fa = circle!.features.find((f) => f.name === "featA");
    const fb = circle!.features.find((f) => f.name === "featB");
    expect(fa).toBeTruthy();
    expect(fb).toBeTruthy();
    // Feature widths preserved: both are 10 bases in source.
    expect(fa!.end - fa!.start).toBe(10);
    expect(fb!.end - fb!.start).toBe(10);
    // Strand preservation.
    expect(fa!.strand).toBe(1);
    expect(fb!.strand).toBe(-1);
    // Both features within product bounds.
    expect(fa!.start).toBeGreaterThanOrEqual(0);
    expect(fa!.end).toBeLessThanOrEqual(circle!.seq.length);
    expect(fb!.start).toBeGreaterThanOrEqual(0);
    expect(fb!.end).toBeLessThanOrEqual(circle!.seq.length);
  });

  it("features outside the kept piece window are dropped", () => {
    // A feature that lies in the discarded flank (outside the enzyme-cut window)
    // should not appear in the product.
    const frag: LigateFragment = {
      name: "ins",
      seq: "AAAGAATTC" + "ACGTACGT" + "GAATTCCCC",
      features: [
        // Feature sits in the left discarded flank [0,3) -- entirely outside the middle piece.
        { name: "flankFeat", start: 0, end: 3, strand: 1 },
        // Feature sits inside the middle piece body [9,17).
        { name: "bodyFeat", start: 9, end: 17, strand: 1 },
      ],
    };
    const res = cutAndLigate([frag], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const circle = res.products.find((p) => p.circular);
    expect(circle).toBeTruthy();
    // "flankFeat" is in the discarded flank piece, not the ligated middle piece.
    // It should not appear in the product.
    expect(circle!.features.find((f) => f.name === "flankFeat")).toBeUndefined();
    // "bodyFeat" is in the middle piece and should survive.
    expect(circle!.features.find((f) => f.name === "bodyFeat")).toBeTruthy();
  });

  it("LigationProduct.features is an empty array when no fragment has features", () => {
    const res = cutAndLigate([{ name: "f", seq: "ttGAATTCaaacccgggtttGAATTCtt" }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const circle = res.products.find((p) => p.circular);
    expect(circle).toBeTruthy();
    expect(Array.isArray(circle!.features)).toBe(true);
    expect(circle!.features).toHaveLength(0);
  });
});

describe("cutAndLigate — fragment spans", () => {
  it("a two-fragment circle carries one span per piece with the right sourceName", () => {
    // Same construction as the two-fragment feature test: two distinct middle
    // pieces from fragments A and B circularize via their AATT overhangs.
    const fragA: LigateFragment = {
      name: "A",
      seq: "TTTGAATTC" + "AAAAAAAAAA" + "GAATTCCCC",
    };
    const fragB: LigateFragment = {
      name: "B",
      seq: "TTTGAATTC" + "CCCCCCCCCC" + "GAATTCGGG",
    };
    const res = cutAndLigate([fragA, fragB], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    // The two-piece circle uses both A's and B's middle pieces.
    const circle = res.products.find(
      (p) =>
        p.circular &&
        p.fragmentSpans.some((s) => s.name === "A") &&
        p.fragmentSpans.some((s) => s.name === "B"),
    );
    expect(circle).toBeTruthy();
    expect(circle!.fragmentSpans).toHaveLength(2);
    // Every span carries a known sourceName, lies within product bounds, has a
    // valid strand, and is a non-empty contiguous run.
    for (const sp of circle!.fragmentSpans) {
      expect(["A", "B"]).toContain(sp.name);
      expect(sp.start).toBeGreaterThanOrEqual(0);
      expect(sp.end).toBeLessThanOrEqual(circle!.seq.length);
      expect(sp.end).toBeGreaterThan(sp.start);
      expect([1, -1]).toContain(sp.strand);
    }
  });

  it("a single fragment cut into multiple pieces emits one span per piece (same sourceName)", () => {
    // Two EcoRI sites in one fragment -> the middle piece self-circularizes; that
    // single-piece product has exactly one span labeled by the source fragment.
    const res = cutAndLigate([{ name: "solo", seq: "ttGAATTCaaacccgggtttGAATTCtt" }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const circle = res.products.find((p) => p.circular);
    expect(circle).toBeTruthy();
    expect(circle!.fragmentSpans.length).toBeGreaterThanOrEqual(1);
    for (const sp of circle!.fragmentSpans) {
      expect(sp.name).toBe("solo");
      expect(sp.end).toBeGreaterThan(sp.start);
    }
  });
});
