// seq export bot — unit tests for the pure export core.

import { describe, it, expect } from "vitest";
import type { SeqDocument } from "./edit-model";
import { documentToGenbankText } from "./export";
import {
  toFasta,
  documentToFasta,
  sliceDocument,
  selectionToGenbankText,
  selectionToFasta,
  translateFrame1,
  selectionToProteinFasta,
  normalizeRange,
  sanitizeFilename,
} from "./export";

function makeDoc(seq: string, features: SeqDocument["features"] = []): SeqDocument {
  return {
    name: "pTest plasmid",
    seq,
    seqType: "dna",
    circular: true,
    features,
  };
}

describe("toFasta", () => {
  it("emits a header line and wraps bases at the given width", () => {
    const out = toFasta({ name: "myseq", sequence: "ACGT".repeat(20) }, 10);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(">myseq");
    // 80 bases at width 10 = 8 body lines
    expect(lines.length).toBe(1 + 8);
    expect(lines[1]).toBe("ACGTACGTAC");
    expect(lines[1].length).toBe(10);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("includes a description in the header when present", () => {
    const out = toFasta({ name: "s", description: "a test", sequence: "ACGT" });
    expect(out.split("\n")[0]).toBe(">s a test");
  });

  it("strips whitespace from the residues before wrapping", () => {
    const out = toFasta({ name: "s", sequence: "AC GT\nAC" }, 70);
    expect(out.split("\n")[1]).toBe("ACGTAC");
  });

  it("defaults the name when missing", () => {
    expect(toFasta({ sequence: "ACGT" }).split("\n")[0]).toBe(">Untitled_Sequence");
  });
});

describe("documentToGenbankText (GenBank passthrough)", () => {
  it("round-trips the whole document to GenBank text", () => {
    const doc = makeDoc("ATGAAATTTGGGCCC", [
      { name: "gene1", start: 0, end: 8, strand: 1, type: "CDS" },
    ]);
    const gb = documentToGenbankText(doc);
    expect(gb).toBeTypeOf("string");
    expect(gb).toContain("LOCUS");
    expect(gb).toContain("gene1");
    // The bases appear in the ORIGIN block (lowercased + space-blocked by the
    // GenBank convention), so compare with the whitespace stripped.
    const origin = (gb as string).toLowerCase().replace(/[^acgt]/g, "");
    expect(origin).toContain("atgaaatttgggccc");
  });
});

describe("documentToFasta", () => {
  it("uses the document name as the header and wraps the bases", () => {
    const doc = makeDoc("ATGC".repeat(25));
    const out = documentToFasta(doc, 70);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(">pTest plasmid");
    expect(lines[1].length).toBe(70);
    // 100 bases at 70 -> 2 body lines
    expect(lines.length).toBe(3);
  });
});

describe("normalizeRange", () => {
  it("orders and clamps the range", () => {
    expect(normalizeRange(10, 4, 100)).toEqual({ lo: 4, hi: 10 });
    expect(normalizeRange(-5, 200, 50)).toEqual({ lo: 0, hi: 50 });
  });
});

describe("sliceDocument (selection slice + feature rebasing)", () => {
  // seq: indices 0..19
  //  AAAAA CCCCC GGGGG TTTTT
  const doc = makeDoc("AAAAACCCCCGGGGGTTTTT", [
    // Fully inside the slice [5,15): C-run + G-run, ends inclusive.
    { name: "inside", start: 5, end: 14, strand: 1, type: "misc_feature" },
    // Overlaps the left edge of [5,15): A..C, should clip to start 0 in slice.
    { name: "leftOverlap", start: 2, end: 7, strand: 1, type: "misc_feature" },
    // Fully outside the slice (the trailing T-run): should be dropped.
    { name: "outside", start: 15, end: 19, strand: 1, type: "misc_feature" },
  ]);

  it("slices the bases to the half-open range", () => {
    const sliced = sliceDocument(doc, 5, 15);
    expect(sliced.seq).toBe("CCCCCGGGGG");
    expect(sliced.circular).toBe(false);
  });

  it("rebases features into the slice coordinate frame", () => {
    const sliced = sliceDocument(doc, 5, 15);
    const inside = sliced.features.find((f) => f.name === "inside");
    expect(inside).toBeDefined();
    // start 5 -> 0, end 14 -> 9
    expect(inside?.start).toBe(0);
    expect(inside?.end).toBe(9);
  });

  it("clips features overlapping the left edge to the slice start", () => {
    const sliced = sliceDocument(doc, 5, 15);
    const left = sliced.features.find((f) => f.name === "leftOverlap");
    expect(left).toBeDefined();
    // start 2 (before slice) -> 0; end 7 -> 2
    expect(left?.start).toBe(0);
    expect(left?.end).toBe(2);
  });

  it("drops features that fall entirely outside the slice", () => {
    const sliced = sliceDocument(doc, 5, 15);
    expect(sliced.features.find((f) => f.name === "outside")).toBeUndefined();
  });

  it("selectionToGenbankText serializes the rebased slice", () => {
    const gb = selectionToGenbankText(doc, 5, 15);
    expect(gb).toBeTypeOf("string");
    const origin = (gb as string).toLowerCase().replace(/[^acgt]/g, "");
    expect(origin).toContain("cccccggggg");
    expect(gb).toContain("inside");
    expect(gb).not.toContain("outside");
  });

  it("selectionToFasta serializes just the selected bases", () => {
    const out = selectionToFasta(doc, 5, 15);
    expect(out.split("\n")[1]).toBe("CCCCCGGGGG");
  });
});

describe("translateFrame1", () => {
  it("translates a clean ORF in frame 1", () => {
    // ATG AAA TTT TGA = M K F *
    expect(translateFrame1("ATGAAATTTTGA")).toBe("MKF*");
  });

  it("reads U as T (RNA input)", () => {
    expect(translateFrame1("AUGAAA")).toBe("MK");
  });

  it("ignores a trailing partial codon", () => {
    expect(translateFrame1("ATGAA")).toBe("M");
  });

  it("maps codons with non-ACGT bases to X", () => {
    expect(translateFrame1("ATGNNN")).toBe("MX");
  });
});

describe("selectionToProteinFasta", () => {
  it("translates the selection (frame 1) into a protein FASTA", () => {
    //                         M  K  F  *
    const doc = makeDoc("CCCATGAAATTTTGACCC");
    // Select [3, 15): ATGAAATTTTGA -> MKF*
    const out = selectionToProteinFasta(doc, 3, 15);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toContain("protein");
    expect(lines[0]).toContain("translation frame 1");
    expect(lines[1]).toBe("MKF*");
  });
});

describe("sanitizeFilename", () => {
  it("replaces path/sep/whitespace characters", () => {
    expect(sanitizeFilename("my plasmid/v2:final")).toBe("my_plasmid_v2_final");
  });
  it("falls back when empty", () => {
    expect(sanitizeFilename("   ")).toBe("sequence");
  });
});
