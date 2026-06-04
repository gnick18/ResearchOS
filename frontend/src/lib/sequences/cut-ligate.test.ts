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
