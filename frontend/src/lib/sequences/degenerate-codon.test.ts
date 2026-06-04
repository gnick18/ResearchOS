// degenerate-codon bot — unit tests for the shared IUPAC codon resolver.
// Expected values cross-checked against Biopython Seq.translate(table=1).
import { describe, expect, it } from "vitest";

import { resolveCodon, GAP_GLYPH } from "./degenerate-codon";

// Minimal standard table-1 map (the values are what both translate paths use).
const CODON_TABLE: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

describe("resolveCodon", () => {
  it("returns the exact residue for a concrete codon", () => {
    expect(resolveCodon("ATG", CODON_TABLE)).toBe("M");
    expect(resolveCodon("TAA", CODON_TABLE)).toBe("*");
  });

  it("resolves an unambiguous degenerate codon to one residue", () => {
    expect(resolveCodon("GGN", CODON_TABLE)).toBe("G");
    expect(resolveCodon("CTN", CODON_TABLE)).toBe("L");
    expect(resolveCodon("YTR", CODON_TABLE)).toBe("L");
    expect(resolveCodon("ACN", CODON_TABLE)).toBe("T");
    expect(resolveCodon("CGN", CODON_TABLE)).toBe("R");
    expect(resolveCodon("AAR", CODON_TABLE)).toBe("K");
    expect(resolveCodon("AAY", CODON_TABLE)).toBe("N");
    expect(resolveCodon("GTN", CODON_TABLE)).toBe("V");
  });

  it("gaps to X when expansions disagree", () => {
    expect(resolveCodon("MGN", CODON_TABLE)).toBe(GAP_GLYPH); // Arg + Ser
    expect(resolveCodon("GAN", CODON_TABLE)).toBe(GAP_GLYPH); // Asp + Glu
    expect(resolveCodon("NNN", CODON_TABLE)).toBe(GAP_GLYPH);
    expect(resolveCodon("ATN", CODON_TABLE)).toBe(GAP_GLYPH); // Ile + Met
    expect(resolveCodon("TGN", CODON_TABLE)).toBe(GAP_GLYPH); // Cys/Trp/stop
  });

  it("resolves a degenerate codon that spans coding + stop only when uniform", () => {
    // TAR = TAA(stop) + TAG(stop) -> both stop -> "*"
    expect(resolveCodon("TAR", CODON_TABLE)).toBe("*");
  });

  it("gaps off-alphabet or wrong-length input to X", () => {
    expect(resolveCodon("A.G", CODON_TABLE)).toBe(GAP_GLYPH);
    expect(resolveCodon("A G", CODON_TABLE)).toBe(GAP_GLYPH);
    expect(resolveCodon("AT", CODON_TABLE)).toBe(GAP_GLYPH);
    expect(resolveCodon("", CODON_TABLE)).toBe(GAP_GLYPH);
  });

  it("GAP_GLYPH is X", () => {
    expect(GAP_GLYPH).toBe("X");
  });
});
