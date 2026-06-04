import { describe, expect, it } from "vitest";
import { alignGlobal } from "./core";
import {
  dnaScoring,
  proteinScoring,
  blosum62,
  iupacCompatible,
  reverseComplement,
} from "./scoring";

describe("iupacCompatible", () => {
  it("treats exact bases as compatible only with themselves", () => {
    expect(iupacCompatible("A", "A")).toBe(true);
    expect(iupacCompatible("A", "C")).toBe(false);
    expect(iupacCompatible("g", "G")).toBe(true); // case-insensitive
  });

  it("matches N against any base", () => {
    for (const base of ["A", "C", "G", "T"]) {
      expect(iupacCompatible("N", base)).toBe(true);
      expect(iupacCompatible(base, "N")).toBe(true);
    }
  });

  it("matches R (A|G), Y (C|T), S (G|C), W (A|T) by set intersection", () => {
    expect(iupacCompatible("R", "A")).toBe(true);
    expect(iupacCompatible("R", "G")).toBe(true);
    expect(iupacCompatible("R", "C")).toBe(false);
    expect(iupacCompatible("Y", "C")).toBe(true);
    expect(iupacCompatible("Y", "T")).toBe(true);
    expect(iupacCompatible("Y", "A")).toBe(false);
    expect(iupacCompatible("S", "G")).toBe(true);
    expect(iupacCompatible("S", "C")).toBe(true);
    expect(iupacCompatible("S", "A")).toBe(false);
    expect(iupacCompatible("W", "A")).toBe(true);
    expect(iupacCompatible("W", "T")).toBe(true);
    expect(iupacCompatible("W", "G")).toBe(false);
  });

  it("matches the triple codes B, D, H, V", () => {
    expect(iupacCompatible("B", "C")).toBe(true); // B = C|G|T
    expect(iupacCompatible("B", "A")).toBe(false);
    expect(iupacCompatible("D", "A")).toBe(true); // D = A|G|T
    expect(iupacCompatible("D", "C")).toBe(false);
    expect(iupacCompatible("H", "C")).toBe(true); // H = A|C|T
    expect(iupacCompatible("H", "G")).toBe(false);
    expect(iupacCompatible("V", "G")).toBe(true); // V = A|C|G
    expect(iupacCompatible("V", "T")).toBe(false);
  });

  it("treats two ambiguity codes as compatible when their sets intersect", () => {
    expect(iupacCompatible("R", "S")).toBe(true); // {A,G} ∩ {G,C} = {G}
    expect(iupacCompatible("R", "Y")).toBe(false); // {A,G} ∩ {C,T} = {}
    expect(iupacCompatible("R", "K")).toBe(true); // {A,G} ∩ {G,T} = {G}
  });

  it("treats U as T (RNA against DNA)", () => {
    expect(iupacCompatible("U", "T")).toBe(true);
    expect(iupacCompatible("U", "A")).toBe(false);
    expect(iupacCompatible("U", "Y")).toBe(true); // Y = C|T
  });
});

describe("dnaScoring", () => {
  it("defaults to IUPAC-aware match +2 / mismatch -1", () => {
    const s = dnaScoring();
    expect(s("A", "A")).toBe(2);
    expect(s("A", "C")).toBe(-1);
    expect(s("N", "G")).toBe(2);
    expect(s("R", "A")).toBe(2);
    expect(s("R", "C")).toBe(-1);
  });

  it("honors custom match / mismatch values", () => {
    const s = dnaScoring({ match: 5, mismatch: -4 });
    expect(s("A", "A")).toBe(5);
    expect(s("A", "G")).toBe(-4);
  });

  it("with iupac:false, ambiguity codes only match themselves", () => {
    const s = dnaScoring({ iupac: false });
    expect(s("A", "A")).toBe(2);
    expect(s("N", "A")).toBe(-1); // N is not degeneracy-aware here
    expect(s("R", "A")).toBe(-1);
    expect(s("N", "N")).toBe(2); // byte-identical
  });
});

describe("IUPAC degeneracy in a real alignment", () => {
  it("scores N, R, Y in the query as matches against compatible target bases", () => {
    // Query ANRY vs ACGT: A=A (M), N~C (M), R~G (M), Y~T (M) -> all match.
    const r = alignGlobal("ACGT", "ANRY", { scoring: dnaScoring() });
    expect(r.score).toBe(8); // 4 compatible columns * 2
    expect(r.cigar).toBe("4M");
    expect(r.identity).toBe(1);
  });

  it("falls back to mismatches under iupac:false", () => {
    const r = alignGlobal("ACGT", "ANRY", { scoring: dnaScoring({ iupac: false }) });
    // Only the first A matches; N, R, Y are mismatches.
    expect(r.cigar).toBe("1M3X");
    expect(r.score).toBe(2 - 3); // one match, three mismatches
  });
});

describe("proteinScoring / blosum62", () => {
  const ALL = "ARNDCQEGHILKMFPSTWYVBZX*";

  it("returns the canonical BLOSUM62 values for known diagonal cells", () => {
    const s = proteinScoring();
    expect(s("A", "A")).toBe(4);
    expect(s("W", "W")).toBe(11);
    expect(s("C", "C")).toBe(9);
    expect(s("P", "P")).toBe(7);
  });

  it("returns the canonical BLOSUM62 values for known off-diagonal cells", () => {
    const s = proteinScoring();
    expect(s("A", "R")).toBe(-1);
    expect(s("D", "E")).toBe(2);
    expect(s("F", "Y")).toBe(3);
    expect(s("K", "E")).toBe(1);
  });

  it("returns the canonical negative substitution scores", () => {
    const s = proteinScoring();
    expect(s("W", "A")).toBe(-3);
    expect(s("G", "V")).toBe(-3);
  });

  it("is symmetric for every ordered pair in the alphabet", () => {
    for (const x of ALL) {
      for (const y of ALL) {
        expect(blosum62(x, y)).toBe(blosum62(y, x));
      }
    }
  });

  it("is case-insensitive", () => {
    const s = proteinScoring();
    expect(s("a", "a")).toBe(4);
    expect(s("w", "W")).toBe(11);
    expect(s("d", "e")).toBe(2);
  });

  it("handles the BLOSUM62 extra rows X (any), * (stop), B (Asx), Z (Glx)", () => {
    const s = proteinScoring();
    expect(s("X", "X")).toBe(-1); // canonical X/X
    expect(s("*", "*")).toBe(1); // stop/stop
    expect(s("*", "A")).toBe(-4); // stop vs any residue
    expect(s("B", "D")).toBe(4); // Asx ~ Asp
    expect(s("Z", "E")).toBe(4); // Glx ~ Glu
  });

  it("maps J / U / O to the X (any) row", () => {
    const s = proteinScoring();
    expect(s("J", "A")).toBe(blosum62("X", "A"));
    expect(s("U", "W")).toBe(blosum62("X", "W"));
    expect(s("O", "O")).toBe(blosum62("X", "X"));
  });

  it("routes a truly foreign character through X by default, or uses unknownScore", () => {
    expect(blosum62("@", "A")).toBe(blosum62("X", "A"));
    const penalized = proteinScoring({ unknownScore: -9 });
    expect(penalized("@", "A")).toBe(-9);
    // Known residues are unaffected by unknownScore.
    expect(penalized("A", "A")).toBe(4);
  });

  it("drives a real protein alignment, rewarding a conservative substitution", () => {
    // KEEP vs KDEP: K=K (5), E vs D (BLOSUM 2, still positive -> a 'match' op),
    // E=E (5), P=P (7). A pure-identity scheme would mark the E/D column a
    // mismatch, but BLOSUM scores it positive.
    const r = alignGlobal("KEEP", "KDEP", { scoring: proteinScoring() });
    expect(r.cigar).toBe("4M");
    expect(r.score).toBe(5 + 2 + 5 + 7);
  });
});

describe("reverseComplement", () => {
  it("reverse-complements plain DNA", () => {
    expect(reverseComplement("ATGC")).toBe("GCAT");
    expect(reverseComplement("AAAA")).toBe("TTTT");
  });

  it("preserves IUPAC degeneracy (complement of R=A|G is Y=C|T)", () => {
    expect(reverseComplement("R")).toBe("Y");
    expect(reverseComplement("Y")).toBe("R");
    expect(reverseComplement("N")).toBe("N");
    expect(reverseComplement("S")).toBe("S");
    expect(reverseComplement("W")).toBe("W");
    expect(reverseComplement("K")).toBe("M");
    expect(reverseComplement("RYSWKM")).toBe("KMWSRY");
  });

  it("uppercases and handles U as A's complement", () => {
    expect(reverseComplement("atgc")).toBe("GCAT");
    expect(reverseComplement("U")).toBe("A");
  });
});
