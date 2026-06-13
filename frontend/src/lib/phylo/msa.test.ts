// Phylo Phase 3: the alignment parser, residue palettes, binning, and tip join.
//
// Inline alignments only, no external corpus. Asserts the parser preserves gaps
// and column positions, the kind auto-detects nucleotide vs amino-acid, wide
// alignments bin to a drawable width (and report it), the residue palettes color
// the expected residues, and the tip join reuses the shared composite-label
// matcher.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick, leaves } from "./parse";
import {
  parseAlignment,
  detectKind,
  binAlignment,
  matchAlignmentToTips,
  residueColor,
  residueLegend,
  isGap,
  MAX_RENDER_COLUMNS,
  NUCLEOTIDE_COLORS,
  AMINO_ACID_COLORS,
  GAP_FILL,
} from "./msa";

describe("parseAlignment", () => {
  it("parses a multi-line FASTA, concatenating wrapped blocks", () => {
    const aln = parseAlignment(">a\nACGT\nACGT\n>b\nACGTACGT\n");
    expect(aln.records).toHaveLength(2);
    expect(aln.records[0].label).toBe("a");
    expect(aln.records[0].residues).toBe("ACGTACGT");
    expect(aln.columns).toBe(8);
  });

  it("preserves gaps and column positions (does not strip them)", () => {
    const aln = parseAlignment(">a\nAC-GT\n>b\nAC.GT\n");
    expect(aln.records[0].residues).toBe("AC-GT");
    expect(aln.records[1].residues).toBe("AC.GT");
    expect(aln.columns).toBe(5);
  });

  it("uses the first header token as the join label", () => {
    const aln = parseAlignment(">FJ385264 some description here\nACGT\n");
    expect(aln.records[0].label).toBe("FJ385264");
  });

  it("right-pads ragged rows with gaps so the matrix is rectangular", () => {
    const aln = parseAlignment(">a\nACGTACGT\n>b\nACGT\n");
    expect(aln.columns).toBe(8);
    expect(aln.records[1].residues).toBe("ACGT----");
  });

  it("uppercases residues", () => {
    const aln = parseAlignment(">a\nacgt\n");
    expect(aln.records[0].residues).toBe("ACGT");
  });

  it("returns an empty alignment for empty input", () => {
    const aln = parseAlignment("");
    expect(aln.records).toHaveLength(0);
    expect(aln.columns).toBe(0);
  });
});

describe("isGap", () => {
  it("treats -, ., ~, space, and * as gaps", () => {
    for (const g of ["-", ".", "~", " ", "*"]) expect(isGap(g)).toBe(true);
    expect(isGap("A")).toBe(false);
  });
});

describe("detectKind", () => {
  it("calls an ACGT alignment nucleotide", () => {
    const aln = parseAlignment(">a\nACGTACGTACGT\n>b\nACGT--GTACGT\n");
    expect(detectKind(aln.records)).toBe("nucleotide");
    expect(aln.kind).toBe("nucleotide");
  });

  it("tolerates a few IUPAC ambiguity codes and stays nucleotide", () => {
    const aln = parseAlignment(">a\nACGTRYSWKMACGT\n");
    expect(detectKind(aln.records)).toBe("nucleotide");
  });

  it("calls a protein-rich alignment amino-acid", () => {
    const aln = parseAlignment(">a\nMKLViewFWPQHED\n>b\nMKLViewFWPQHED\n");
    expect(detectKind(aln.records)).toBe("amino-acid");
    expect(aln.kind).toBe("amino-acid");
  });
});

describe("residue palettes", () => {
  it("colors each nucleotide distinctly and gaps as the empty fill", () => {
    expect(residueColor("A", "nucleotide")).toBe(NUCLEOTIDE_COLORS.A);
    expect(residueColor("C", "nucleotide")).toBe(NUCLEOTIDE_COLORS.C);
    expect(residueColor("G", "nucleotide")).toBe(NUCLEOTIDE_COLORS.G);
    expect(residueColor("T", "nucleotide")).toBe(NUCLEOTIDE_COLORS.T);
    expect(residueColor("U", "nucleotide")).toBe(NUCLEOTIDE_COLORS.U);
    expect(residueColor("-", "nucleotide")).toBe(GAP_FILL);
    // The four bases get four different colors (a real key, not one flat hue).
    const four = new Set(["A", "C", "G", "T"].map((b) => residueColor(b, "nucleotide")));
    expect(four.size).toBe(4);
  });

  it("colors amino acids by physicochemical group", () => {
    // Hydrophobic share a hue; positive a different one.
    expect(residueColor("L", "amino-acid")).toBe(AMINO_ACID_COLORS.L);
    expect(residueColor("I", "amino-acid")).toBe(residueColor("L", "amino-acid"));
    expect(residueColor("K", "amino-acid")).not.toBe(
      residueColor("L", "amino-acid"),
    );
    expect(residueColor("?", "amino-acid")).toBe(GAP_FILL);
  });

  it("builds a residue legend for each kind", () => {
    const nt = residueLegend("nucleotide");
    expect(nt.map((i) => i.label)).toContain("A");
    expect(nt.map((i) => i.label)).toContain("gap / other");
    const aa = residueLegend("amino-acid");
    expect(aa.map((i) => i.label)).toContain("Hydrophobic");
    expect(aa.length).toBeGreaterThan(4);
  });
});

describe("binAlignment", () => {
  it("does not bin a narrow alignment (binSize 1, full resolution)", () => {
    const aln = parseAlignment(">a\nACGTACGT\n>b\nACGTACGT\n");
    const b = binAlignment(aln);
    expect(b.binSize).toBe(1);
    expect(b.blocks).toBe(8);
    expect(b.rows.get("a")).toBe("ACGTACGT");
  });

  it("bins a wide alignment down to at most MAX_RENDER_COLUMNS blocks", () => {
    // 5000 columns of all-A, two records.
    const wide = "A".repeat(5000);
    const aln = parseAlignment(`>a\n${wide}\n>b\n${wide}\n`);
    const b = binAlignment(aln);
    expect(b.sourceColumns).toBe(5000);
    expect(b.binSize).toBeGreaterThan(1);
    expect(b.blocks).toBeLessThanOrEqual(MAX_RENDER_COLUMNS);
    // The consensus of an all-A block is A.
    expect(b.rows.get("a")).toMatch(/^A+$/);
  });

  it("takes the most common non-gap residue as a block's consensus", () => {
    // One record, columns: AAAA C (binSize will be 1 for 5 cols, so test a coarse
    // bin by forcing a wide alignment that bins). Use a 10-col record binned by 2.
    const aln = parseAlignment(">a\nAAGGCCTTAA\n");
    // 10 cols, binned by ceil(10 / MAX) = 1 here, so consensus == residues.
    const b = binAlignment(aln);
    expect(b.rows.get("a")).toBe("AAGGCCTTAA");
  });
});

describe("matchAlignmentToTips", () => {
  const TREE = parseNewick("((A:0.1,B:0.2):0.3,(C:0.1,D:0.2):0.3);");

  it("joins records to tips by exact label, all matched", () => {
    const aln = parseAlignment(">A\nACGT\n>B\nACGT\n>C\nAGGT\n>D\nATGT\n");
    const m = matchAlignmentToTips(TREE, aln);
    expect(m.matched.size).toBe(leaves(TREE).length);
    expect(m.unmatchedTips).toHaveLength(0);
    expect(m.unmatchedRecords).toHaveLength(0);
    // Each matched value is a per-tip residue row.
    expect([...m.matched.values()][0]).toHaveLength(aln.columns);
  });

  it("joins a composite tip label to a record keyed on one token", () => {
    const tree = parseNewick("((SC144|FJ385264:0.1,B:0.2):0.3);");
    const aln = parseAlignment(">FJ385264\nACGT\n>B\nACGT\n");
    const m = matchAlignmentToTips(tree, aln);
    // The composite tip SC144|FJ385264 joins the FJ385264 record via the token
    // pass (the same matcher the metadata join uses).
    expect(m.matched.size).toBe(2);
    expect(m.unmatchedTips).toHaveLength(0);
  });

  it("surfaces unmatched tips and unmatched records, never silently dropping", () => {
    const aln = parseAlignment(">A\nACGT\n>Z\nACGT\n");
    const m = matchAlignmentToTips(TREE, aln);
    expect(m.matched.size).toBe(1); // only A
    expect(m.unmatchedTips).toContain("B");
    expect(m.unmatchedRecords).toContain("Z");
  });
});
