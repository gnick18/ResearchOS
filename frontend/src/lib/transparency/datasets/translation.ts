/**
 * Translation showcase cases for the transparency page.
 *
 * Each case translates a DNA sequence in frame 1 and compares the resulting
 * protein, residue by residue, to Biopython's Seq.translate(table=1, the
 * standard NCBI genetic code). The comparison is exact; the delta we report is
 * the number of residues that differ.
 *
 * Expected proteins are lifted verbatim from the committed golden suite
 * (`lib/sequences/translation.golden.test.ts`), which derives them from
 * `frontend/scripts/gen-translate-golden.py` run against Biopython.
 *
 * Coverage spans the cases a translator can get wrong: a clean ORF with a stop,
 * an internal stop kept inline, a trailing partial codon dropped the way
 * Biopython truncates, an IUPAC-degenerate codon that still resolves to one
 * residue, a fully ambiguous N-run that becomes X, and a reverse-strand read.
 */

export interface TranslateCase {
  id: string;
  label: string;
  /** In-frame DNA to translate (frame 1). */
  seq: string;
  /** Biopython Seq.translate(table=1) output. */
  bioProtein: string;
}

export const TRANSLATE_CASES: TranslateCase[] = [
  {
    id: "clean_orf",
    label: "Clean ORF with stop",
    seq: "ATGAAACCCGGGTAA",
    bioProtein: "MKPG*",
  },
  {
    id: "longer_peptide",
    label: "Longer peptide",
    seq: "ATGGAAGATTTCAAACGTCATTGGTACTAA",
    bioProtein: "MEDFKRHWY*",
  },
  {
    id: "internal_stop",
    label: "Internal stop kept inline",
    seq: "ATGTAATGGAAATAA",
    bioProtein: "M*WK*",
  },
  {
    id: "partial_codon",
    label: "Trailing partial codon dropped",
    seq: "ATGGCCAT",
    bioProtein: "MA",
  },
  {
    id: "degenerate_ggn",
    label: "IUPAC-degenerate GGN resolves to Gly",
    seq: "ATGAAACCCGGNGGG",
    bioProtein: "MKPGG",
  },
  {
    id: "ambiguous_nrun",
    label: "Fully ambiguous N-run becomes X",
    seq: "ATGNNNNNNGGG",
    bioProtein: "MXXG",
  },
  {
    id: "reverse_strand",
    label: "Reverse strand (revcomp of TTACATGGT)",
    seq: "ACCATGTAA",
    bioProtein: "TM*",
  },
  // --- second batch (2026-06-05): distinct coding sequences, Biopython 1.87
  // table=1 (the hand-check ATG GCC -> MA reproduced exactly).
  {
    id: "gfp_nterm",
    label: "GFP N-terminus",
    seq: "ATGAGTAAAGGAGAAGAACTTTTCACT",
    bioProtein: "MSKGEELFT",
  },
  {
    id: "his_tag",
    label: "His6 affinity tag with stop",
    seq: "ATGCATCATCATCATCATCACTAA",
    bioProtein: "MHHHHHH*",
  },
  {
    id: "lac_frag",
    label: "lacZ fragment",
    seq: "ATGACCATGATTACGGATTCACTGG",
    bioProtein: "MTMITDSL",
  },
  {
    id: "ytr_ggn",
    label: "Two degenerate codons that each resolve (YTR, GGN)",
    seq: "ATGYTRGGNTAA",
    bioProtein: "MLG*",
  },
  {
    id: "n_codon_mid",
    label: "Single ambiguous codon mid-sequence (NNN to X)",
    seq: "ATGAAANNNCCCTAA",
    bioProtein: "MKXP*",
  },
  {
    id: "long_orf",
    label: "39-mer open reading frame, no stop",
    seq: "ATGGCTAGCAAAGGTGAAGAATTGTTCACTGGTGTTGTC",
    bioProtein: "MASKGEELFTGVV",
  },
  {
    id: "double_stop",
    label: "Tryptophan followed by consecutive stops",
    seq: "ATGTGGTAGTAATGA",
    bioProtein: "MW***",
  },
];
