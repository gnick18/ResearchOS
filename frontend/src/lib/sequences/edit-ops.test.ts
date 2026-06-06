// seq editops bot — unit tests for the Edit-menu pure logic (edit-ops.ts).

import { describe, expect, it } from "vitest";
import {
  copyBottomStrand,
  copyAminoAcids,
  reverseComplementClip,
  invertSelection,
  parseSelectRange,
  parseGoTo,
  caseTransform,
  reverseComplementRange,
} from "./edit-ops";
import type { MolecularClip } from "./clipboard";
import type { SeqDocument } from "./edit-model";

function doc(seq: string): SeqDocument {
  return { name: "t", seq, seqType: "dna", circular: false, features: [] };
}

describe("copyBottomStrand", () => {
  it("returns the reverse complement of the selection (5'->3' bottom strand)", () => {
    // top 5'-ATGC-3'  =>  bottom 5'-GCAT-3'
    expect(copyBottomStrand("ATGC", "dna")).toBe("GCAT");
  });
  it("handles RNA (A<->U)", () => {
    expect(copyBottomStrand("AUGC", "rna")).toBe("GCAU");
  });
  it("returns protein bases unchanged (no complement)", () => {
    expect(copyBottomStrand("MKV", "protein")).toBe("MKV");
  });
});

describe("copyAminoAcids", () => {
  it("translates frame 1 and drops a trailing partial codon", () => {
    // ATG=M GCA=A ... trailing "TT" dropped
    expect(copyAminoAcids("ATGGCATT", "dna")).toBe("MA");
  });
  it("translates a stop codon to *", () => {
    expect(copyAminoAcids("TAA", "dna")).toBe("*");
  });
  it("returns aa input unchanged", () => {
    expect(copyAminoAcids("MKV", "protein")).toBe("MKV");
  });
});

describe("reverseComplementClip", () => {
  it("reverse-complements the bases", () => {
    const clip: MolecularClip = { seq: "ATGC", features: [], seqType: "dna", sourceName: "s" };
    expect(reverseComplementClip(clip).seq).toBe("GCAT");
  });
  it("rebases a feature onto the flipped frame and flips its strand", () => {
    // length 6, feature [1,3) fwd -> [3,5) rev
    const clip: MolecularClip = {
      seq: "ATGCAT",
      features: [{ name: "f", start: 1, end: 3, strand: 1, forward: true, type: "misc_feature" }],
      seqType: "dna",
      sourceName: "s",
    };
    const out = reverseComplementClip(clip);
    expect(out.features[0].start).toBe(3);
    expect(out.features[0].end).toBe(5);
    expect(out.features[0].strand).toBe(-1);
    expect(out.features[0].forward).toBe(false);
  });
  it("flips multi-segment locations and re-sorts ascending", () => {
    const clip: MolecularClip = {
      seq: "ATGCATGCAT", // length 10
      features: [
        {
          name: "f",
          start: 0,
          end: 8,
          strand: 1,
          forward: true,
          type: "CDS",
          locations: [
            { start: 0, end: 2 },
            { start: 6, end: 8 },
          ],
        },
      ],
      seqType: "dna",
      sourceName: "s",
    };
    const out = reverseComplementClip(clip);
    // [0,2) -> [8,10), [6,8) -> [2,4); re-sorted ascending => [2,4),[8,10)
    expect(out.features[0].locations).toEqual([
      { start: 2, end: 4 },
      { start: 8, end: 10 },
    ]);
  });
});

describe("invertSelection", () => {
  it("inverts a mid selection to the larger surrounding piece", () => {
    // len 10, sel [2,4) -> pieces [0,2) and [4,10); larger is [4,10)
    const r = invertSelection(2, 4, 10);
    expect(r.span).toEqual({ start: 4, end: 10 });
    expect(r.pieces).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ]);
  });
  it("inverts a leading selection to the trailing remainder", () => {
    expect(invertSelection(0, 3, 10).span).toEqual({ start: 3, end: 10 });
  });
  it("inverts an empty selection to the whole sequence", () => {
    expect(invertSelection(5, 5, 10).span).toEqual({ start: 0, end: 10 });
  });
  it("returns null when the whole sequence is selected", () => {
    expect(invertSelection(0, 10, 10).span).toBeNull();
  });
});

describe("parseSelectRange", () => {
  it("parses 1-based dotted ranges to half-open 0-based", () => {
    // user 1..4 inclusive -> [0,4)
    expect(parseSelectRange("1..4", 10)).toEqual({ start: 0, end: 4 });
  });
  it("accepts hyphen, comma, and space separators", () => {
    expect(parseSelectRange("2-5", 10)).toEqual({ start: 1, end: 5 });
    expect(parseSelectRange("2, 5", 10)).toEqual({ start: 1, end: 5 });
    expect(parseSelectRange("2 5", 10)).toEqual({ start: 1, end: 5 });
  });
  it("selects a single base from a single number", () => {
    expect(parseSelectRange("3", 10)).toEqual({ start: 2, end: 3 });
  });
  it("normalizes reversed input and clamps the end to length", () => {
    expect(parseSelectRange("8..3", 10)).toEqual({ start: 2, end: 8 });
    expect(parseSelectRange("5..99", 10)).toEqual({ start: 4, end: 10 });
  });
  it("rejects junk, zero, and out-of-range starts", () => {
    expect(parseSelectRange("", 10)).toBeNull();
    expect(parseSelectRange("abc", 10)).toBeNull();
    expect(parseSelectRange("0..3", 10)).toBeNull();
    expect(parseSelectRange("20..30", 10)).toBeNull();
  });
});

describe("parseGoTo", () => {
  it("maps a 1-based coordinate to a 0-based index", () => {
    expect(parseGoTo("1", 10)).toBe(0);
    expect(parseGoTo("10", 10)).toBe(9);
  });
  it("rejects out-of-range and junk", () => {
    expect(parseGoTo("0", 10)).toBeNull();
    expect(parseGoTo("11", 10)).toBeNull();
    expect(parseGoTo("x", 10)).toBeNull();
  });
});

describe("caseTransform", () => {
  it("lowercases the selected range only", () => {
    const out = caseTransform(doc("ATGCAT"), 1, 4, "lower");
    expect(out.seq).toBe("AtgcAT");
  });
  it("uppercases the selected range only", () => {
    const out = caseTransform(doc("atgcat"), 1, 4, "upper");
    expect(out.seq).toBe("aTGCat");
  });
  it("returns the same doc when the range is empty", () => {
    const d = doc("ATGC");
    expect(caseTransform(d, 2, 2, "lower")).toBe(d);
  });
});

describe("reverseComplementRange", () => {
  it("reverse-complements the selected range in place (same length, no shift)", () => {
    // ATGC over [1,4) is "TGC"; its reverse complement is "GCA".
    const out = reverseComplementRange(doc("ATGC"), 1, 4);
    expect(out.seq).toBe("AGCA");
    expect(out.seq.length).toBe(4);
  });
  it("flips the whole sequence when the range covers it", () => {
    // AATTGGCC -> reverse complement GGCCAATT
    expect(reverseComplementRange(doc("AATTGGCC"), 0, 8).seq).toBe("GGCCAATT");
  });
  it("normalizes a reversed [lo, hi) and clamps out-of-range bounds", () => {
    expect(reverseComplementRange(doc("ATGC"), 4, 1).seq).toBe("AGCA");
    expect(reverseComplementRange(doc("ATGC"), -5, 99).seq).toBe("GCAT");
  });
  it("handles RNA (A<->U)", () => {
    const out = reverseComplementRange(
      { name: "t", seq: "AUGC", seqType: "rna", circular: false, features: [] },
      0,
      4,
    );
    expect(out.seq).toBe("GCAU");
  });
  it("reverses protein bases without complementing", () => {
    const out = reverseComplementRange(
      { name: "t", seq: "MKVL", seqType: "protein", circular: false, features: [] },
      0,
      4,
    );
    expect(out.seq).toBe("LVKM");
  });
  it("leaves features untouched (no coordinate shift)", () => {
    const d: SeqDocument = {
      name: "t",
      seq: "ATGCAATT",
      seqType: "dna",
      circular: false,
      features: [{ name: "f", type: "misc_feature", start: 0, end: 4, strand: 1 }],
    };
    const out = reverseComplementRange(d, 0, 4);
    expect(out.features).toEqual(d.features);
  });
  it("returns the same doc when the range is empty", () => {
    const d = doc("ATGC");
    expect(reverseComplementRange(d, 2, 2)).toBe(d);
  });
});
