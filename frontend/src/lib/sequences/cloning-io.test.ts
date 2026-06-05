// cloning bot — tests for the IO adapter (coordinate translation + GenBank
// round-trip + oligo list).

import { describe, it, expect } from "vitest";
import { genbankToJson } from "@/vendor/bio-parsers";
import {
  annotationsToCloneFeatures,
  productToGenbank,
  productToDetail,
  oligoOrderText,
} from "./cloning-io";
import { assembleGibson } from "./cloning";

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

describe("annotationsToCloneFeatures", () => {
  it("converts inclusive-end annotations to exclusive-end clone features", () => {
    const feats = annotationsToCloneFeatures([
      { name: "cds", start: 10, end: 29, direction: 1, type: "CDS" },
      { name: "rev", start: 5, end: 5, direction: -1 },
    ]);
    // inclusive 10..29 -> exclusive [10, 30)
    expect(feats[0]).toMatchObject({ name: "cds", start: 10, end: 30, strand: 1 });
    // inclusive 5..5 (one base) -> exclusive [5, 6)
    expect(feats[1]).toMatchObject({ name: "rev", start: 5, end: 6, strand: -1 });
  });
});

describe("productToGenbank round-trip", () => {
  it("serializes the product so its bases and rebased features re-parse correctly", () => {
    const a = dna(120, 1);
    const b = dna(100, 2);
    const res = assembleGibson(
      [
        { name: "A", seq: a, features: [{ name: "promA", start: 10, end: 30, strand: 1, type: "promoter" }] },
        { name: "B", seq: b, features: [{ name: "cdsB", start: 5, end: 50, strand: 1, type: "CDS" }] },
      ],
      { circular: true },
    );
    const gb = productToGenbank("myConstruct", res.product);
    const parsed = genbankToJson(gb, {}).find((r) => r.success)?.parsedSequence;
    expect(parsed).toBeTruthy();
    // Bases survive the round-trip exactly.
    expect(parsed!.sequence.toUpperCase()).toBe(res.product.seq);
    expect(parsed!.circular).toBe(true);
    // The promoter re-parses at the same span (engine exclusive [10,30) ->
    // GenBank inclusive 10..29 -> re-parsed inclusive start 10, end 29).
    const prom = parsed!.features.find((f) => f.name === "promA");
    expect(prom).toBeTruthy();
    expect(prom!.start).toBe(10);
    expect(prom!.end).toBe(29);
    // cdsB shifted by len(A)=120: engine [125,170) -> inclusive 125..169.
    const cds = parsed!.features.find((f) => f.name === "cdsB");
    expect(cds!.start).toBe(125);
    expect(cds!.end).toBe(169);
  });

  it("optionally appends primer_bind features at the annealing spans", () => {
    const a = dna(150, 3);
    const b = dna(150, 4);
    const res = assembleGibson(
      [
        { name: "A", seq: a },
        { name: "B", seq: b },
      ],
      { circular: false },
    );
    const gb = productToGenbank("c", res.product, { primersAsFeatures: res.primers });
    // The reader sorts primer_bind features into `primers` unless
    // primersAsFeatures is passed; ask for them as features to inspect spans.
    const parsed = genbankToJson(gb, { primersAsFeatures: true }).find((r) => r.success)?.parsedSequence;
    const primerBinds = (parsed!.features ?? []).filter((f) => f.type === "primer_bind");
    // 2 fragments x (forward + reverse) = up to 4 primer_bind features.
    expect(primerBinds.length).toBeGreaterThanOrEqual(2);
    // Each primer_bind's span on the product should match its primer's anneal
    // length (inclusive end => length = end - start + 1).
    for (const pb of primerBinds) {
      expect(pb.end - pb.start + 1).toBeGreaterThanOrEqual(18);
    }
  });
});

describe("productToGenbank — linear overlap round-trip", () => {
  it("serializes a LINEAR assembled product so bases and features re-parse correctly", () => {
    const a = dna(100, 5);
    const b = dna(80, 6);
    const res = assembleGibson(
      [
        { name: "X", seq: a, features: [{ name: "termX", start: 2, end: 20, strand: -1, type: "terminator" }] },
        { name: "Y", seq: b, features: [{ name: "cdsY", start: 10, end: 40, strand: 1, type: "CDS" }] },
      ],
      { circular: false },
    );
    expect(res.product.circular).toBe(false);
    const gb = productToGenbank("linearConstruct", res.product);
    const parsed = genbankToJson(gb, {}).find((r) => r.success)?.parsedSequence;
    expect(parsed).toBeTruthy();
    expect(parsed!.sequence.toUpperCase()).toBe(res.product.seq);
    expect(parsed!.circular).toBeFalsy();
    // termX at [2,20) in fragment X => stays at [2,20) in the linear product (X is first).
    const term = parsed!.features.find((f) => f.name === "termX");
    expect(term).toBeTruthy();
    expect(term!.start).toBe(2);
    expect(term!.end).toBe(19); // exclusive 20 -> inclusive 19
    expect(term!.strand).toBe(-1);
    // cdsY at [10,40) in fragment Y (len=100) => shifted by 100 to [110,140).
    const cds = parsed!.features.find((f) => f.name === "cdsY");
    expect(cds).toBeTruthy();
    expect(cds!.start).toBe(110);
    expect(cds!.end).toBe(139); // exclusive 140 -> inclusive 139
  });
});

describe("productToDetail", () => {
  it("builds a renderable detail with the product bases, topology, and rebased features", () => {
    const a = dna(120, 1);
    const b = dna(100, 2);
    const res = assembleGibson(
      [
        { name: "A", seq: a, features: [{ name: "promA", start: 10, end: 30, strand: 1, type: "promoter" }] },
        { name: "B", seq: b, features: [{ name: "cdsB", start: 5, end: 50, strand: 1, type: "CDS" }] },
      ],
      { circular: true },
    );
    const detail = productToDetail("myConstruct", res.product);
    expect(detail).toBeTruthy();
    // Bases + topology match the assembled product exactly.
    expect(detail!.seq).toBe(res.product.seq);
    expect(detail!.circular).toBe(true);
    // The synthetic meta marks this as an unsaved preview.
    expect(detail!.id).toBe(-1);
    expect(detail!.display_name).toBe("myConstruct");
    expect(detail!.seq_type).toBe("dna");
    // Annotations carry the rebased features at the read-view (inclusive-end)
    // coordinates: promA stays at 10..29; cdsB shifts by len(A)=120 to 125..169.
    const prom = detail!.annotations.find((f) => f.name === "promA");
    expect(prom).toBeTruthy();
    expect(prom!.start).toBe(10);
    expect(prom!.end).toBe(29);
    expect(prom!.direction).toBe(1);
    const cds = detail!.annotations.find((f) => f.name === "cdsB");
    expect(cds).toBeTruthy();
    expect(cds!.start).toBe(125);
    expect(cds!.end).toBe(169);
  });

  it("falls back to a default name when given an empty name", () => {
    const res = assembleGibson(
      [
        { name: "A", seq: dna(150, 3) },
        { name: "B", seq: dna(150, 4) },
      ],
      { circular: false },
    );
    // Passing primers serializes them as primer_bind features in the GenBank;
    // the read path routes those into the SeqViz primers layer (not annotations),
    // which is exactly how a saved sequence renders its primers.
    const detail = productToDetail("", res.product, { primersAsFeatures: res.primers });
    expect(detail).toBeTruthy();
    expect(detail!.display_name).toBe("Assembled construct");
    expect(detail!.circular).toBe(false);
    expect(detail!.seq).toBe(res.product.seq);
  });
});

describe("oligoOrderText", () => {
  it("produces a tab-delimited list with a header and 2 rows per fragment", () => {
    const res = assembleGibson(
      [
        { name: "frag1", seq: dna(120, 1) },
        { name: "frag2", seq: dna(120, 2) },
      ],
      { circular: false },
    );
    const text = oligoOrderText(res.primers);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/Name\tSequence/);
    // header + 2 fragments * 2 primers = 5 lines
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(/^frag1 F\t/);
    expect(lines[2]).toMatch(/^frag1 R\t/);
  });
});
