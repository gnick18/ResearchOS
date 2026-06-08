/**
 * Nearest-neighbor primer melting-temperature (Tm), the accurate model used by
 * IDT OligoAnalyzer, Primer3, NEB, Benchling and SnapGene — replacing the crude
 * %GC / Wallace estimates for real primers.
 *
 * This is a faithful, self-contained TypeScript port of Biopython's
 * `Bio.SeqUtils.MeltingTemp.Tm_NN` (BSD) for the perfect-complement primer case
 * (no mismatches / dangling ends), which is all a primer Tm calculator needs.
 * The numbers are transcribed verbatim from Biopython / the source literature so
 * they are not approximations:
 *
 *  - Nearest-neighbor dH/dS table: DNA_NN3 = Allawi & SantaLucia (1997),
 *    Biochemistry 36: 10581-10594 (Biopython's default; the basis of the
 *    SantaLucia 1998 "unified" set). dH in kcal/mol, dS in cal/(mol*K).
 *  - Sodium-equivalent for K+/Tris and Mg2+/dNTP: von Ahsen et al. (2001),
 *    Clin Chem 47: 1956-1961  ->  [Na_eq] = [Na+]+[K+]+[Tris]/2 +
 *    120*sqrt([Mg2+]-[dNTPs])  (dNTPs chelate Mg2+; the divalent term drops out
 *    when [dNTPs] >= [Mg2+]).
 *  - Salt correction on entropy: SantaLucia (1998), PNAS 95: 1460-1465
 *    ("method 5"):  dS += 0.368 * (N-1) * ln[Na_eq].
 *  - Tm = (1000 * dH) / (dS + R * ln(k)) - 273.15, R = 1.987 cal/(mol*K),
 *    k the effective strand-concentration term.
 *
 * Reference values reproduced by tm-nn.test.ts (Biopython Tm_NN, DNA_NN3,
 * dnac1=dnac2=25 nM i.e. 50 nM total, saltcorr=5):
 *   CGTTCCAAAGATGTGGGCATGAGCTTAC, Na=50               -> 60.32 C
 *   CGTTCCAAAGATGTGGGCATGAGCTTAC, Na=50, Tris=10       -> 60.79 C
 *   CGTTCCAAAGATGTGGGCATGAGCTTAC, Na=50, Tris=10, Mg=1.5 -> 67.39 C
 *
 * Reusable beyond the calculator: the sequence-editor arc's primer-design Tm
 * should import this rather than vendoring a second Tm implementation.
 */

/** dH (kcal/mol), dS (cal/(mol*K)) per nearest-neighbor / initiation term. */
type NnPair = readonly [number, number];

/**
 * DNA_NN3 — Allawi & SantaLucia (1997). Keys read 5'-XY-3' / 3'-WZ-5'
 * (W=complement of X). Verbatim from Biopython MeltingTemp.DNA_NN3.
 */
const DNA_NN3: Record<string, NnPair> = {
  init: [0, 0],
  "init_A/T": [2.3, 4.1],
  "init_G/C": [0.1, -2.8],
  "init_oneG/C": [0, 0],
  "init_allA/T": [0, 0],
  "init_5T/A": [0, 0],
  sym: [0, -1.4],
  "AA/TT": [-7.9, -22.2],
  "AT/TA": [-7.2, -20.4],
  "TA/AT": [-7.2, -21.3],
  "CA/GT": [-8.5, -22.7],
  "GT/CA": [-8.4, -22.4],
  "CT/GA": [-7.8, -21.0],
  "GA/CT": [-8.2, -22.2],
  "CG/GC": [-10.6, -27.2],
  "GC/CG": [-9.8, -24.4],
  "GG/CC": [-8.0, -19.9],
};

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };
const R = 1.987; // universal gas constant, cal/(mol*K)

export interface NnTmOptions {
  /** Monovalent Na+ concentration (mM). Default 50 (typical PCR / IDT). */
  na?: number;
  /** Monovalent K+ concentration (mM). Default 0. */
  k?: number;
  /** Tris buffer concentration (mM). Default 0. */
  tris?: number;
  /** Divalent Mg2+ concentration (mM). Default 0. */
  mg?: number;
  /** dNTP concentration (mM); chelates Mg2+. Default 0. */
  dntps?: number;
  /** Total oligo strand concentration C_T (nM). Default 250 (IDT 0.25 uM). */
  oligoNanomolar?: number;
  /** Self-complementary primer (hairpin/palindrome). Default false. */
  selfComplementary?: boolean;
}

export interface NnTmResult {
  /** Melting temperature in degrees Celsius. */
  tm: number;
  /** Total binding enthalpy, kcal/mol. */
  deltaH: number;
  /** Total binding entropy (salt-corrected), cal/(mol*K). */
  deltaS: number;
  /** Sodium-equivalent monovalent concentration actually used (molar). */
  naEqMolar: number;
  /** Cleaned sequence length (bases). */
  length: number;
}

/** Uppercase, fold RNA U into T, drop anything that is not A/C/G/T. */
export function cleanDnaSeq(seq: string): string {
  return (seq || "").toUpperCase().replace(/U/g, "T").replace(/[^ACGT]/g, "");
}

/**
 * von Ahsen (2001) sodium-equivalent in MOLAR, folding in K+/Tris and the
 * Mg2+/dNTP divalent term. Returns null if the total monovalent-equivalent is
 * non-positive (the entropy salt correction needs ln of a positive molarity).
 */
function sodiumEquivalentMolar(
  na: number,
  k: number,
  tris: number,
  mg: number,
  dntps: number,
): number | null {
  let monMM = na + k + tris / 2;
  // dNTPs bind Mg2+ strongly; only free Mg2+ ( = Mg - dNTPs ) contributes, and
  // only when something other than plain Na is present (matches Biopython).
  if (k + mg + tris + dntps > 0 && dntps < mg) {
    monMM += 120 * Math.sqrt(mg - dntps);
  }
  const monM = monMM * 1e-3;
  return monM > 0 ? monM : null;
}

/**
 * Nearest-neighbor Tm for a primer binding its perfect complement. Returns null
 * for sequences shorter than 2 bases (no nearest-neighbor pair) or unusable
 * salt input. Mismatches / dangling ends are intentionally out of scope.
 */
export function nearestNeighborTm(
  rawSeq: string,
  opts: NnTmOptions = {},
): NnTmResult | null {
  const seq = cleanDnaSeq(rawSeq);
  const N = seq.length;
  if (N < 2) return null;

  const {
    na = 50,
    k = 0,
    tris = 0,
    mg = 0,
    dntps = 0,
    oligoNanomolar = 250,
    selfComplementary = false,
  } = opts;

  const monM = sodiumEquivalentMolar(na, k, tris, mg, dntps);
  if (monM === null) return null;
  if (!(oligoNanomolar > 0)) return null;

  const t = DNA_NN3;
  let dH = t.init[0];
  let dS = t.init[1];

  // Initiation: all-A/T vs at-least-one-G/C (both zero in NN3, kept for fidelity).
  const gcCount = (seq.match(/[GC]/g) || []).length;
  const initGC = gcCount === 0 ? t["init_allA/T"] : t["init_oneG/C"];
  dH += initGC[0];
  dS += initGC[1];

  // 5'-T and 3'-A penalties (zero in NN3, kept for fidelity / other tables).
  if (seq.startsWith("T")) {
    dH += t["init_5T/A"][0];
    dS += t["init_5T/A"][1];
  }
  if (seq.endsWith("A")) {
    dH += t["init_5T/A"][0];
    dS += t["init_5T/A"][1];
  }

  // Terminal-basepair initiation: each terminal A/T vs G/C carries its own term.
  const ends = seq[0] + seq[N - 1];
  const atEnds = (ends.match(/[AT]/g) || []).length;
  const gcEnds = (ends.match(/[GC]/g) || []).length;
  dH += t["init_A/T"][0] * atEnds + t["init_G/C"][0] * gcEnds;
  dS += t["init_A/T"][1] * atEnds + t["init_G/C"][1] * gcEnds;

  // Zipping: sum each nearest-neighbor dimer. The complement strand is the
  // base-wise complement (not reverse), matching Biopython; look the dimer up
  // forward, else by the fully-reversed key.
  for (let i = 0; i < N - 1; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    const key = `${a}${b}/${COMPLEMENT[a]}${COMPLEMENT[b]}`;
    const rev = key.split("").reverse().join("");
    const pair = t[key] ?? t[rev];
    if (!pair) return null; // unreachable for clean DNA, but fail safe
    dH += pair[0];
    dS += pair[1];
  }

  // Effective strand-concentration term k. For non-self-complementary duplexes
  // the convention (Primer3 / MELTING) is C_T / 4; self-complementary is C_T / 2
  // and carries the symmetry term.
  let kConc: number;
  if (selfComplementary) {
    dH += t.sym[0];
    dS += t.sym[1];
    kConc = (oligoNanomolar / 2) * 1e-9;
  } else {
    kConc = (oligoNanomolar / 4) * 1e-9;
  }

  // Salt correction on entropy (SantaLucia 1998, method 5).
  dS += 0.368 * (N - 1) * Math.log(monM);

  const denom = dS + R * Math.log(kConc);
  if (denom === 0) return null;
  const tm = (1000 * dH) / denom - 273.15;
  if (!Number.isFinite(tm)) return null;

  return { tm, deltaH: dH, deltaS: dS, naEqMolar: monM, length: N };
}
