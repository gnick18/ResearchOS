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
//   - upper/lowercasing the input,
//   - the gap glyph "X" for an untranslatable codon (unified 2026-06-03;
//     seqviz previously emitted "?"),
//   - resolving an UNAMBIGUOUS degenerate codon to its single residue
//     (GGN -> "G", CTN -> "L", YTR -> "L") and gapping an AMBIGUOUS one to
//     "X" (GAN -> Asp+Glu, MGN -> Arg+Ser). Both ResearchOS paths now expand
//     each IUPAC codon and collapse, matching Biopython on every case below.
// The trivial hand-check ATG GCC -> "MA" is asserted against both engines
// before any larger case is trusted.
//
// DOCUMENTED, BY-DESIGN DIVERGENCES (NOT translation bugs):
//   - Two-way ambiguity codes B (Asn/Asp) and Z (Gln/Glu): Biopython emits
//     these for codons like RAY -> "B" / SAA -> "Z". ResearchOS emits the
//     single gap glyph "X" for ANY disagreement (it never emits B/Z); these
//     are not single residues and were explicitly out of scope. The cases
//     asserted below (GAN, MGN) are ones where Biopython ALSO emits "X", so
//     they match exactly.
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
  // --- degenerate (IUPAC) codons, Biopython Seq.translate(table=1) ----------
  ATGAAACCCGGNGGG: "MKPGG", //  GGN resolves to Gly -> G (was a gap pre-2026-06-03)
  GGN: "G", //                  all four GG{A,C,G,T} are Gly
  CTN: "L", //                  all four CT{A,C,G,T} are Leu
  YTR: "L", //                  CTA/CTG/TTA/TTG all Leu
  ACN: "T", //                  all four AC{A,C,G,T} are Thr
  CGN: "R", //                  all four CG{A,C,G,T} are Arg
  AAR: "K", //                  AAA/AAG -> Lys (used in the mixed-sequence case)
  MGN: "X", //                  CGN=Arg but AGC/AGT=Ser -> disagreement -> X
  GAN: "X", //                  GAT/GAC=Asp, GAA/GAG=Glu -> disagreement -> X
  ATGNNNNNNGGG: "MXXG", //      N-run: two fully-ambiguous codons -> XX
  // ATG GAA GAT TTC AAR CGT CAT TGG TAC TAA: the single degenerate codon AAR
  // resolves to K, so the whole peptide reads exactly like the all-exact form.
  ATGGAAGATTTCAARCGTCATTGGTACTAA: "MEDFKRHWY*",
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
  describe("degenerate codons are resolved (Biopython parity, 2026-06-03)", () => {
    it("fully-ambiguous NNN -> X on both engines (== Biopython)", () => {
      // Biopython: Seq("ATGAAACCCNNNGGG").translate(table=1) == "MKPXG"
      const seq = "ATGAAACCCNNNGGG";
      expect(translate(seq, "dna")).toBe("MKPXG");
      expect(translateFrame1(seq)).toBe("MKPXG");
    });

    it("GGN resolves to G on both engines (== Biopython MKPGG)", () => {
      const seq = "ATGAAACCCGGNGGG";
      expect(translate(seq, "dna")).toBe(BIO.ATGAAACCCGGNGGG);
      expect(translateFrame1(seq)).toBe(BIO.ATGAAACCCGGNGGG);
    });

    it("single degenerate codons collapse to their unambiguous residue", () => {
      for (const codon of ["GGN", "CTN", "YTR", "ACN", "CGN", "AAR"] as const) {
        expect(translate(codon, "dna")).toBe(BIO[codon]);
        expect(translateFrame1(codon)).toBe(BIO[codon]);
      }
    });

    it("ambiguous-residue codons gap to X (MGN=Arg+Ser, GAN=Asp+Glu)", () => {
      // Verified against Biopython: MGN -> X, GAN -> X (both disagree).
      for (const codon of ["MGN", "GAN"] as const) {
        expect(translate(codon, "dna")).toBe(BIO[codon]);
        expect(translateFrame1(codon)).toBe(BIO[codon]);
      }
    });

    it("an N-run gaps codon-by-codon: ATGNNNNNNGGG -> MXXG", () => {
      const seq = "ATGNNNNNNGGG";
      expect(translate(seq, "dna")).toBe(BIO.ATGNNNNNNGGG);
      expect(translateFrame1(seq)).toBe(BIO.ATGNNNNNNGGG);
    });

    it("a real ORF with ONE resolvable degenerate codon (AAR->K) is unchanged", () => {
      const seq = "ATGGAAGATTTCAARCGTCATTGGTACTAA";
      expect(translate(seq, "dna")).toBe(BIO.ATGGAAGATTTCAARCGTCATTGGTACTAA);
      expect(translateFrame1(seq)).toBe(BIO.ATGGAAGATTTCAARCGTCATTGGTACTAA);
    });

    it("RNA degenerate codons resolve identically (U read as T): GGN/GGU... ", () => {
      expect(translate("GGN", "rna")).toBe("G");
      expect(translate("CUN", "rna")).toBe("L"); // RNA spelling of CTN
    });
  });

  describe("the two translate paths agree on every shared input", () => {
    // Equivalence guard: for any DNA input, seqviz translate and translateFrame1
    // must now produce byte-identical protein strings (same residues, same gap
    // glyph "X", same stop "*"). Catches future drift between the two tables.
    const inputs = [
      "ATGGCC",
      "ATGAAACCCGGGTAA",
      "ATGTAATGGAAATAA",
      "atggccaaattt",
      "ATGAAACCCGGNGGG",
      "ATGNNNNNNGGG",
      "ATGGAAGATTTCAARCGTCATTGGTACTAA",
      "GGNCTNYTRACNCGNAARMGNGAN",
      "ATGGCCA", // trailing partial codon
    ];
    it.each(inputs)("translate == translateFrame1 for %s", (seq) => {
      expect(translate(seq, "dna")).toBe(translateFrame1(seq));
    });
  });

  describe("whitespace is NOT stripped (documented behavior)", () => {
    it("embedded spaces shift the frame and gap out", () => {
      // Biopython fed whitespace-stripped "atggccaaattt" -> "MAKF" (see above).
      // ResearchOS does not strip spaces, so the frame is corrupted instead.
      // A space is off-alphabet, so every codon containing one gaps to "X" on
      // BOTH engines (seqviz no longer emits "?").
      const spaced = "  atg gcc aaa ttt  ";
      expect(translate(spaced, "dna")).toBe("XXAXXX");
      expect(translateFrame1(spaced)).toBe("XXAXXX");
    });
  });
});
