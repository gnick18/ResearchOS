// translation golden bot - GROUND-TRUTH / cross-validation suite for
// DNA -> PROTEIN translation.
//
// Every expected protein string in this file is grounded in Biopython's
// Bio.Seq.Seq.translate against the NCBI standard genetic code (transl_table
// 1), or is a hand/definitional value. NONE was copied from ResearchOS's own
// translate output. The Biopython reference values are reproduced by
//   frontend/scripts/gen-translate-golden.py
// (committed alongside this test). This suite itself is PURE TypeScript - it
// does not shell out to Python, so CI never needs Biopython.
//
// ---------------------------------------------------------------------------
// TABLE + CONVENTION RECONCILIATION (see gen-translate-golden.py for detail)
// ---------------------------------------------------------------------------
// ResearchOS has two standard-table-1 translation paths, both tested here:
//   * seqviz `translate`        (src/vendor/seqviz/sequence.ts)
//   * `translateFrame1`         (src/lib/sequences/export.ts)
//
// Biopython table=1, both ResearchOS functions, all AGREE on:
//   - the 64 exact standard codons,
//   - stop codon -> "*" (kept inline, not trimmed),
//   - dropping a trailing partial codon (length not a multiple of 3),
//   - upper/lowercasing the input.
// The trivial hand-check ATG GCC -> "MA" is asserted against both engines
// before any larger case is trusted.
//
// DOCUMENTED, BY-DESIGN DIVERGENCES (NOT translation bugs):
//   - Gap glyph for an untranslatable codon: seqviz emits "?", translateFrame1
//     and Biopython emit "X".
//   - Degenerate-but-resolvable codons (e.g. GGN, ACN): Biopython resolves to
//     the real amino acid; BOTH ResearchOS functions emit a gap because they
//     carry only the 64 exact codons. Asserted as OUR documented behavior.
//   - Whitespace is NOT stripped by either ResearchOS function, so embedded
//     spaces shift the reading frame and gap out; Biopython here is fed
//     whitespace-stripped input. Tested explicitly as OUR documented behavior.
//   - ResearchOS exposes ONLY standard table 1 (no bacterial/mito codon-table
//     parameter), so alternate-table tests are not applicable.

import { describe, expect, it } from "vitest";

import { translateFrame1 } from "@/lib/sequences/export";
import { reverseComplement, translate } from "@/vendor/seqviz/sequence";

// Biopython table=1 reference outputs, with a trailing partial codon dropped to
// match ResearchOS (see gen-translate-golden.py). Whitespace stripped before
// translation. These are GROUND TRUTH, not derived from our code.
const BIO = {
  ATGGCC: "MA", //                                hand-checked: ATG=M, GCC=A
  ATGAAACCCGGGTAA: "MKPG*", //                    clean ORF + stop
  ATGTAATGGAAATAA: "M*WK*", //                    internal stop placement
  ATGGCCA: "MA", //                               7 nt: trailing 1 base dropped
  ATGGCCAT: "MA", //                              8 nt: trailing 2 bases dropped
  atggccaaattt: "MAKF", //                        lowercase
  ATGGAAGATTTCAAACGTCATTGGTACTAA: "MEDFKRHWY*", // longer peptide
  ACCATGTAA: "TM*", //                            = revcomp("TTACATGGT")
} as const;

describe("translation golden suite (Biopython table=1 ground truth)", () => {
  describe("reconciliation: agree with Biopython on the trivial hand case", () => {
    it("ATG GCC -> MA across both ResearchOS engines and Biopython", () => {
      expect(BIO.ATGGCC).toBe("MA"); // hand value
      expect(translate("ATGGCC", "dna")).toBe(BIO.ATGGCC);
      expect(translateFrame1("ATGGCC")).toBe(BIO.ATGGCC);
    });
  });

  describe("clean in-frame ORF (ATG...stop)", () => {
    it("translates ATGAAACCCGGGTAA -> MKPG*", () => {
      expect(translate("ATGAAACCCGGGTAA", "dna")).toBe(BIO.ATGAAACCCGGGTAA);
      expect(translateFrame1("ATGAAACCCGGGTAA")).toBe(BIO.ATGAAACCCGGGTAA);
    });

    it("translates a longer peptide MEDFKRHWY*", () => {
      const seq = "ATGGAAGATTTCAAACGTCATTGGTACTAA";
      expect(translate(seq, "dna")).toBe(BIO.ATGGAAGATTTCAAACGTCATTGGTACTAA);
      expect(translateFrame1(seq)).toBe(BIO.ATGGAAGATTTCAAACGTCATTGGTACTAA);
    });
  });

  describe("internal stop codon placement", () => {
    it("keeps the internal * inline: ATGTAATGGAAATAA -> M*WK*", () => {
      // TAA at codon 2 is an internal stop; neither engine trims at it.
      expect(translate("ATGTAATGGAAATAA", "dna")).toBe(BIO.ATGTAATGGAAATAA);
      expect(translateFrame1("ATGTAATGGAAATAA")).toBe(BIO.ATGTAATGGAAATAA);
    });
  });

  describe("trailing partial codon is dropped (matches Biopython truncation)", () => {
    it("1 extra base: ATGGCCA -> MA", () => {
      expect(translate("ATGGCCA", "dna")).toBe(BIO.ATGGCCA);
      expect(translateFrame1("ATGGCCA")).toBe(BIO.ATGGCCA);
    });

    it("2 extra bases: ATGGCCAT -> MA", () => {
      expect(translate("ATGGCCAT", "dna")).toBe(BIO.ATGGCCAT);
      expect(translateFrame1("ATGGCCAT")).toBe(BIO.ATGGCCAT);
    });
  });

  describe("lowercase input is uppercased before translation", () => {
    it("atggccaaattt -> MAKF", () => {
      expect(translate("atggccaaattt", "dna")).toBe(BIO.atggccaaattt);
      expect(translateFrame1("atggccaaattt")).toBe(BIO.atggccaaattt);
    });
  });

  describe("reverse strand: translate the reverse complement", () => {
    it("revcomp(TTACATGGT) = ACCATGTAA, translated -> TM*", () => {
      const rc = reverseComplement("TTACATGGT", "dna");
      expect(rc).toBe("ACCATGTAA"); // Biopython reverse_complement, hand-checked
      // ACC=T, ATG=M, TAA=*  (Biopython BIO.ACCATGTAA)
      expect(translate(rc, "dna")).toBe(BIO.ACCATGTAA);
      expect(translateFrame1(rc)).toBe(BIO.ACCATGTAA);
    });
  });

  // -------------------------------------------------------------------------
  // DOCUMENTED DIVERGENCES - asserted as OUR behavior, with the Biopython
  // ground-truth recorded inline so any future change is caught.
  // -------------------------------------------------------------------------
  describe("ambiguous bases (documented gap behavior, NOT a bug)", () => {
    it("fully-ambiguous NNN: Biopython -> X; seqviz emits ?, frame1 emits X", () => {
      // Biopython: Seq("ATGAAACCCNNNGGG").translate(table=1) == "MKPXG"
      const seq = "ATGAAACCCNNNGGG";
      expect(translate(seq, "dna")).toBe("MKP?G"); // seqviz gap glyph "?"
      expect(translateFrame1(seq)).toBe("MKPXG"); // frame1 gap glyph "X" == Biopython "MKPXG"
    });

    it("degenerate-resolvable GGN: Biopython resolves to G; ours gap out", () => {
      // Biopython: Seq("ATGAAACCCGGNGGG").translate(table=1) == "MKPGG".
      // ResearchOS carries only the 64 exact codons, so the GGN codon gaps.
      const seq = "ATGAAACCCGGNGGG";
      expect(translate(seq, "dna")).toBe("MKP?G"); // seqviz gap, NOT "MKPGG"
      expect(translateFrame1(seq)).toBe("MKPXG"); // frame1 gap, NOT "MKPGG"
    });
  });

  describe("whitespace is NOT stripped (documented behavior)", () => {
    it("embedded spaces shift the frame and gap out", () => {
      // Biopython fed whitespace-stripped "atggccaaattt" -> "MAKF" (see above).
      // ResearchOS does not strip spaces, so the frame is corrupted instead.
      const spaced = "  atg gcc aaa ttt  ";
      expect(translate(spaced, "dna")).toBe("??A???");
      expect(translateFrame1(spaced)).toBe("XXAXXX");
    });
  });
});
