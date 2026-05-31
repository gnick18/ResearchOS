/**
 * Unit-prefix helpers for the bench calculators.
 *
 * The calculators speak in canonical SI base units internally (moles for
 * amount, molar for concentration, liters for volume, grams for mass) and
 * convert at the form boundary. Keeping the conversion factors in one place
 * means a single source of truth for "what does nM mean" across every tab,
 * and lets the unit tests assert the factors directly.
 *
 * No storage, no side effects: pure functions only.
 */

/** Concentration units, canonical = molar (M). */
export type ConcUnit = "nM" | "uM" | "mM" | "M";

/** Volume units, canonical = liter (L). */
export type VolUnit = "uL" | "mL" | "L";

/** Mass units, canonical = gram (g). */
export type MassUnit = "ng" | "ug" | "mg" | "g";

/** Amount-of-substance units, canonical = mole (mol). */
export type MoleUnit = "pmol" | "nmol" | "umol" | "mmol" | "mol";

/** Multiply a value in the given unit by its factor to reach the base unit. */
export const CONC_FACTOR: Record<ConcUnit, number> = {
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1,
};

export const VOL_FACTOR: Record<VolUnit, number> = {
  uL: 1e-6,
  mL: 1e-3,
  L: 1,
};

export const MASS_FACTOR: Record<MassUnit, number> = {
  ng: 1e-9,
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
};

export const MOLE_FACTOR: Record<MoleUnit, number> = {
  pmol: 1e-12,
  nmol: 1e-9,
  umol: 1e-6,
  mmol: 1e-3,
  mol: 1,
};

export const CONC_UNITS: ConcUnit[] = ["nM", "uM", "mM", "M"];
export const VOL_UNITS: VolUnit[] = ["uL", "mL", "L"];
export const MASS_UNITS: MassUnit[] = ["ng", "ug", "mg", "g"];
export const MOLE_UNITS: MoleUnit[] = ["pmol", "nmol", "umol", "mmol", "mol"];

/** Convert a concentration value+unit to molar (M). */
export function concToBase(value: number, unit: ConcUnit): number {
  return value * CONC_FACTOR[unit];
}

/** Convert a molar (M) value to the requested concentration unit. */
export function concFromBase(baseM: number, unit: ConcUnit): number {
  return baseM / CONC_FACTOR[unit];
}

export function volToBase(value: number, unit: VolUnit): number {
  return value * VOL_FACTOR[unit];
}

export function volFromBase(baseL: number, unit: VolUnit): number {
  return baseL / VOL_FACTOR[unit];
}

export function massToBase(value: number, unit: MassUnit): number {
  return value * MASS_FACTOR[unit];
}

export function massFromBase(baseG: number, unit: MassUnit): number {
  return baseG / MASS_FACTOR[unit];
}

export function moleToBase(value: number, unit: MoleUnit): number {
  return value * MOLE_FACTOR[unit];
}

export function moleFromBase(baseMol: number, unit: MoleUnit): number {
  return baseMol / MOLE_FACTOR[unit];
}

/**
 * Parse a free-typed numeric input. Returns `null` for empty / whitespace /
 * non-numeric so callers can render nothing (never NaN). Negative and zero
 * are returned as-is; callers decide whether those make physical sense.
 */
export function parseNum(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Format a number for display with a sensible number of significant figures.
 * Avoids scientific-notation surprises for the common bench range and trims
 * trailing zeros. Returns "" for non-finite input so the UI shows nothing.
 */
export function formatNum(n: number, sigFigs = 4): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  // Very large or very small: fall back to exponential so we do not print
  // dozens of zeros.
  if (abs >= 1e7 || abs < 1e-4) {
    return trimZeros(n.toExponential(Math.max(0, sigFigs - 1)));
  }
  // toPrecision then strip trailing zeros for a clean fixed-point reading.
  const s = n.toPrecision(sigFigs);
  return trimZeros(Number(s).toString());
}

function trimZeros(s: string): string {
  // Number(...).toString() already trims, but toExponential leaves e.g.
  // "1.5400e+3"; normalise that path.
  if (s.includes("e") || s.includes("E")) {
    const [mantissa, exp] = s.split(/[eE]/);
    let m = mantissa;
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    return `${m}e${exp}`;
  }
  return s;
}
