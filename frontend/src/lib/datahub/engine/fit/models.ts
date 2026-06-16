// Nonlinear model registry for the Data Hub curve fitter. Each model declares
// its parameter names, the parameterized function (params -> (x -> y)) in the
// shape ml-levenberg-marquardt wants, a data-driven initial-guess heuristic,
// optional default bounds, and an optional `derived` reducer that turns the
// fitted parameters into reporting readouts (for example EC50 / IC50).
//
// All x/y are plain numbers. For dose-response the convention (matching
// GraphPad Prism) is that x is log10(dose) and y is response.

import { mean as meanOf } from "../util";

export interface NonlinearModel {
  id: string;
  label: string;
  paramNames: string[];
  /** params -> (x -> predicted y). Matches ml-levenberg-marquardt. */
  fn: (params: number[]) => (x: number) => number;
  /** Heuristic starting parameters from the data. */
  initialGuess: (x: number[], y: number[]) => number[];
  /** Optional default lower / upper bounds (per parameter). */
  defaultBounds?: (
    x: number[],
    y: number[],
  ) => { min: number[]; max: number[] };
  /**
   * Optional canonical-orientation transform applied to the converged parameters
   * before reporting. Used to collapse a model's sign/mirror degeneracy (two
   * parameter sets describing the SAME curve) to one conventional form, so the
   * reported parameters are stable regardless of which equivalent optimum the
   * solver landed on. Must return a parameter set whose curve is identical.
   */
  canonicalize?: (params: number[]) => number[];
  /** Optional derived readouts (e.g. EC50) from fitted params. */
  derived?: (params: number[]) => Record<string, number>;
  /**
   * When true, the model is parameterized in log10(dose): its `fn`, initial
   * guess, bounds, and the EC50 = 10^logEC50 readout all assume x = log10(dose).
   * The analysis and plot fit paths run a raw dose column through
   * `prepareFitData` (drop non-positive doses, take log10) before fitting, so a
   * user picks raw concentrations and still gets EC50 in linear dose units.
   * Absent => x is taken as-is.
   */
  logXInput?: boolean;
}

function range(y: number[]): { lo: number; hi: number } {
  return { lo: Math.min(...y), hi: Math.max(...y) };
}

/** Min/max of an array via a single pass (safe for large inputs, no spread). */
function minMax(v: number[]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of v) {
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  return { lo, hi };
}

/**
 * Sign of the response trend across x: +1 when y rises with x, -1 when it falls,
 * from the sign of the x-y covariance. Returns +1 on flat or degenerate input so
 * the default matches the historical increasing-curve seed.
 */
function trendSign(x: number[], y: number[]): number {
  const mx = meanOf(x);
  const my = meanOf(y);
  let cov = 0;
  for (let i = 0; i < x.length; i++) cov += (x[i] - mx) * (y[i] - my);
  return cov < 0 ? -1 : 1;
}

/**
 * 4-parameter logistic, variable slope (Hill). Dose-response on log(dose).
 *   y = Bottom + (Top - Bottom) / (1 + 10^((logEC50 - x) * HillSlope))
 * Parameters: [Bottom, Top, logEC50, HillSlope].
 * EC50 = 10^logEC50. For an inhibition curve this same value is the IC50.
 */
const fourPL: NonlinearModel = {
  id: "logistic4pl",
  label: "4-parameter logistic (variable slope)",
  logXInput: true,
  paramNames: ["Bottom", "Top", "logEC50", "HillSlope"],
  fn:
    ([bottom, top, logEC50, hill]) =>
    (x: number) =>
      bottom + (top - bottom) / (1 + Math.pow(10, (logEC50 - x) * hill)),
  initialGuess: (x, y) => {
    const { lo, hi } = range(y);
    // logEC50 guessed at the x where y is midway between lo and hi (the half-max
    // crossing).
    const mid = (lo + hi) / 2;
    let bestX = x[Math.floor(x.length / 2)];
    let bestDist = Infinity;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(y[i] - mid);
      if (d < bestDist) {
        bestDist = d;
        bestX = x[i];
      }
    }
    // Seed Bottom / Top from the response min / max (canonical Top >= Bottom) and
    // the Hill SIGN from the data trend: a rising response is an increasing curve
    // (positive Hill), a falling one is decreasing (negative Hill). Without this,
    // a fixed positive seed strands a decreasing curve in the mirror optimum
    // (Top < Bottom, EC50 far outside the data) instead of the true inflection.
    return [lo, hi, bestX, trendSign(x, y)];
  },
  defaultBounds: (x) => {
    // Keep logEC50 within a generous multiple of the tested dose range so the
    // optimizer cannot wander to a half-max decades outside the data (the 1e8
    // EC50 failure). Bottom / Top / Hill stay unbounded.
    const { lo, hi } = minMax(x);
    const span = hi - lo || 1;
    const pad = 3 * span;
    return {
      min: [-Infinity, -Infinity, lo - pad, -Infinity],
      max: [Infinity, Infinity, hi + pad, Infinity],
    };
  },
  // The 4PL has an exact mirror degeneracy: (Bottom, Top, Hill) and
  // (Top, Bottom, -Hill) describe the SAME curve (logEC50 is invariant under the
  // swap). Collapse it to the conventional Top >= Bottom form, with the Hill sign
  // carrying direction, so the reported parameters are one stable answer.
  canonicalize: ([bottom, top, logEC50, hill]) =>
    top >= bottom
      ? [bottom, top, logEC50, hill]
      : [top, bottom, logEC50, -hill],
  derived: ([, , logEC50]) => ({
    EC50: Math.pow(10, logEC50),
    IC50: Math.pow(10, logEC50),
    logEC50,
  }),
};

/**
 * 5-parameter logistic, asymmetric (variable slope plus an asymmetry exponent S).
 * Dose-response on log(dose), the Prism "asymmetric (five parameter)" model.
 *   y = Bottom + (Top - Bottom) / (1 + 10^((logEC50 - x) * HillSlope))^S
 * Parameters: [Bottom, Top, logEC50, HillSlope, S].
 *
 * S relaxes the 4PL's forced symmetry about the inflection point, so the curve
 * can approach its top and bottom plateaus at different rates. The 4PL is the
 * special case S = 1.
 *
 * IMPORTANT, the EC50 is NOT 10^logEC50 when S != 1. The logEC50 PARAMETER marks
 * the curve's inflection-related midpoint, not the concentration at the true
 * half-maximal response. The reported EC50 is the concentration where the
 * response is exactly halfway between Bottom and Top, y = (Top + Bottom) / 2.
 * Setting the model equal to that midpoint and solving for x gives
 *   (1 + 10^((logEC50 - x) * HillSlope))^S = 2
 *   10^((logEC50 - x) * HillSlope) = 2^(1/S) - 1
 *   x_EC50 = logEC50 - log10(2^(1/S) - 1) / HillSlope
 * so EC50 = 10^x_EC50. At S = 1 the correction term is log10(2^1 - 1) = log10(1)
 * = 0 and this collapses to EC50 = 10^logEC50, matching the 4PL exactly. We
 * report both the raw logEC50 parameter and the corrected logEC50True / EC50.
 */
function fivePLHalfMaxShift(hill: number, s: number): number {
  // The constant offset from the logEC50 parameter to the true half-max logEC50.
  // 2^(1/S) - 1 is positive for S > 0, so its log10 is real; guard a degenerate
  // Hill of 0 (the curve has no defined midpoint then) with NaN.
  if (!(hill !== 0) || !(s > 0)) return NaN;
  return -Math.log10(Math.pow(2, 1 / s) - 1) / hill;
}

const fivePL: NonlinearModel = {
  id: "logistic5pl",
  label: "5-parameter logistic (asymmetric)",
  logXInput: true,
  paramNames: ["Bottom", "Top", "logEC50", "HillSlope", "S"],
  fn:
    ([bottom, top, logEC50, hill, s]) =>
    (x: number) =>
      bottom +
      (top - bottom) / Math.pow(1 + Math.pow(10, (logEC50 - x) * hill), s),
  initialGuess: (x, y) => {
    const { lo, hi } = range(y);
    const mid = (lo + hi) / 2;
    let bestX = x[Math.floor(x.length / 2)];
    let bestDist = Infinity;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(y[i] - mid);
      if (d < bestDist) {
        bestDist = d;
        bestX = x[i];
      }
    }
    // Start at the symmetric 4PL (S = 1); the optimizer relaxes S from there.
    return [lo, hi, bestX, 1, 1];
  },
  defaultBounds: () => ({
    // S must stay positive for the model and the half-max shift to be defined.
    min: [-Infinity, -Infinity, -Infinity, -Infinity, 1e-3],
    max: [Infinity, Infinity, Infinity, Infinity, Infinity],
  }),
  derived: ([, , logEC50, hill, s]) => {
    const shift = fivePLHalfMaxShift(hill, s);
    const logEC50True = logEC50 + shift;
    const ec50 = Math.pow(10, logEC50True);
    return {
      // The true half-maximal-response concentration (NOT 10^logEC50 for S != 1).
      EC50: ec50,
      IC50: ec50,
      // The raw fitted parameter (the inflection-related midpoint).
      logEC50,
      // The corrected half-max logEC50 the EC50 is 10^ of.
      logEC50True,
      // The asymmetry exponent, surfaced so a reader can see how far from 4PL.
      S: s,
    };
  },
};

/**
 * Michaelis-Menten enzyme kinetics.
 *   v = Vmax * S / (Km + S)
 * Parameters: [Vmax, Km]. x is substrate concentration S.
 */
const michaelisMenten: NonlinearModel = {
  id: "michaelis-menten",
  label: "Michaelis-Menten",
  paramNames: ["Vmax", "Km"],
  fn:
    ([vmax, km]) =>
    (s: number) =>
      (vmax * s) / (km + s),
  initialGuess: (x, y) => {
    const vmax = Math.max(...y) * 1.1;
    // Km guess: substrate at half-max velocity.
    const half = vmax / 2;
    let bestX = meanOf(x);
    let bestDist = Infinity;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(y[i] - half);
      if (d < bestDist) {
        bestDist = d;
        bestX = x[i];
      }
    }
    return [vmax, Math.max(bestX, 1e-6)];
  },
  defaultBounds: () => ({ min: [0, 0], max: [Infinity, Infinity] }),
};

/**
 * One-phase exponential decay.
 *   y = Plateau + (Y0 - Plateau) * exp(-K * x)
 * Parameters: [Y0, Plateau, K]. Reports tau = 1/K and half-life ln(2)/K.
 */
const expDecay: NonlinearModel = {
  id: "exp-decay-1phase",
  label: "One-phase exponential decay",
  paramNames: ["Y0", "Plateau", "K"],
  fn:
    ([y0, plateau, k]) =>
    (x: number) =>
      plateau + (y0 - plateau) * Math.exp(-k * x),
  initialGuess: (x, y) => {
    const y0 = y[0];
    const plateau = y[y.length - 1];
    const span = Math.max(...x) - Math.min(...x) || 1;
    return [y0, plateau, 1 / span];
  },
  derived: ([, , k]) => ({
    tau: k !== 0 ? 1 / k : NaN,
    halfLife: k !== 0 ? Math.LN2 / k : NaN,
    rateConstant: k,
  }),
};

/**
 * One-phase exponential association.
 *   y = Y0 + (Plateau - Y0) * (1 - exp(-K * x))
 * Parameters: [Y0, Plateau, K].
 */
const expAssociation: NonlinearModel = {
  id: "exp-association-1phase",
  label: "One-phase exponential association",
  paramNames: ["Y0", "Plateau", "K"],
  fn:
    ([y0, plateau, k]) =>
    (x: number) =>
      y0 + (plateau - y0) * (1 - Math.exp(-k * x)),
  initialGuess: (x, y) => {
    const y0 = y[0];
    const plateau = y[y.length - 1];
    const span = Math.max(...x) - Math.min(...x) || 1;
    return [y0, plateau, 1 / span];
  },
  derived: ([, , k]) => ({
    tau: k !== 0 ? 1 / k : NaN,
    halfLife: k !== 0 ? Math.LN2 / k : NaN,
    rateConstant: k,
  }),
};

/**
 * Simple linear y = slope * x + intercept, exposed through the nonlinear path
 * for a uniform API (parameters: [slope, intercept]).
 */
const linear: NonlinearModel = {
  id: "linear",
  label: "Linear",
  paramNames: ["Slope", "Intercept"],
  fn:
    ([m, b]) =>
    (x: number) =>
      m * x + b,
  initialGuess: (x, y) => {
    const mx = meanOf(x);
    const my = meanOf(y);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < x.length; i++) {
      sxx += (x[i] - mx) ** 2;
      sxy += (x[i] - mx) * (y[i] - my);
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    return [slope, my - slope * mx];
  },
};

/** Quadratic polynomial y = a x^2 + b x + c (parameters: [a, b, c]). */
const quadratic: NonlinearModel = {
  id: "polynomial2",
  label: "Quadratic polynomial",
  paramNames: ["a", "b", "c"],
  fn:
    ([a, b, c]) =>
    (x: number) =>
      a * x * x + b * x + c,
  initialGuess: (_x, y) => [0, 0, meanOf(y)],
};

/** Gaussian peak y = Amplitude * exp(-(x - Mean)^2 / (2 Sigma^2)) + Offset. */
const gaussian: NonlinearModel = {
  id: "gaussian",
  label: "Gaussian",
  paramNames: ["Amplitude", "Mean", "Sigma", "Offset"],
  fn:
    ([amp, mu, sigma, offset]) =>
    (x: number) =>
      amp * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) + offset,
  initialGuess: (x, y) => {
    const offset = Math.min(...y);
    const amp = Math.max(...y) - offset;
    // Mean guess: x at the peak y.
    let peakX = x[0];
    let peakY = -Infinity;
    for (let i = 0; i < x.length; i++) {
      if (y[i] > peakY) {
        peakY = y[i];
        peakX = x[i];
      }
    }
    const span = (Math.max(...x) - Math.min(...x)) / 4 || 1;
    return [amp, peakX, span, offset];
  },
};

export const MODELS: Record<string, NonlinearModel> = {
  [fourPL.id]: fourPL,
  [fivePL.id]: fivePL,
  [michaelisMenten.id]: michaelisMenten,
  [expDecay.id]: expDecay,
  [expAssociation.id]: expAssociation,
  [linear.id]: linear,
  [quadratic.id]: quadratic,
  [gaussian.id]: gaussian,
};

export function getModel(id: string): NonlinearModel | undefined {
  return MODELS[id];
}

export function listModels(): Array<{ id: string; label: string }> {
  return Object.values(MODELS).map((m) => ({ id: m.id, label: m.label }));
}

/** True when model `id` is parameterized in log10(dose) (see `logXInput`). */
export function modelExpectsLogX(id: string): boolean {
  return getModel(id)?.logXInput === true;
}

/**
 * How a log-dose model's X column should be read:
 *  - "auto" (default): infer from the data (see `xLooksLogDose`);
 *  - "concentration": X is raw concentration, log10-transform it internally;
 *  - "logDose": X is already log10(dose), fit it as-is (no transform).
 * Only meaningful for a log-dose model (logXInput); ignored by every other model.
 */
export type DoseXScale = "auto" | "concentration" | "logDose";

/**
 * Heuristic: does this X column already hold log10(dose) rather than raw
 * concentration? A concentration is non-negative (there is no negative molar
 * amount), so any strictly-negative finite dose means the column was already
 * log-transformed — the ubiquitous GraphPad/Prism "log[agonist] (M)" column
 * (e.g. -9, -8.5, ..., -4). A lone zero is NOT a signal: a zero-dose (vehicle)
 * row is a legitimate raw concentration that log10 simply drops, so only strict
 * negatives flip the verdict and an all-positive column always reads as raw.
 */
export function xLooksLogDose(x: number[]): boolean {
  for (const xi of x) {
    if (Number.isFinite(xi) && xi < 0) return true;
  }
  return false;
}

/**
 * Whether `prepareFitData` will log10-transform X for model `id` given this X
 * column and the chosen scale: true only for a log-dose model fed raw
 * concentration (after "auto" detection, or an explicit "concentration"). This
 * is the SINGLE source of truth for the transform decision, so the analysis fit,
 * the rendered fit curve, and the generated R/Python all stay in lockstep — read
 * it instead of branching on `logXInput` directly.
 */
export function fitLog10sDose(
  id: string,
  x: number[],
  scale: DoseXScale = "auto",
): boolean {
  if (!modelExpectsLogX(id)) return false;
  if (scale === "logDose") return false;
  if (scale === "concentration") return true;
  return !xLooksLogDose(x);
}

/** The (x, y) pairs ready to fit, plus a record of what the preparation did. */
export interface PreparedFitData {
  x: number[];
  y: number[];
  /**
   * How many finite pairs the positive-dose filter dropped (log10 has no value
   * at x <= 0). 0 unless a raw-dose log transform actually ran; lets the caller
   * explain a too-few-points failure that the drop caused.
   */
  droppedNonPositive: number;
  /** True when X was replaced by log10(X) (raw concentration -> log-dose space). */
  logTransformed: boolean;
}

/**
 * Prepare (x, y) pairs for fitting model `id`. For a log-dose model fed raw
 * concentration (see `fitLog10sDose`) this drops non-positive / non-finite doses
 * — log10 has no value there — and replaces x with log10(x), so a RAW dose
 * column fits the model's log10(dose) parameterization and EC50 = 10^logEC50
 * lands back in linear dose units. A log-dose model whose X already looks
 * log-transformed (or when `scale` says so) is fit as-is, so a "log[agonist]"
 * column no longer has every point discarded by the positive-x filter. Any other
 * model gets its pairs back unchanged. x and y stay paired; the returned arrays
 * are fresh (callers can keep the originals for display).
 */
export function prepareFitData(
  id: string,
  x: number[],
  y: number[],
  scale: DoseXScale = "auto",
): PreparedFitData {
  if (!fitLog10sDose(id, x, scale)) {
    return { x, y, droppedNonPositive: 0, logTransformed: false };
  }
  const fx: number[] = [];
  const fy: number[] = [];
  let droppedNonPositive = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (!Number.isFinite(xi)) continue;
    if (xi > 0) {
      fx.push(Math.log10(xi));
      fy.push(y[i]);
    } else {
      droppedNonPositive++;
    }
  }
  return { x: fx, y: fy, droppedNonPositive, logTransformed: true };
}

/**
 * The offset from a 5PL logEC50 parameter to the true half-maximal-response
 * logEC50, exported so the dose-response analysis can transform the fitter's CI
 * on the logEC50 parameter into the corrected half-max logEC50 (and thence EC50)
 * without re-deriving the formula. See `fivePL` for the derivation. Returns 0 for
 * the symmetric case (S = 1), since the 4PL needs no correction.
 */
export function fivePLLogEC50Shift(hill: number, s: number): number {
  return fivePLHalfMaxShift(hill, s);
}
