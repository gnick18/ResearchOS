/**
 * Bench calculators: pure client-side math, no storage, no side effects.
 *
 * Every function in this module takes already-converted base-unit numbers
 * (moles, molar, liters, grams) where relevant and returns base-unit numbers,
 * so the conversion lives at the form boundary (see units.ts). Each function
 * returns `null` (or a result object with null fields) when inputs are
 * missing or would divide by zero, so the UI can render nothing instead of
 * NaN / Infinity.
 *
 * The math here is the whole point of this feature, so it is covered by
 * hand-verified reference values in calculators.test.ts.
 */

/** A clean finite number, or null if the input was non-finite / unusable. */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 1. Molarity:  n = m / MW,  C = n / V
// All inputs/outputs in base units (grams, g/mol, mol, liters, molar).
// ---------------------------------------------------------------------------

/** moles = mass(g) / molecularWeight(g/mol). */
export function molesFromMass(massG: number, mwGPerMol: number): number | null {
  if (!(mwGPerMol > 0)) return null;
  return finiteOrNull(massG / mwGPerMol);
}

/** mass(g) = moles * molecularWeight(g/mol). */
export function massFromMoles(moles: number, mwGPerMol: number): number | null {
  if (!(mwGPerMol >= 0)) return null;
  return finiteOrNull(moles * mwGPerMol);
}

/** concentration(M) = moles / volume(L). */
export function concFromMolesVolume(moles: number, volL: number): number | null {
  if (!(volL > 0)) return null;
  return finiteOrNull(moles / volL);
}

/** moles = concentration(M) * volume(L). */
export function molesFromConcVolume(concM: number, volL: number): number | null {
  if (!(volL >= 0)) return null;
  return finiteOrNull(concM * volL);
}

/** mass(g) needed for a target concentration in a given volume. */
export function massFromConcVolumeMw(
  concM: number,
  volL: number,
  mwGPerMol: number,
): number | null {
  if (!(volL >= 0) || !(mwGPerMol >= 0)) return null;
  return finiteOrNull(concM * volL * mwGPerMol);
}

// ---------------------------------------------------------------------------
// 2. Dilution:  C1 * V1 = C2 * V2  (solve for the missing variable)
// All concentrations in the same unit, all volumes in the same unit.
// ---------------------------------------------------------------------------

/** Solve for stock volume V1 = (C2 * V2) / C1. */
export function dilutionV1(c1: number, c2: number, v2: number): number | null {
  if (!(c1 > 0)) return null;
  return finiteOrNull((c2 * v2) / c1);
}

/** Solve for final volume V2 = (C1 * V1) / C2. */
export function dilutionV2(c1: number, v1: number, c2: number): number | null {
  if (!(c2 > 0)) return null;
  return finiteOrNull((c1 * v1) / c2);
}

/** Solve for stock concentration C1 = (C2 * V2) / V1. */
export function dilutionC1(c2: number, v2: number, v1: number): number | null {
  if (!(v1 > 0)) return null;
  return finiteOrNull((c2 * v2) / v1);
}

/** Solve for final concentration C2 = (C1 * V1) / V2. */
export function dilutionC2(c1: number, v1: number, v2: number): number | null {
  if (!(v2 > 0)) return null;
  return finiteOrNull((c1 * v1) / v2);
}

// ---------------------------------------------------------------------------
// 3. Serial dilution
// ---------------------------------------------------------------------------

export interface SerialDilutionStep {
  /** 1-based step index. */
  step: number;
  /** Resulting concentration at this step (same unit as the start). */
  concentration: number;
  /**
   * Volume of sample carried into this tube to hit `finalVolume` at the
   * chosen fold factor. Same unit as `finalVolume`.
   */
  sampleVolume: number;
  /** Volume of diluent in this tube. Same unit as `finalVolume`. */
  diluentVolume: number;
}

/**
 * Build a serial-dilution table.
 *
 * Each tube takes `sampleVolume` of the previous tube (or the stock for the
 * first tube) and tops up with diluent to `finalVolume`, giving a `fold`-fold
 * dilution per step. With transfer volume t and final volume Vf, the fold
 * factor is Vf / t, so the sample volume per tube is Vf / fold.
 *
 * Returns [] for nonsensical inputs (fold <= 1, steps < 1, non-positive
 * volume/conc) so the UI can render an empty table rather than NaN rows.
 */
export function serialDilution(
  startConc: number,
  fold: number,
  steps: number,
  finalVolume: number,
): SerialDilutionStep[] {
  if (!(fold > 1)) return [];
  if (!(finalVolume > 0)) return [];
  if (!(startConc > 0)) return [];
  const n = Math.floor(steps);
  if (!(n >= 1)) return [];
  if (n > 1000) return []; // guard runaway tables

  const sampleVolume = finalVolume / fold;
  const diluentVolume = finalVolume - sampleVolume;

  const rows: SerialDilutionStep[] = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      step: i,
      concentration: startConc / Math.pow(fold, i),
      sampleVolume,
      diluentVolume,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 4. Tm (primer melting temperature)
// ---------------------------------------------------------------------------

export interface SequenceStats {
  /** Cleaned sequence length in bases (A/C/G/T/U only). */
  length: number;
  /** GC fraction in percent (0-100), or null if length is 0. */
  gcPercent: number | null;
  a: number;
  c: number;
  g: number;
  t: number;
  /** Count of U bases (RNA input). */
  u: number;
}

/**
 * Normalise + count a nucleic-acid sequence. Whitespace and non-ACGTU
 * characters are ignored. U is folded into the "T" weight for Tm purposes by
 * callers but counted separately here so the UI can show RNA composition.
 */
export function sequenceStats(seq: string): SequenceStats {
  const clean = (seq || "").toUpperCase().replace(/[^ACGTU]/g, "");
  let a = 0;
  let c = 0;
  let g = 0;
  let t = 0;
  let u = 0;
  for (const ch of clean) {
    if (ch === "A") a++;
    else if (ch === "C") c++;
    else if (ch === "G") g++;
    else if (ch === "T") t++;
    else if (ch === "U") u++;
  }
  const length = clean.length;
  const gc = g + c;
  return {
    length,
    gcPercent: length > 0 ? (gc / length) * 100 : null,
    a,
    c,
    g,
    t,
    u,
  };
}

/**
 * Wallace rule (the "2-4 rule") for short oligos:
 *   Tm = 2 * (A + T + U) + 4 * (G + C)
 * Returns null for an empty/invalid sequence.
 */
export function tmWallace(seq: string): number | null {
  const s = sequenceStats(seq);
  if (s.length === 0) return null;
  return 2 * (s.a + s.t + s.u) + 4 * (s.g + s.c);
}

/**
 * Salt-adjusted basic Tm estimate (Marmur-Doty style with a monovalent-salt
 * correction), suitable for oligos longer than the Wallace-rule regime.
 *
 *   Tm = 81.5 + 16.6 * log10([Na+]) + 0.41 * (%GC) - 600 / length
 *
 * [Na+] is the monovalent cation concentration in molar (default 0.05 M).
 * Returns null for an empty/invalid sequence or non-positive salt.
 */
export function tmSaltAdjusted(seq: string, naMolar = 0.05): number | null {
  const s = sequenceStats(seq);
  if (s.length === 0) return null;
  if (!(naMolar > 0)) return null;
  if (s.gcPercent === null) return null;
  const tm =
    81.5 + 16.6 * Math.log10(naMolar) + 0.41 * s.gcPercent - 600 / s.length;
  return finiteOrNull(tm);
}

// ---------------------------------------------------------------------------
// 5. DNA / RNA conversion
// ---------------------------------------------------------------------------

export type NucleicAcidKind = "dsDNA" | "ssDNA" | "RNA";

/** Average molecular weight per base, in g/mol (per bp for ds, per nt for ss). */
export const AVG_MW_PER_BASE: Record<NucleicAcidKind, number> = {
  dsDNA: 650, // per base pair
  ssDNA: 330, // per nucleotide
  RNA: 330, // per nucleotide
};

/**
 * pmol of nucleic acid from mass.
 *   pmol = (mass_ng * 1e6) / (length * avgMW)   ... but we work in base units:
 *   moles = mass(g) / (length * avgMW)
 * Returns moles. Caller converts to pmol via units.ts.
 */
export function naMolesFromMass(
  massG: number,
  length: number,
  kind: NucleicAcidKind,
): number | null {
  if (!(length > 0)) return null;
  const mw = length * AVG_MW_PER_BASE[kind];
  if (!(mw > 0)) return null;
  return finiteOrNull(massG / mw);
}

/** mass(g) of nucleic acid from moles. */
export function naMassFromMoles(
  moles: number,
  length: number,
  kind: NucleicAcidKind,
): number | null {
  if (!(length > 0)) return null;
  const mw = length * AVG_MW_PER_BASE[kind];
  return finiteOrNull(moles * mw);
}

/** ng per A260 unit (1 cm path) for each nucleic-acid kind. */
export const NG_PER_A260: Record<NucleicAcidKind, number> = {
  dsDNA: 50,
  ssDNA: 33,
  RNA: 40,
};

/**
 * Concentration from an A260 reading.
 *   conc(ng/uL) = A260 * factor * dilutionFactor
 * Returns ng/uL (the conventional unit for this readout). Negative A260 or
 * non-positive dilution factor returns null.
 */
export function concFromA260(
  a260: number,
  kind: NucleicAcidKind,
  dilutionFactor = 1,
): number | null {
  if (a260 < 0) return null;
  if (!(dilutionFactor > 0)) return null;
  return finiteOrNull(a260 * NG_PER_A260[kind] * dilutionFactor);
}

// ---------------------------------------------------------------------------
// 6. Buffer / recipe
// ---------------------------------------------------------------------------

export interface BufferComponentInput {
  name: string;
  /** Target final concentration of this component, in molar (M). */
  finalConcM: number;
  /** Stock concentration of this component, in molar (M). */
  stockConcM: number;
}

export interface BufferComponentResult {
  name: string;
  /** Volume of this stock to add, in liters. null if unsolvable. */
  volumeL: number | null;
}

export interface BufferRecipeResult {
  components: BufferComponentResult[];
  /**
   * Volume of diluent (solvent) to top up to the total, in liters. null if
   * the component volumes are unsolvable or exceed the total volume.
   */
  diluentL: number | null;
  /** Sum of the solved component stock volumes, in liters. */
  totalStockL: number;
  /** True when the component stocks alone overflow the requested total. */
  overflows: boolean;
}

/**
 * Buffer / recipe calculator.
 *
 * For each component, volume_of_stock = (Cfinal * Vtotal) / Cstock (a direct
 * application of C1*V1 = C2*V2). The diluent is whatever is left to reach the
 * total volume. All volumes returned in liters.
 *
 * A component with a non-positive stock concentration is unsolvable and gets
 * a null volume (and is excluded from the diluent math, with `overflows`
 * staying based on the solvable components). If the solvable component
 * volumes exceed the total, `overflows` is true and `diluentL` is null.
 */
export function bufferRecipe(
  components: BufferComponentInput[],
  totalVolumeL: number,
): BufferRecipeResult {
  if (!(totalVolumeL > 0)) {
    return {
      components: components.map((c) => ({ name: c.name, volumeL: null })),
      diluentL: null,
      totalStockL: 0,
      overflows: false,
    };
  }

  let totalStockL = 0;
  let anyUnsolvable = false;
  const resolved: BufferComponentResult[] = components.map((c) => {
    if (!(c.stockConcM > 0)) {
      anyUnsolvable = true;
      return { name: c.name, volumeL: null };
    }
    const v = (c.finalConcM * totalVolumeL) / c.stockConcM;
    if (!Number.isFinite(v) || v < 0) {
      anyUnsolvable = true;
      return { name: c.name, volumeL: null };
    }
    totalStockL += v;
    return { name: c.name, volumeL: v };
  });

  const overflows = totalStockL > totalVolumeL;
  const diluentL =
    anyUnsolvable || overflows ? null : totalVolumeL - totalStockL;

  return { components: resolved, diluentL, totalStockL, overflows };
}
