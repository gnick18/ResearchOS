// seq introns bot — unit tests for the spliced (join CDS) translation + the
// per-block segment clipping geometry. These exercise the pure helpers that
// back the SnapGene-style multi-exon rendering in the vendored SeqViz layer.
import { describe, expect, it } from "vitest";

import { clipSegmentToBlock, spliceTranslation, translate } from "@/vendor/seqviz/sequence";

describe("spliceTranslation", () => {
  // A controlled construct: exon bases spell ATG AAA | TTT GGG when spliced,
  // with an intron of junk between them. Translating through the intron would
  // give the WRONG protein; splicing gives the right one.
  //                0         1         2
  //                0123456789012345678901234567
  const seq = "ATGAAA" + "CCCTAGCCC" + "TTTGGG"; // exon1[0,6) intron[6,15) exon2[15,21)
  const segments = [
    { start: 0, end: 6 },
    { start: 15, end: 21 },
  ];

  it("translates the concatenated exon bases, not the raw span", () => {
    const { AAseq } = spliceTranslation(segments, seq, "dna", 1);
    // ATGAAATTTGGG -> M K F G
    expect(AAseq).toBe(translate("ATGAAATTTGGG", "dna"));
    expect(AAseq).toBe("MKFG");
    // The raw-span translation (reads through the intron) is different.
    expect(AAseq).not.toBe(translate(seq.substring(0, 21), "dna"));
  });

  it("maps each amino acid to the absolute bp of its first coding base", () => {
    const { AAseq, aaToBp } = spliceTranslation(segments, seq, "dna", 1);
    expect(aaToBp).toHaveLength(AAseq.length);
    // codon 0 (M) starts at bp 0, codon 1 (K) at bp 3 (still exon1),
    // codon 2 (F) jumps to bp 15 (start of exon2), codon 3 (G) at bp 18.
    expect(aaToBp).toEqual([0, 3, 15, 18]);
    // No amino acid is placed inside the intron [6,15).
    for (const bp of aaToBp) {
      expect(bp < 6 || bp >= 15).toBe(true);
    }
  });

  it("reverse-strand translates the reverse complement of the spliced mRNA", () => {
    const { AAseq } = spliceTranslation(segments, seq, "dna", -1);
    // spliced sense = ATGAAATTTGGG ; revcomp = CCCAAATTTCAT -> P K F H
    expect(AAseq).toBe(translate("CCCAAATTTCAT", "dna"));
  });

  it("is order-independent: unsorted segments give the same protein", () => {
    const reordered = [segments[1], segments[0]];
    const a = spliceTranslation(segments, seq, "dna", 1);
    const b = spliceTranslation(reordered, seq, "dna", 1);
    expect(b.AAseq).toBe(a.AAseq);
    expect(b.aaToBp).toEqual(a.aaToBp);
  });
});

describe("clipSegmentToBlock", () => {
  it("returns the full span when wholly inside the block", () => {
    expect(clipSegmentToBlock(10, 20, 0, 60)).toEqual({ start: 10, end: 20 });
  });

  it("clamps a span that overflows the block edges", () => {
    // block [60, 120); span [40, 100) -> visible [60, 100)
    expect(clipSegmentToBlock(40, 100, 60, 120)).toEqual({ start: 60, end: 100 });
    // span [100, 180) -> visible [100, 120)
    expect(clipSegmentToBlock(100, 180, 60, 120)).toEqual({ start: 100, end: 120 });
  });

  it("returns null for a span that does not intersect the block (intron-only block)", () => {
    expect(clipSegmentToBlock(200, 260, 0, 60)).toBeNull();
    expect(clipSegmentToBlock(0, 60, 120, 180)).toBeNull();
  });

  it("returns null for a zero-width clip at a block boundary", () => {
    expect(clipSegmentToBlock(60, 60, 0, 60)).toBeNull();
    expect(clipSegmentToBlock(60, 120, 0, 60)).toBeNull();
  });
});
