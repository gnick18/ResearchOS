// Global (shared-parameter) nonlinear curve fitting.
//
// Fits ONE model form to SEVERAL XY datasets at once, where each parameter is
// either SHARED across all datasets (one value fit globally) or LOCAL (fit
// separately per dataset). This is GraphPad Prism's "global fitting". The
// signature pharmacology case is a dose-response across several curves that
// share the Hill slope and the Top / Bottom plateaus but have a separate EC50
// (logEC50) each, so the EC50s can be compared with every curve held to a
// common shape.
//
// We reuse the SAME Levenberg-Marquardt core the single-dataset fitter uses
// (ml-levenberg-marquardt), not a new optimizer. The trick is to stack all
// datasets into one long (x, y) vector. We give the LM library a synthetic x
// that is just the running index 0..N-1 over the concatenation, and a combined
// model closure that, for a packed global parameter vector, looks up which
// dataset the index falls in, unpacks that dataset's per-parameter values
// (shared slots are reused, local slots are per-dataset), and evaluates the
// model. The residual LM minimizes is then the total sum of squares over every
// point of every dataset, exactly the global objective.
//
// Standard errors and CIs follow the single fitter's recipe verbatim. We build
// the numeric Jacobian of the stacked model wrt the packed global parameter
// vector at the solution, form J^T J, scale by s^2 = SSR_total / (N_total - P)
// and pseudo-invert for pcov. Each packed parameter's SE = sqrt(pcov[j][j]) and
// its 95% CI uses the t critical value on the total residual degrees of freedom,
// the same interval scipy and Prism report.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { Matrix, pseudoInverse } from "ml-matrix";
import { levenbergMarquardt } from "ml-levenberg-marquardt";

import { tCritTwoSided } from "../dists";
import type { EngineResult, FitParameter } from "../types";
import { getModel, type NonlinearModel } from "./models";

/** One input dataset: a label plus its finite (x, y) pairs. */
export interface GlobalDataset {
  label: string;
  x: number[];
  y: number[];
}

/** A single fitted parameter for one dataset (or the shared value). */
export interface GlobalFitParameter extends FitParameter {
  /** True when this parameter is shared across all datasets. */
  shared: boolean;
  /**
   * The dataset label this LOCAL value belongs to, or null when shared. A shared
   * parameter has one row (datasetLabel null); a local parameter has one row per
   * dataset.
   */
  datasetLabel: string | null;
}

export interface GlobalFitResult {
  modelId: string;
  modelLabel: string;
  /** The model's parameter names, in declared order. */
  paramNames: string[];
  /** Which parameter names were fit as shared (one global value). */
  sharedNames: string[];
  /** Which parameter names were fit as local (one value per dataset). */
  localNames: string[];
  /** Dataset labels in fit order. */
  datasetLabels: string[];
  /**
   * Every fitted parameter row. Shared parameters appear once (datasetLabel
   * null); local parameters appear once per dataset in dataset order.
   */
  parameters: GlobalFitParameter[];
  /** Number of datasets fit together. */
  nDatasets: number;
  /** Total finite points across all datasets. */
  nTotal: number;
  /** Total free parameters in the packed global vector. */
  nParams: number;
  /** Total residual sum of squares across all datasets. */
  ssrTotal: number;
  /** Total residual degrees of freedom N_total - P. */
  df: number;
  /** Global R-squared 1 - SS_res_total / SS_tot_total (pooled about one mean). */
  rSquared: number;
  /** Fitted values per dataset, aligned with each dataset's x. */
  fittedByDataset: number[][];
  iterations: number;
}

/**
 * Build the packing layout for a global fit. The packed vector lays out, in
 * model parameter order, either ONE slot (shared) or D slots (local, dataset
 * order) per parameter. `slotOf(j, d)` returns the packed index of model
 * parameter j for dataset d.
 */
interface PackLayout {
  /** Packed index of (param j, dataset d). */
  slotOf: (j: number, d: number) => number;
  /** Total packed length P. */
  size: number;
  /** True per model parameter index when that parameter is shared. */
  sharedFlags: boolean[];
  /** Starting packed index of each parameter's block. */
  blockStart: number[];
}

function buildLayout(
  nParams: number,
  nDatasets: number,
  sharedFlags: boolean[],
): PackLayout {
  const blockStart: number[] = new Array(nParams);
  let cursor = 0;
  for (let j = 0; j < nParams; j++) {
    blockStart[j] = cursor;
    cursor += sharedFlags[j] ? 1 : nDatasets;
  }
  return {
    size: cursor,
    sharedFlags,
    blockStart,
    slotOf: (j, d) => blockStart[j] + (sharedFlags[j] ? 0 : d),
  };
}

/**
 * Resolve, for a packed vector and a dataset index, that dataset's per-parameter
 * value array (length = model.paramNames.length), reading the shared slot or the
 * dataset's local slot for each parameter.
 */
function datasetParams(
  packed: number[] | Float64Array,
  layout: PackLayout,
  nParams: number,
  d: number,
): number[] {
  const out = new Array<number>(nParams);
  for (let j = 0; j < nParams; j++) out[j] = packed[layout.slotOf(j, d)] as number;
  return out;
}

/**
 * Evaluate the stacked model at a flat index i (0..N_total-1) for a packed
 * parameter vector. The index maps into a dataset and a within-dataset position
 * via the precomputed `owner` / `localIndex` arrays.
 */
function makeStackedFn(
  model: NonlinearModel,
  datasets: GlobalDataset[],
  layout: PackLayout,
  nParams: number,
  owner: number[],
  localIndex: number[],
) {
  return (packed: number[]) =>
    (i: number) => {
      const d = owner[i];
      const xi = datasets[d].x[localIndex[i]];
      const ps = datasetParams(packed, layout, nParams, d);
      return model.fn(ps)(xi);
    };
}

export interface GlobalFitOptions {
  maxIterations?: number;
  damping?: number;
  /** Override the data-driven initial guess for the packed vector. */
  initialValues?: number[];
}

/**
 * Fit `model` globally to several datasets with the given shared/local choice.
 *
 * @param modelId  a registered model id (scoped to the dose-response family).
 * @param datasets the XY datasets to fit together (each its own finite x, y).
 * @param sharedNames the model parameter names to fit as SHARED; every other
 *   parameter is fit LOCAL (one value per dataset). An unknown name is ignored.
 */
export function fitGlobal(
  modelId: string,
  datasets: GlobalDataset[],
  sharedNames: string[],
  options: GlobalFitOptions = {},
): EngineResult<GlobalFitResult> {
  const model = getModel(modelId);
  if (!model) return { ok: false, error: `Unknown model "${modelId}".` };
  if (datasets.length < 2) {
    return { ok: false, error: "Global fitting needs at least 2 datasets." };
  }

  const paramNames = model.paramNames;
  const nParams = paramNames.length;
  const nDatasets = datasets.length;
  const sharedFlags = paramNames.map((name) => sharedNames.includes(name));
  const layout = buildLayout(nParams, nDatasets, sharedFlags);
  const P = layout.size;

  // Build the flat stacked index -> (dataset, within-dataset position) maps and
  // the concatenated y vector.
  const owner: number[] = [];
  const localIndex: number[] = [];
  const yStack: number[] = [];
  const xIndex: number[] = [];
  for (let d = 0; d < nDatasets; d++) {
    const ds = datasets[d];
    const len = Math.min(ds.x.length, ds.y.length);
    for (let i = 0; i < len; i++) {
      if (!Number.isFinite(ds.x[i]) || !Number.isFinite(ds.y[i])) continue;
      owner.push(d);
      localIndex.push(i);
      yStack.push(ds.y[i]);
      xIndex.push(xIndex.length);
    }
  }
  const N = yStack.length;
  if (N <= P) {
    return {
      ok: false,
      error: `Need more than ${P} total finite points to fit ${P} global parameters.`,
    };
  }

  // Per-dataset count guard: a dataset with no usable points cannot anchor its
  // local parameters.
  for (let d = 0; d < nDatasets; d++) {
    if (!owner.includes(d)) {
      return {
        ok: false,
        error: `Dataset "${datasets[d].label}" has no finite (x, y) pairs.`,
      };
    }
  }

  // Initial guess: run the single-model heuristic on each dataset, then for a
  // shared parameter average the per-dataset guesses (one stable starting point),
  // and for a local parameter seed each dataset's slot with its own guess.
  const perDatasetGuess = datasets.map((ds) => {
    const fx: number[] = [];
    const fy: number[] = [];
    const len = Math.min(ds.x.length, ds.y.length);
    for (let i = 0; i < len; i++) {
      if (Number.isFinite(ds.x[i]) && Number.isFinite(ds.y[i])) {
        fx.push(ds.x[i]);
        fy.push(ds.y[i]);
      }
    }
    return model.initialGuess(fx, fy);
  });

  let initialValues: number[];
  if (options.initialValues && options.initialValues.length === P) {
    initialValues = options.initialValues.slice();
  } else {
    initialValues = new Array<number>(P).fill(0);
    for (let j = 0; j < nParams; j++) {
      if (sharedFlags[j]) {
        let sum = 0;
        for (let d = 0; d < nDatasets; d++) sum += perDatasetGuess[d][j];
        initialValues[layout.slotOf(j, 0)] = sum / nDatasets;
      } else {
        for (let d = 0; d < nDatasets; d++) {
          initialValues[layout.slotOf(j, d)] = perDatasetGuess[d][j];
        }
      }
    }
  }

  // Bounds: lift the model's per-parameter default bounds (if any) into every
  // packed slot, so e.g. the 5PL asymmetry exponent stays positive in each slot.
  let minValues: number[] | undefined;
  let maxValues: number[] | undefined;
  if (model.defaultBounds) {
    // Use the first dataset's data to derive the per-parameter bound template;
    // the dose-response bounds are data-independent constants in practice.
    const b = model.defaultBounds(datasets[0].x, datasets[0].y);
    minValues = new Array<number>(P);
    maxValues = new Array<number>(P);
    for (let j = 0; j < nParams; j++) {
      for (let d = 0; d < nDatasets; d++) {
        const slot = layout.slotOf(j, d);
        minValues[slot] = b.min[j];
        maxValues[slot] = b.max[j];
        if (sharedFlags[j]) break;
      }
    }
  }

  const stackedFn = makeStackedFn(
    model,
    datasets,
    layout,
    nParams,
    owner,
    localIndex,
  );

  let lm;
  try {
    lm = levenbergMarquardt(
      { x: xIndex, y: yStack },
      stackedFn,
      {
        initialValues,
        maxIterations: options.maxIterations ?? 400,
        damping: options.damping ?? 1e-2,
        gradientDifference: 1e-6,
        centralDifference: true,
        minValues,
        maxValues,
      },
    );
  } catch (err) {
    return {
      ok: false,
      error: `Global fit failed to converge: ${(err as Error).message}`,
    };
  }

  const packed = lm.parameterValues;
  if (!packed.every((v) => Number.isFinite(v))) {
    return { ok: false, error: "Global fit produced non-finite parameters." };
  }

  // Residuals + total SSR + fitted values per dataset.
  const fittedByDataset: number[][] = datasets.map(() => []);
  let ssrTotal = 0;
  let sumY = 0;
  for (let i = 0; i < N; i++) {
    const d = owner[i];
    const ps = datasetParams(packed, layout, nParams, d);
    const yhat = model.fn(ps)(datasets[d].x[localIndex[i]]);
    fittedByDataset[d].push(yhat);
    const r = yStack[i] - yhat;
    ssrTotal += r * r;
    sumY += yStack[i];
  }
  // Global R-squared about the single pooled mean of all stacked y, the Prism
  // global-fit convention (one SS_tot over every point of every curve).
  const meanY = sumY / N;
  let sstTotal = 0;
  for (let i = 0; i < N; i++) sstTotal += (yStack[i] - meanY) ** 2;
  const rSquared = sstTotal === 0 ? NaN : 1 - ssrTotal / sstTotal;
  const df = N - P;

  // --- Parameter covariance: pcov = s^2 * pinv(J^T J), numeric central diffs ---
  const s2 = ssrTotal / df;
  const J: number[][] = Array.from({ length: N }, () => new Array(P).fill(0));
  for (let k = 0; k < P; k++) {
    const h = Math.max(1e-6, Math.abs(packed[k]) * 1e-6);
    const up = packed.slice();
    const dn = packed.slice();
    up[k] += h;
    dn[k] -= h;
    const fUp = stackedFn(up);
    const fDn = stackedFn(dn);
    for (let i = 0; i < N; i++) {
      J[i][k] = (fUp(i) - fDn(i)) / (2 * h);
    }
  }
  const Jm = new Matrix(J);
  const JtJ = Jm.transpose().mmul(Jm);

  const tCrit = tCritTwoSided(0.05, df);
  let covDiag: (j: number) => number;
  try {
    const cov = pseudoInverse(JtJ).mul(s2);
    covDiag = (j) => cov.get(j, j);
  } catch {
    covDiag = () => NaN;
  }

  const seOf = (slot: number): number => {
    const v = covDiag(slot);
    return v > 0 ? Math.sqrt(v) : NaN;
  };

  const parameters: GlobalFitParameter[] = [];
  for (let j = 0; j < nParams; j++) {
    const name = paramNames[j];
    if (sharedFlags[j]) {
      const slot = layout.slotOf(j, 0);
      const value = packed[slot];
      const se = seOf(slot);
      const half = Number.isFinite(se) ? tCrit * se : NaN;
      parameters.push({
        name,
        value,
        standardError: se,
        ci95: Number.isFinite(half) ? [value - half, value + half] : [NaN, NaN],
        shared: true,
        datasetLabel: null,
      });
    } else {
      for (let d = 0; d < nDatasets; d++) {
        const slot = layout.slotOf(j, d);
        const value = packed[slot];
        const se = seOf(slot);
        const half = Number.isFinite(se) ? tCrit * se : NaN;
        parameters.push({
          name,
          value,
          standardError: se,
          ci95: Number.isFinite(half) ? [value - half, value + half] : [NaN, NaN],
          shared: false,
          datasetLabel: datasets[d].label,
        });
      }
    }
  }

  return {
    ok: true,
    modelId: model.id,
    modelLabel: model.label,
    paramNames,
    sharedNames: paramNames.filter((_, j) => sharedFlags[j]),
    localNames: paramNames.filter((_, j) => !sharedFlags[j]),
    datasetLabels: datasets.map((d) => d.label),
    parameters,
    nDatasets,
    nTotal: N,
    nParams: P,
    ssrTotal,
    df,
    rSquared,
    fittedByDataset,
    iterations: lm.iterations,
  };
}
