// sequence Phase 2e bot — primer biology tests: revcomp, GC, Tm (basic + NN),
// and binding-site search (forward + reverse-complement + 3'-anchored partial).

import { describe, it, expect } from "vitest";
import {
  reverseComplement,
  gcContent,
  sanitizePrimer,
  tmBasic,
  tmNearestNeighbor,
  predictTm,
  findBindingSites,
} from "./primer";
import {
  documentToGenbank,
  documentFromDetail,
  type SeqDocument,
} from "./edit-model";
import { addFeature } from "./feature-edit";
import type { SequenceDetail } from "../types";

describe("reverseComplement", () => {
  it("reverse-complements a DNA string", () => {
    expect(reverseComplement("ATGC")).toBe("GCAT");
    expect(reverseComplement("AAAA")).toBe("TTTT");
  });
  it("treats U as A's complement", () => {
    expect(reverseComplement("AUGC")).toBe("GCAT");
  });
  it("is its own inverse for unambiguous DNA", () => {
    const s = "GATTACAGGCCTTAA";
    expect(reverseComplement(reverseComplement(s))).toBe(s);
  });
  it("maps unknown chars to N", () => {
    expect(reverseComplement("AXG")).toBe("CNT");
  });
});

describe("gcContent", () => {
  it("computes GC percent", () => {
    expect(gcContent("GGCC")).toBe(100);
    expect(gcContent("ATAT")).toBe(0);
    expect(gcContent("ATGC")).toBe(50);
  });
  it("returns 0 for empty", () => {
    expect(gcContent("")).toBe(0);
  });
});

describe("sanitizePrimer", () => {
  it("strips whitespace, numbers, and uppercases", () => {
    expect(sanitizePrimer("  atg c 12 g ")).toBe("ATGCG");
  });
});

describe("tmBasic", () => {
  it("uses the Wallace rule for short oligos (<14 nt)", () => {
    // 4*(G+C) + 2*(A+T): ATGC = 2 AT + 2 GC = 2*2 + 4*2 = 12
    expect(tmBasic("ATGC")).toBe(12);
    // GGGG (4 nt) = 4*4 = 16
    expect(tmBasic("GGGG")).toBe(16);
  });
  it("uses the salt-adjusted GC formula for longer oligos (>=14 nt)", () => {
    const seq = "ATGCATGCATGCAT"; // 14 nt, 6 GC
    const tm = tmBasic(seq);
    // 64.9 + 41*(6-16.4)/14 = 64.9 - 30.46 ≈ 34.44
    expect(tm).toBeCloseTo(64.9 + (41 * (6 - 16.4)) / 14, 5);
  });
  it("returns NaN for empty", () => {
    expect(Number.isNaN(tmBasic(""))).toBe(true);
  });
});

describe("tmNearestNeighbor", () => {
  it("returns a reasonable Tm for a typical 20-mer", () => {
    // A standard sequencing primer-ish 20-mer; NN Tm should land in a sane range.
    const tm = tmNearestNeighbor("GTAAAACGACGGCCAGTGCC");
    expect(tm).toBeGreaterThan(50);
    expect(tm).toBeLessThan(75);
  });
  it("rises with GC content", () => {
    const lowGc = tmNearestNeighbor("ATATATATATATATATATAT".slice(0, 20));
    const highGc = tmNearestNeighbor("GCGCGCGCGCGCGCGCGCGC");
    expect(highGc).toBeGreaterThan(lowGc);
  });
  it("falls back to basic for very short oligos", () => {
    expect(tmNearestNeighbor("ATGC")).toBe(tmBasic("ATGC"));
  });
  it("sanitizes ambiguity codes out before computing (N is dropped, not fatal)", () => {
    // sanitizePrimer strips N, so the NN calc runs on the cleaned ACGT-only oligo.
    expect(tmNearestNeighbor("ATGCNNNNATGCATGC")).toBe(tmNearestNeighbor("ATGCATGCATGC"));
  });
  it("predictTm delegates to nearest-neighbor", () => {
    const s = "GTAAAACGACGGCCAGTGCC";
    expect(predictTm(s)).toBe(tmNearestNeighbor(s));
  });
});

describe("findBindingSites — forward strand", () => {
  const template = "AAAGGGCCCTTTGGGCCCAAA"; // 21 nt
  it("finds an exact full-length forward match", () => {
    const primer = "GGGCCC"; // occurs at 3 and 12
    const sites = findBindingSites(primer, template, { allowPartial: false });
    const fwd = sites.filter((s) => s.direction === 1);
    expect(fwd.length).toBe(2);
    expect(fwd[0]).toMatchObject({ start: 3, end: 9, direction: 1, fullMatch: true, annealedLength: 6 });
    expect(fwd[1]).toMatchObject({ start: 12, end: 18, direction: 1 });
  });
});

describe("findBindingSites — reverse strand", () => {
  // Template top strand; a reverse primer = revcomp of a top-strand window.
  const template = "ACGTACGTAAAACCCCGGGGTTTT";
  it("finds a reverse-strand full-length match mapped to forward coords", () => {
    // Top-strand window [16,24) = "GGGGTTTT". A reverse primer is its revcomp.
    const window = template.slice(16, 24); // GGGGTTTT
    const primer = reverseComplement(window); // AAAACCCC
    const sites = findBindingSites(primer, template, { allowPartial: false });
    const rev = sites.filter((s) => s.direction === -1);
    expect(rev.some((s) => s.start === 16 && s.end === 24 && s.fullMatch)).toBe(true);
  });
});

describe("findBindingSites — 3'-anchored partial (cloning tail)", () => {
  // The primer has a non-annealing 5' tail (e.g. a restriction overhang) and a
  // 3' region that matches the template. Only the 3' region should anneal.
  const template = "TTTTTTTTTTGGGCCCAAAGGGTTTTTTTTTT";
  it("reports the 3' run, not the 5' tail, for a forward partial", () => {
    const tail = "GGATCCGAATTC"; // 12 nt non-matching tail
    const anneal = template.slice(10, 22); // GGGCCCAAAGGG (12 nt) matches
    const primer = tail + anneal; // 24 nt; only 3' 12 nt anneal
    const sites = findBindingSites(primer, template, { allowPartial: true, minAnneal: 8 });
    const partial = sites.find((s) => s.direction === 1 && !s.fullMatch);
    expect(partial).toBeDefined();
    expect(partial!.annealedLength).toBe(12);
    // Annealed region sits at the template match, not shifted by the tail length.
    expect(partial!.start).toBe(10);
    expect(partial!.end).toBe(22);
  });
  it("does not report a partial below minAnneal", () => {
    const primer = "GGATCCGAATTCGGG"; // only 3 nt (GGG) anneal at pos 10
    const sites = findBindingSites(primer, template, { allowPartial: true, minAnneal: 8 });
    expect(sites.every((s) => s.fullMatch || s.annealedLength >= 8)).toBe(true);
  });
});

describe("findBindingSites — edge cases", () => {
  it("returns nothing for an empty primer or template", () => {
    expect(findBindingSites("", "ACGT")).toEqual([]);
    expect(findBindingSites("ACGT", "")).toEqual([]);
  });
  it("de-duplicates a palindromic site hitting both strands at the same span", () => {
    // EcoRI site GAATTC is a palindrome: its revcomp is itself.
    const template = "AAAGAATTCAAA";
    const sites = findBindingSites("GAATTC", template, { allowPartial: false });
    // Forward hit [3,9) and reverse hit [3,9) collapse only across same direction;
    // here both directions are distinct keys, so we expect one per direction.
    const spans = sites.map((s) => `${s.start}:${s.end}:${s.direction}`);
    expect(new Set(spans).size).toBe(spans.length); // no dupes within a direction
  });
});

describe("primer persistence — primer_bind round-trips into the .gb", () => {
  // The Add-Primer flow saves a primer as a GenBank primer_bind feature. The
  // bio-parsers default splits primer_bind out of `features` into a separate
  // `primers` array on re-parse; the editable model derives both the map layer
  // and the feature list from `doc.features`, so documentFromDetail parses with
  // `primersAsFeatures: true`. This guards that the primer survives a load.
  it("a saved primer_bind reloads as a feature in the document", () => {
    const doc: SeqDocument = {
      name: "test",
      seqType: "dna",
      circular: true,
      seq: "AAGTGTGTACTCTAACATTAAGGTGTCCGTTGCAGCTTACCATCGT".repeat(4),
      features: [],
    };
    const withPrimer = addFeature(doc, {
      name: "flbA_seq_fwd",
      type: "primer_bind",
      strand: 1,
      start: 6,
      end: 26,
      qualifiers: [{ key: "note", value: "primer GTACTCTAACATTAAGGTGT" }],
    });
    const gb = documentToGenbank(withPrimer);
    expect(gb).toBeTruthy();

    const detail = {
      display_name: "test",
      seq: withPrimer.seq,
      seq_type: "dna",
      circular: true,
      genbank: gb!,
      annotations: [],
    } as unknown as SequenceDetail;
    const reloaded = documentFromDetail(detail);
    const primer = reloaded.features.find(
      (f) => (f.type || "").toLowerCase() === "primer_bind",
    );
    expect(primer).toBeDefined();
    expect(primer!.name).toBe("flbA_seq_fwd");
    expect(primer!.start).toBe(6);
    expect(primer!.end).toBe(26);
    expect(primer!.strand).toBe(1);
  });
});
