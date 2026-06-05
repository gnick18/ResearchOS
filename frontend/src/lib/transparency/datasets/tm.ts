/**
 * Primer melting-temperature showcase cases for the transparency page.
 *
 * Each case carries the pinned third-party values our `nearestNeighborTm` is
 * checked against:
 *  - `bioTm`: Biopython Bio.SeqUtils.MeltingTemp.Tm_NN, configured to EXACTLY
 *    match our calculator (DNA_NN3, saltcorr=5, dnac1=dnac2=oligo/2). This is a
 *    faithful-port parity check; the tolerance is tight (0.05 C) and any miss is
 *    a port bug, not a number to relax.
 *  - `p3Tm`: primer3-py primer3.calc_tm (santalucia/santalucia). primer3 uses the
 *    SantaLucia 1998 UNIFIED table (not Allawi 1997 = DNA_NN3) and its own salt
 *    model, so a small systematic offset is EXPECTED. The tolerance is loose
 *    (3 C) and the page explains the offset rather than hiding it.
 *
 * Values are lifted verbatim from the committed golden suite
 * (`lib/calculators/tm-nn.golden.test.ts`), which itself derives them from
 * `frontend/scripts/gen-tm-golden.py` run in a venv with biopython + primer3-py.
 * Do not hand-edit the numbers; re-run that script to refresh them.
 */

import type { NnTmOptions } from "@/lib/calculators/tm-nn";

export interface TmCase {
  id: string;
  label: string;
  seq: string;
  opts: NnTmOptions;
  /** Biopython Tm_NN, tight-parity oracle. */
  bioTm: number;
  /** primer3-py calc_tm, loose ecosystem oracle. undefined where N/A (palindromes). */
  p3Tm?: number;
}

/**
 * A curated, story-telling subset of the golden TIER1/TIER2 fixtures: enough
 * length / GC / terminus / buffer coverage to be convincing without dumping all
 * 21 fixtures on the reader. The palindrome cases have no primer3 self-complement
 * value, so they carry only the Biopython oracle.
 */
export const TM_CASES: TmCase[] = [
  {
    id: "short15_mid",
    label: "15-mer, ~50% GC",
    seq: "ACGTACGTACGTACG",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 46.5572,
    p3Tm: 46.5572,
  },
  {
    id: "short15_lowgc",
    label: "16-mer, very low GC, AT termini",
    seq: "AATAAATTTAATTTAA",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 26.4155,
    p3Tm: 26.4155,
  },
  {
    id: "short16_highgc",
    label: "16-mer, very high GC, GC termini",
    seq: "GCGCGGCCGGCGCGGC",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 71.1344,
    p3Tm: 71.1344,
  },
  {
    id: "mid25_realistic",
    label: "25-mer, realistic primer",
    seq: "GCATGAGCTTACGTTCCAAAGATGT",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 57.9787,
    p3Tm: 57.9787,
  },
  {
    id: "ref28_biopython",
    label: "28-mer, Biopython reference oligo",
    seq: "CGTTCCAAAGATGTGGGCATGAGCTTAC",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 61.924,
    p3Tm: 61.924,
  },
  {
    id: "long40_highgc",
    label: "40-mer, high GC",
    seq: "GCGCGCATGCGCGCGCATGCGCGCGCATGCGCGCGCATGC",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 84.5607,
    p3Tm: 84.5607,
  },
  {
    id: "gc_terminal",
    label: "18-mer, GC termini both ends (where tables differ most)",
    seq: "GCATGCATGCATGCATGC",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 55.8882,
    p3Tm: 56.8985,
  },
  {
    id: "na50_mg15_dntp06",
    label: "28-mer, full PCR buffer (Na + Mg + dNTP)",
    seq: "CGTTCCAAAGATGTGGGCATGAGCTTAC",
    opts: { oligoNanomolar: 50, na: 50, mg: 1.5, dntps: 0.6 },
    bioTm: 66.3099,
    p3Tm: 66.3099,
  },
  {
    id: "palindrome_ecorv",
    label: "8-mer palindrome (EcoRV-like), self-complementary",
    seq: "GGATATCC",
    opts: { oligoNanomolar: 250, na: 50, selfComplementary: true },
    bioTm: 6.185,
  },
  {
    id: "palindrome_at12",
    label: "12-mer palindrome, self-complementary",
    seq: "AATTGGCCAATT",
    opts: { oligoNanomolar: 250, na: 50, selfComplementary: true },
    bioTm: 31.8009,
  },
  // --- second batch (2026-06-05): distinct real-world + edge oligos, checked
  // against Biopython 1.87 (gates reproduced the pinned 1.83 values exactly).
  // primer3 has no loadable arm64 build on this machine, so these carry the
  // Biopython (Tier-1, tight) oracle only.
  {
    id: "m13_fwd",
    label: "17-mer M13 forward primer",
    seq: "GTAAAACGACGGCCAGT",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 51.6742,
  },
  {
    id: "t7_promoter",
    label: "20-mer T7 promoter primer",
    seq: "TAATACGACTCACTATAGGG",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 46.7766,
  },
  {
    id: "gc_rich_22",
    label: "22-mer, very high GC",
    seq: "GGCAGCTGCGGCCGCAGGTGCC",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 71.6958,
  },
  {
    id: "at_rich_20",
    label: "20-mer, AT-rich",
    seq: "TTAATTGACAATTTGACATA",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 42.3846,
  },
  {
    id: "balanced_30",
    label: "30-mer, mixed composition",
    seq: "TACCGGATCAGTGAATTCGCATGCTAGCTA",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 62.7326,
  },
  {
    id: "m13_rev_24",
    label: "24-mer M13 reverse primer",
    seq: "CAGGAAACAGCTATGACCATGATT",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 55.0381,
  },
  {
    id: "short_13",
    label: "13-mer, short oligo",
    seq: "ACCTGCAGGTCAT",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 42.1761,
  },
  {
    id: "long_45",
    label: "45-mer, long oligo",
    seq: "ATGCGATCGTACGTAGCTAGCATCGATCGTACGATCGATCGTACGA",
    opts: { oligoNanomolar: 250, na: 50 },
    bioTm: 70.2062,
  },
  {
    id: "m13rev_k50",
    label: "24-mer M13 reverse, with 50 mM K+ added",
    seq: "CAGGAAACAGCTATGACCATGATT",
    opts: { oligoNanomolar: 50, na: 50, k: 50 },
    bioTm: 56.6147,
  },
  {
    id: "m13rev_pcr",
    label: "24-mer M13 reverse, full PCR buffer (Mg + dNTP)",
    seq: "CAGGAAACAGCTATGACCATGATT",
    opts: { oligoNanomolar: 50, na: 50, mg: 1.5, dntps: 0.6 },
    bioTm: 59.1141,
  },
  {
    id: "pal_ndei",
    label: "10-mer NdeI-centered palindrome, self-complementary",
    seq: "GGCATATGCC",
    opts: { oligoNanomolar: 250, na: 50, selfComplementary: true },
    bioTm: 29.3784,
  },
  {
    id: "pal_xhoi",
    label: "8-mer XhoI palindrome, self-complementary",
    seq: "CCTCGAGG",
    opts: { oligoNanomolar: 250, na: 50, selfComplementary: true },
    bioTm: 19.2883,
  },
];
