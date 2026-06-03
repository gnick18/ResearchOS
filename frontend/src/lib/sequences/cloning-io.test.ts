// cloning bot — tests for the IO adapter (coordinate translation + GenBank
// round-trip + oligo list).

import { describe, it, expect } from "vitest";
import { genbankToJson } from "@/vendor/bio-parsers";
import {
  annotationsToCloneFeatures,
  productToGenbank,
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
