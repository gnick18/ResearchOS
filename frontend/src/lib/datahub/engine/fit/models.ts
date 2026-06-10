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
  /** Optional derived readouts (e.g. EC50) from fitted params. */
  derived?: (params: number[]) => Record<string, number>;
}

function range(y: number[]): { lo: number; hi: number } {
  return { lo: Math.min(...y), hi: Math.max(...y) };
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
  paramNames: ["Bottom", "Top", "logEC50", "HillSlope"],
  fn:
    ([bottom, top, logEC50, hill]) =>
    (x: number) =>
      bottom + (top - bottom) / (1 + Math.pow(10, (logEC50 - x) * hill)),
  initialGuess: (x, y) => {
    const { lo, hi } = range(y);
    // logEC50 guessed at the x where y is midway between lo and hi.
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
    return [lo, hi, bestX, 1];
  },
  derived: ([, , logEC50]) => ({
    EC50: Math.pow(10, logEC50),
    IC50: Math.pow(10, logEC50),
    logEC50,
  }),
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
