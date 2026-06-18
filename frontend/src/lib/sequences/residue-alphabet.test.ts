import { describe, expect, it } from "vitest";
import { isValidResidue, residueAlphabet, sanitizeResidues } from "./residue-alphabet";

describe("sanitizeResidues", () => {
  it("keeps the four DNA bases", () => {
    expect(sanitizeResidues("ACGT", "dna")).toBe("ACGT");
  });

  it("keeps IUPAC nucleotide ambiguity codes and the gap", () => {
    expect(sanitizeResidues("RYSWKMBDHVN-", "dna")).toBe("RYSWKMBDHVN-");
  });

  it("uppercases lowercase input to the editor convention", () => {
    expect(sanitizeResidues("acgtn", "dna")).toBe("ACGTN");
  });

  it("strips the repro characters X, Q, 8, Z from DNA", () => {
    expect(sanitizeResidues("xq8z", "dna")).toBe("");
    expect(sanitizeResidues("AxqC8zG", "dna")).toBe("ACG");
  });

  it("strips digits and whitespace, keeping only residues from a FASTA-like blob", () => {
    expect(sanitizeResidues(" ACG T\n ac123 gt ", "dna")).toBe("ACGTACGT");
  });

  it("returns empty string when nothing is valid (caller treats as no-op)", () => {
    expect(sanitizeResidues("12345 !?", "dna")).toBe("");
  });

  it("treats U as valid for RNA but not for DNA", () => {
    expect(sanitizeResidues("ACGU", "rna")).toBe("ACGU");
    expect(sanitizeResidues("ACGU", "dna")).toBe("ACG");
  });

  it("treats T as valid for DNA but not for RNA", () => {
    expect(sanitizeResidues("ACGT", "rna")).toBe("ACG");
  });

  it("keeps amino acids plus B Z X U O and the stop for protein", () => {
    expect(sanitizeResidues("ACDEFGHIKLMNPQRSTVWYBZXUO*", "protein")).toBe(
      "ACDEFGHIKLMNPQRSTVWYBZXUO*",
    );
  });

  it("differs between protein and DNA alphabets", () => {
    // E, F, I, P are amino acids that are not DNA bases.
    expect(sanitizeResidues("EFIP", "protein")).toBe("EFIP");
    expect(sanitizeResidues("EFIP", "dna")).toBe("");
    // "*" and the gap behave differently across types.
    expect(sanitizeResidues("*", "protein")).toBe("*");
    expect(sanitizeResidues("*", "dna")).toBe("");
    expect(sanitizeResidues("-", "dna")).toBe("-");
    expect(sanitizeResidues("-", "protein")).toBe("");
  });
});

describe("isValidResidue", () => {
  it("is case-insensitive", () => {
    expect(isValidResidue("a", "dna")).toBe(true);
    expect(isValidResidue("N", "dna")).toBe(true);
    expect(isValidResidue("x", "dna")).toBe(false);
    expect(isValidResidue("u", "rna")).toBe(true);
    expect(isValidResidue("u", "dna")).toBe(false);
  });
});

describe("residueAlphabet", () => {
  it("exposes the per-type alphabets", () => {
    expect(residueAlphabet("dna")).toContain("N");
    expect(residueAlphabet("dna")).not.toContain("U");
    expect(residueAlphabet("rna")).toContain("U");
    expect(residueAlphabet("protein")).toContain("*");
  });
});
