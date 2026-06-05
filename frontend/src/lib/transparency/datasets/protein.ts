/**
 * Protein-parameter showcase cases for the transparency page.
 *
 * Each case runs `analyzeProtein` on a peptide and compares several derived
 * quantities (molecular weight, isoelectric point, molar extinction coefficient
 * reduced and oxidized, instability index, GRAVY, aliphatic index) against
 * Biopython's Bio.SeqUtils.ProtParam.ProteinAnalysis, the engine the ExPASy
 * ProtParam web tool implements.
 *
 * Expected values are lifted verbatim from the committed golden suite
 * (`lib/calculators/protein.golden.test.ts`), which derives them from
 * `frontend/scripts/gen-protein-golden.py` run against Biopython. ResearchOS is a
 * faithful port (verbatim constant tables), so the two must agree to
 * floating-point precision.
 */

export interface ProteinExpect {
  mw: number;
  pi: number;
  epsReduced: number;
  epsOxidized: number;
  instability: number;
  gravy: number;
  aliphatic: number;
}

export interface ProteinCase {
  id: string;
  label: string;
  seq: string;
  bio: ProteinExpect;
}

export const PROTEIN_CASES: ProteinCase[] = [
  {
    id: "peter",
    label: "PETER (Biopython pI anchor)",
    seq: "PETER",
    bio: { mw: 630.6481, pi: 4.5321, epsReduced: 0, epsOxidized: 0, instability: 81.28, gravy: -2.76, aliphatic: 0.0 },
  },
  {
    id: "ingar",
    label: "INGAR (Biopython pI anchor)",
    seq: "INGAR",
    bio: { mw: 529.5904, pi: 9.75, epsReduced: 0, epsOxidized: 0, instability: -39.04, gravy: -0.42, aliphatic: 98.0 },
  },
  {
    id: "only_trp",
    label: "AWAWAWA (tryptophan, high extinction)",
    seq: "AWAWAWA",
    bio: { mw: 860.9566, pi: 5.57, epsReduced: 16500, epsOxidized: 16500, instability: -55.842857, gravy: 0.642857, aliphatic: 57.1429 },
  },
  {
    id: "with_cystines",
    label: "ACACACACAC (cystines, oxidized extinction)",
    seq: "ACACACACAC",
    bio: { mw: 889.1193, pi: 5.5307, epsReduced: 0, epsOxidized: 250, instability: 228.7, gravy: 2.15, aliphatic: 50.0 },
  },
];

/** Metric definitions: how to pull each quantity and how tightly it must match. */
export interface ProteinMetric {
  key: keyof ProteinExpect;
  label: string;
  unit: string;
  /** Faithful-port tolerance, scaled to the metric's magnitude. */
  pass: number;
  warn: number;
}

export const PROTEIN_METRICS: ProteinMetric[] = [
  { key: "mw", label: "Molecular weight", unit: "g/mol", pass: 0.05, warn: 0.5 },
  { key: "pi", label: "Isoelectric point (pI)", unit: "pH", pass: 0.01, warn: 0.05 },
  { key: "epsReduced", label: "Extinction (reduced)", unit: "M⁻¹cm⁻¹", pass: 1, warn: 5 },
  { key: "epsOxidized", label: "Extinction (oxidized)", unit: "M⁻¹cm⁻¹", pass: 1, warn: 5 },
  { key: "instability", label: "Instability index", unit: "", pass: 0.05, warn: 0.5 },
  { key: "gravy", label: "GRAVY", unit: "", pass: 0.005, warn: 0.05 },
  { key: "aliphatic", label: "Aliphatic index", unit: "", pass: 0.05, warn: 0.5 },
];
