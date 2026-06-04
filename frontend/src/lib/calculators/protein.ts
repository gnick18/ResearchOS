/**
 * Protein physico-chemical properties from an amino-acid sequence, the numbers
 * the ExPASy ProtParam tool reports: average molecular weight, isoelectric
 * point (pI), molar extinction coefficient at 280 nm (reduced + oxidized) with
 * the corresponding A280 of a 1 g/L solution, amino-acid composition, the
 * Guruprasad instability index, the Kyte-Doolittle GRAVY, aromaticity, and the
 * Ikai aliphatic index.
 *
 * This is a faithful, self-contained TypeScript port of Biopython's
 * `Bio.SeqUtils.ProtParam.ProteinAnalysis` (+ `Bio.SeqUtils.molecular_weight`
 * and `Bio.SeqUtils.IsoelectricPoint`, BSD), which is the same engine the
 * ExPASy ProtParam web tool implements. All constants are transcribed VERBATIM
 * from Biopython so the output is not an approximation:
 *
 *  - Average residue masses: Bio.Data.IUPACData.protein_weights (full residue
 *    masses); peptide MW = sum(residue mass) - (N-1) * water, water = 18.0153.
 *  - Isoelectric point: Bio.SeqUtils.IsoelectricPoint (Bjellqvist pK set,
 *    Bjellqvist 1993/1994 via the D.L.Tabb algorithm note). pI is found by the
 *    same bisection over net charge Biopython uses (start 7.775, 4.05..12,
 *    tolerance 1e-4).
 *  - Molar extinction at 280 nm: ProteinAnalysis.molar_extinction_coefficient
 *    -> reduced = 5500*nW + 1490*nY; oxidized (cystines) adds floor(nC/2)*125.
 *    (Pace, Vajdos, Fee, Grimsley, Gray (1995) Protein Sci 4:2411; the values
 *    Gill & von Hippel and Biopython use.) A280 of a 1 g/L (= 0.1%) solution is
 *    eps / MW, the ExPASy "Abs 0.1%" figure.
 *  - Instability index: ProteinAnalysis.instability_index, Guruprasad, Reddy &
 *    Pandit (1990) Protein Eng 4:155-161, dipeptide-instability-weight DIWV
 *    table transcribed verbatim. Index = (10 / N) * sum of DIWV over dipeptides.
 *  - GRAVY: ProteinAnalysis.gravy, Kyte & Doolittle (1982) J Mol Biol 157:105.
 *    Mean hydropathy over all residues.
 *  - Aromaticity: ProteinAnalysis.aromaticity, Lobry & Gautier (1994). Relative
 *    frequency of Phe + Trp + Tyr.
 *  - Aliphatic index: Ikai (1980) J Biochem 88:1895 (NOT in Biopython; standard
 *    ExPASy ProtParam formula). AI = X_A + 2.9*X_V + 3.9*(X_I + X_L), with X the
 *    mole percent (0-100) of each residue.
 *
 * Reference values reproduced by protein.golden.test.ts come from Biopython
 * ProteinAnalysis directly (see frontend/scripts/gen-protein-golden.py).
 *
 * NON-STANDARD RESIDUES: like ProtParam, composition / GRAVY / instability /
 * aromaticity / aliphatic / MW are computed over the 20 standard amino acids
 * only. We follow Biopython's behavior, which counts only the 20 standard
 * letters (sequence.count) and weights only those residues; ambiguous /
 * non-standard letters (X, B, Z, U, O, *, gaps) are reported but excluded from
 * MW and the iterated indices. `length` is the count of standard residues used
 * for the per-residue averages (so GRAVY / aromaticity match ProtParam, which
 * divides by self.length over a clean standard-AA sequence).
 */

/** The 20 standard amino-acid one-letter codes, in canonical order. */
export const STANDARD_AA = "ACDEFGHIKLMNPQRSTVWY".split("") as readonly string[];

/**
 * Average residue masses (g/mol), full residue. Verbatim from
 * Bio.Data.IUPACData.protein_weights (20 standard + U/O ambiguous-but-defined).
 */
const AVG_RESIDUE_MASS: Record<string, number> = {
  A: 89.0932,
  C: 121.1582,
  D: 133.1027,
  E: 147.1293,
  F: 165.1891,
  G: 75.0666,
  H: 155.1546,
  I: 131.1729,
  K: 146.1876,
  L: 131.1729,
  M: 149.2113,
  N: 132.1179,
  P: 115.1305,
  Q: 146.1445,
  R: 174.201,
  S: 105.0926,
  T: 119.1192,
  V: 117.1463,
  W: 204.2252,
  Y: 181.1885,
};

/** Average mass of water (g/mol). Verbatim from Bio.SeqUtils.molecular_weight. */
const WATER_AVG = 18.0153;

/** Kyte & Doolittle (1982) hydropathy. Verbatim from ProtParamData.kd. */
const KYTE_DOOLITTLE: Record<string, number> = {
  A: 1.8,
  R: -4.5,
  N: -3.5,
  D: -3.5,
  C: 2.5,
  Q: -3.5,
  E: -3.5,
  G: -0.4,
  H: -3.2,
  I: 4.5,
  L: 3.8,
  K: -3.9,
  M: 1.9,
  F: 2.8,
  P: -1.6,
  S: -0.8,
  T: -0.7,
  W: -0.9,
  Y: -1.3,
  V: 4.2,
};

/**
 * Bjellqvist pK sets, verbatim from Bio.SeqUtils.IsoelectricPoint.
 * positive_pKs cover the species that carry positive charge; negative_pKs the
 * negative; pKcterminal / pKnterminal are residue-specific terminus overrides.
 */
const POSITIVE_PKS: Record<string, number> = {
  Nterm: 7.5,
  K: 10.0,
  R: 12.0,
  H: 5.98,
};
const NEGATIVE_PKS: Record<string, number> = {
  Cterm: 3.55,
  D: 4.05,
  E: 4.45,
  C: 9.0,
  Y: 10.0,
};
const PK_CTERMINAL: Record<string, number> = { D: 4.55, E: 4.75 };
const PK_NTERMINAL: Record<string, number> = {
  A: 7.59,
  M: 7.0,
  S: 6.93,
  P: 8.36,
  T: 6.82,
  V: 7.44,
  E: 7.7,
};
const CHARGED_AAS = ["K", "R", "H", "D", "E", "C", "Y"] as const;

/**
 * Guruprasad et al. (1990) dipeptide instability-weight matrix DIWV. Verbatim
 * from Bio.SeqUtils.ProtParamData.DIWV. DIWV[a][b] is the weight of the ordered
 * dipeptide a->b.
 */
const DIWV: Record<string, Record<string, number>> = {
  A: { A: 1.0, C: 44.94, E: 1.0, D: -7.49, G: 1.0, F: 1.0, I: 1.0, H: -7.49, K: 1.0, M: 1.0, L: 1.0, N: 1.0, Q: 1.0, P: 20.26, S: 1.0, R: 1.0, T: 1.0, W: 1.0, V: 1.0, Y: 1.0 },
  C: { A: 1.0, C: 1.0, E: 1.0, D: 20.26, G: 1.0, F: 1.0, I: 1.0, H: 33.6, K: 1.0, M: 33.6, L: 20.26, N: 1.0, Q: -6.54, P: 20.26, S: 1.0, R: 1.0, T: 33.6, W: 24.68, V: -6.54, Y: 1.0 },
  E: { A: 1.0, C: 44.94, E: 33.6, D: 20.26, G: 1.0, F: 1.0, I: 20.26, H: -6.54, K: 1.0, M: 1.0, L: 1.0, N: 1.0, Q: 20.26, P: 20.26, S: 20.26, R: 1.0, T: 1.0, W: -14.03, V: 1.0, Y: 1.0 },
  D: { A: 1.0, C: 1.0, E: 1.0, D: 1.0, G: 1.0, F: -6.54, I: 1.0, H: 1.0, K: -7.49, M: 1.0, L: 1.0, N: 1.0, Q: 1.0, P: 1.0, S: 20.26, R: -6.54, T: -14.03, W: 1.0, V: 1.0, Y: 1.0 },
  G: { A: -7.49, C: 1.0, E: -6.54, D: 1.0, G: 13.34, F: 1.0, I: -7.49, H: 1.0, K: -7.49, M: 1.0, L: 1.0, N: -7.49, Q: 1.0, P: 1.0, S: 1.0, R: 1.0, T: -7.49, W: 13.34, V: 1.0, Y: -7.49 },
  F: { A: 1.0, C: 1.0, E: 1.0, D: 13.34, G: 1.0, F: 1.0, I: 1.0, H: 1.0, K: -14.03, M: 1.0, L: 1.0, N: 1.0, Q: 1.0, P: 20.26, S: 1.0, R: 1.0, T: 1.0, W: 1.0, V: 1.0, Y: 33.601 },
  I: { A: 1.0, C: 1.0, E: 44.94, D: 1.0, G: 1.0, F: 1.0, I: 1.0, H: 13.34, K: -7.49, M: 1.0, L: 20.26, N: 1.0, Q: 1.0, P: -1.88, S: 1.0, R: 1.0, T: 1.0, W: 1.0, V: -7.49, Y: 1.0 },
  H: { A: 1.0, C: 1.0, E: 1.0, D: 1.0, G: -9.37, F: -9.37, I: 44.94, H: 1.0, K: 24.68, M: 1.0, L: 1.0, N: 24.68, Q: 1.0, P: -1.88, S: 1.0, R: 1.0, T: -6.54, W: -1.88, V: 1.0, Y: 44.94 },
  K: { A: 1.0, C: 1.0, E: 1.0, D: 1.0, G: -7.49, F: 1.0, I: -7.49, H: 1.0, K: 1.0, M: 33.6, L: -7.49, N: 1.0, Q: 24.64, P: -6.54, S: 1.0, R: 33.6, T: 1.0, W: 1.0, V: -7.49, Y: 1.0 },
  M: { A: 13.34, C: 1.0, E: 1.0, D: 1.0, G: 1.0, F: 1.0, I: 1.0, H: 58.28, K: 1.0, M: -1.88, L: 1.0, N: 1.0, Q: -6.54, P: 44.94, S: 44.94, R: -6.54, T: -1.88, W: 1.0, V: 1.0, Y: 24.68 },
  L: { A: 1.0, C: 1.0, E: 1.0, D: 1.0, G: 1.0, F: 1.0, I: 1.0, H: 1.0, K: -7.49, M: 1.0, L: 1.0, N: 1.0, Q: 33.6, P: 20.26, S: 1.0, R: 20.26, T: 1.0, W: 24.68, V: 1.0, Y: 1.0 },
  N: { A: 1.0, C: -1.88, E: 1.0, D: 1.0, G: -14.03, F: -14.03, I: 44.94, H: 1.0, K: 24.68, M: 1.0, L: 1.0, N: 1.0, Q: -6.54, P: -1.88, S: 1.0, R: 1.0, T: -7.49, W: -9.37, V: 1.0, Y: 1.0 },
  Q: { A: 1.0, C: -6.54, E: 20.26, D: 20.26, G: 1.0, F: -6.54, I: 1.0, H: 1.0, K: 1.0, M: 1.0, L: 1.0, N: 1.0, Q: 20.26, P: 20.26, S: 44.94, R: 1.0, T: 1.0, W: 1.0, V: -6.54, Y: -6.54 },
  P: { A: 20.26, C: -6.54, E: 18.38, D: -6.54, G: 1.0, F: 20.26, I: 1.0, H: 1.0, K: 1.0, M: -6.54, L: 1.0, N: 1.0, Q: 20.26, P: 20.26, S: 20.26, R: -6.54, T: 1.0, W: -1.88, V: 20.26, Y: 1.0 },
  S: { A: 1.0, C: 33.6, E: 20.26, D: 1.0, G: 1.0, F: 1.0, I: 1.0, H: 1.0, K: 1.0, M: 1.0, L: 1.0, N: 1.0, Q: 20.26, P: 44.94, S: 20.26, R: 20.26, T: 1.0, W: 1.0, V: 1.0, Y: 1.0 },
  R: { A: 1.0, C: 1.0, E: 1.0, D: 1.0, G: -7.49, F: 1.0, I: 1.0, H: 20.26, K: 1.0, M: 1.0, L: 1.0, N: 13.34, Q: 20.26, P: 20.26, S: 44.94, R: 58.28, T: 1.0, W: 58.28, V: 1.0, Y: -6.54 },
  T: { A: 1.0, C: 1.0, E: 20.26, D: 1.0, G: -7.49, F: 13.34, I: 1.0, H: 1.0, K: 1.0, M: 1.0, L: 1.0, N: -14.03, Q: -6.54, P: 1.0, S: 1.0, R: 1.0, T: 1.0, W: -14.03, V: 1.0, Y: 1.0 },
  W: { A: -14.03, C: 1.0, E: 1.0, D: 1.0, G: -9.37, F: 1.0, I: 1.0, H: 24.68, K: 1.0, M: 24.68, L: 13.34, N: 13.34, Q: 1.0, P: 1.0, S: 1.0, R: 1.0, T: -14.03, W: 1.0, V: -7.49, Y: 1.0 },
  V: { A: 1.0, C: 1.0, E: 1.0, D: -14.03, G: -7.49, F: 1.0, I: 1.0, H: 1.0, K: -1.88, M: 1.0, L: 1.0, N: 1.0, Q: 1.0, P: 20.26, S: 1.0, R: 1.0, T: -7.49, W: 1.0, V: 1.0, Y: -6.54 },
  Y: { A: 24.68, C: 1.0, E: -6.54, D: 24.68, G: -7.49, F: 1.0, I: 1.0, H: 13.34, K: 1.0, M: 44.94, L: 1.0, N: 1.0, Q: 1.0, P: 13.34, S: 1.0, R: -15.91, T: -7.49, W: -9.37, V: 1.0, Y: 13.34 },
};

export interface AaComposition {
  /** One-letter code. */
  aa: string;
  /** Number of occurrences. */
  count: number;
  /** Percentage of the standard-residue length (0-100). */
  percent: number;
}

export interface ProteinResult {
  /** Cleaned, uppercased sequence (standard residues only, used for the math). */
  cleanSequence: string;
  /** Number of standard residues (the divisor for per-residue averages). */
  length: number;
  /** Average molecular weight (g/mol). */
  molecularWeight: number;
  /** Isoelectric point (pH units). */
  isoelectricPoint: number;
  /** Net charge at pH 7.0 (informational). */
  chargeAtPH7: number;
  /** Molar extinction coefficient at 280 nm, all Cys reduced (M^-1 cm^-1). */
  extinctionReduced: number;
  /** Molar extinction coefficient at 280 nm, all Cys forming cystines. */
  extinctionOxidized: number;
  /** A280 of a 1 g/L solution, reduced (= extinctionReduced / MW). */
  a280Reduced: number;
  /** A280 of a 1 g/L solution, oxidized (= extinctionOxidized / MW). */
  a280Oxidized: number;
  /** Guruprasad instability index (>40 => predicted unstable). */
  instabilityIndex: number;
  /** Kyte-Doolittle GRAVY (grand average of hydropathy). */
  gravy: number;
  /** Lobry aromaticity (relative frequency of F+W+Y, 0-1). */
  aromaticity: number;
  /** Ikai aliphatic index. */
  aliphaticIndex: number;
  /** Per-residue composition (counts + percent), 20 standard AAs. */
  composition: AaComposition[];
  /**
   * Non-standard / ambiguous characters that were present and excluded from the
   * math (e.g. X, B, Z, U, O, *, gaps). Uppercased, de-duplicated.
   */
  nonStandardChars: string[];
}

/**
 * Keep only the 20 standard amino acids (uppercased). Whitespace, digits,
 * FASTA headers, and ambiguous residues (B/Z/X/U/O/*) are dropped, matching the
 * way ProtParam computes over standard residues. Returns the cleaned sequence
 * plus the set of distinct non-standard characters seen (for the UI to flag).
 */
export function cleanProteinSeq(raw: string): {
  clean: string;
  nonStandard: string[];
} {
  const upper = (raw || "").toUpperCase();
  const standardSet = new Set(STANDARD_AA);
  let clean = "";
  const nonStandard = new Set<string>();
  for (const ch of upper) {
    if (standardSet.has(ch)) {
      clean += ch;
    } else if (/[A-Z*]/.test(ch)) {
      // A letter (or stop *) that is not a standard residue: B, Z, X, U, O, J, *.
      nonStandard.add(ch);
    }
    // anything else (whitespace, digits, punctuation) is silently ignored.
  }
  return { clean, nonStandard: [...nonStandard].sort() };
}

/** Average molecular weight: sum residue masses - (N-1) water. */
function molecularWeight(seq: string): number {
  if (seq.length === 0) return 0;
  let sum = 0;
  for (const aa of seq) sum += AVG_RESIDUE_MASS[aa];
  return sum - (seq.length - 1) * WATER_AVG;
}

/** Counts of each standard AA in the sequence. */
function countAminoAcids(seq: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const aa of STANDARD_AA) counts[aa] = 0;
  for (const aa of seq) counts[aa] += 1;
  return counts;
}

/**
 * Net charge at a given pH, Bjellqvist / Tabb partial-charge model. Faithful
 * port of IsoelectricPoint.charge_at_pH. Uses the seq-specific terminus pKs.
 */
function chargeAtPH(
  pH: number,
  charged: Record<string, number>,
  posPKs: Record<string, number>,
  negPKs: Record<string, number>,
): number {
  let positive = 0;
  for (const [aa, pK] of Object.entries(posPKs)) {
    const partial = 1.0 / (Math.pow(10, pH - pK) + 1.0);
    positive += charged[aa] * partial;
  }
  let negative = 0;
  for (const [aa, pK] of Object.entries(negPKs)) {
    const partial = 1.0 / (Math.pow(10, pK - pH) + 1.0);
    negative += charged[aa] * partial;
  }
  return positive - negative;
}

/** Build the charged-species content + terminus-adjusted pK tables for a seq. */
function isoelectricSetup(seq: string, counts: Record<string, number>) {
  const charged: Record<string, number> = {};
  for (const aa of CHARGED_AAS) charged[aa] = counts[aa];
  charged.Nterm = 1.0;
  charged.Cterm = 1.0;

  const posPKs = { ...POSITIVE_PKS };
  const negPKs = { ...NEGATIVE_PKS };
  const nterm = seq[0];
  const cterm = seq[seq.length - 1];
  if (nterm in PK_NTERMINAL) posPKs.Nterm = PK_NTERMINAL[nterm];
  if (cterm in PK_CTERMINAL) negPKs.Cterm = PK_CTERMINAL[cterm];
  return { charged, posPKs, negPKs };
}

/**
 * Isoelectric point by bisection over net charge. Faithful port of
 * IsoelectricPoint.pi (start pH 7.775, bracket 4.05..12, tolerance 1e-4). The
 * recursion is unrolled into a loop here; the numeric result is identical.
 */
function isoelectricPoint(
  charged: Record<string, number>,
  posPKs: Record<string, number>,
  negPKs: Record<string, number>,
): number {
  let pH = 7.775;
  let min = 4.05;
  let max = 12;
  // Match Biopython's exact recursion: evaluate charge at pH, then narrow.
  // It checks `max - min > 0.0001` AFTER computing the charge at the current pH.
  // Replicate by looping until the bracket is tight, returning the last pH.
  while (max - min > 0.0001) {
    const charge = chargeAtPH(pH, charged, posPKs, negPKs);
    if (charge > 0.0) {
      min = pH;
    } else {
      max = pH;
    }
    pH = (min + max) / 2;
  }
  return pH;
}

/** Instability index (Guruprasad), (10 / N) * sum DIWV over dipeptides. */
function instabilityIndex(seq: string): number {
  const n = seq.length;
  if (n < 1) return 0;
  let score = 0;
  for (let i = 0; i < n - 1; i++) {
    score += DIWV[seq[i]][seq[i + 1]];
  }
  return (10.0 / n) * score;
}

/** GRAVY: mean Kyte-Doolittle hydropathy over all residues. */
function gravy(seq: string): number {
  if (seq.length === 0) return 0;
  let total = 0;
  for (const aa of seq) total += KYTE_DOOLITTLE[aa];
  return total / seq.length;
}

/** Aromaticity (Lobry): relative frequency of F + W + Y (0-1). */
function aromaticity(counts: Record<string, number>, n: number): number {
  if (n === 0) return 0;
  return (counts.F + counts.W + counts.Y) / n;
}

/**
 * Aliphatic index (Ikai 1980): X_A + 2.9*X_V + 3.9*(X_I + X_L), X = mole %.
 */
function aliphaticIndex(counts: Record<string, number>, n: number): number {
  if (n === 0) return 0;
  const pct = (c: number) => (c * 100.0) / n;
  return (
    pct(counts.A) +
    2.9 * pct(counts.V) +
    3.9 * (pct(counts.I) + pct(counts.L))
  );
}

/**
 * Compute every ProtParam-style property for a raw amino-acid sequence. Returns
 * null only when no standard residue is present (nothing to compute).
 */
export function analyzeProtein(raw: string): ProteinResult | null {
  const { clean, nonStandard } = cleanProteinSeq(raw);
  const n = clean.length;
  if (n === 0) return null;

  const counts = countAminoAcids(clean);
  const mw = molecularWeight(clean);

  const extinctionReduced = counts.W * 5500 + counts.Y * 1490;
  const extinctionOxidized = extinctionReduced + Math.floor(counts.C / 2) * 125;

  const { charged, posPKs, negPKs } = isoelectricSetup(clean, counts);
  const pI = isoelectricPoint(charged, posPKs, negPKs);
  const chargeAt7 = chargeAtPH(7.0, charged, posPKs, negPKs);

  const composition: AaComposition[] = STANDARD_AA.map((aa) => ({
    aa,
    count: counts[aa],
    percent: (counts[aa] * 100.0) / n,
  }));

  return {
    cleanSequence: clean,
    length: n,
    molecularWeight: mw,
    isoelectricPoint: pI,
    chargeAtPH7: chargeAt7,
    extinctionReduced,
    extinctionOxidized,
    a280Reduced: mw > 0 ? extinctionReduced / mw : 0,
    a280Oxidized: mw > 0 ? extinctionOxidized / mw : 0,
    instabilityIndex: instabilityIndex(clean),
    gravy: gravy(clean),
    aromaticity: aromaticity(counts, n),
    aliphaticIndex: aliphaticIndex(counts, n),
    composition,
    nonStandardChars: nonStandard,
  };
}
