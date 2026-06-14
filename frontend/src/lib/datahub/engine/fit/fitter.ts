// Generic nonlinear least-squares fitter built on ml-levenberg-marquardt.
//
// ml-levenberg-marquardt returns ONLY the converged parameter values and the
// residual error; it gives no standard errors or confidence intervals. We
// reproduce exactly what scipy's curve_fit does to get `pcov`:
//
//   1. Run Levenberg-Marquardt to convergence -> best-fit params p (length P).
//   2. Build the numeric Jacobian J at the solution: J[i][j] = d f(x_i; p) / d p_j,
//      via central differences with a per-parameter step.
//   3. Form J^T J (the Gauss-Newton approximation to the Hessian, P x P).
//   4. Scale by the residual variance s^2 = SSR / (n - P) to get the parameter
//      covariance matrix:  pcov = s^2 * (J^T J)^{-1}.
//      We invert with a Moore-Penrose pseudo-inverse (SVD-based, via ml-matrix)
//      for numerical safety on near-singular J^T J.
//   5. Standard error of parameter j = sqrt(pcov[j][j]).
//   6. 95% CI = p_j +/- t_crit(0.025, n - P) * SE_j, the same t-based interval
//      scipy and Prism report for nonlinear fits.
//
// This is the only nontrivial piece of math authored from scratch; the test
// suite pins the EC50 and Km of the headline fits against published references.

import { Matrix, pseudoInverse } from "ml-matrix";
import { levenbergMarquardt } from "ml-levenberg-marquardt";

import { tCritTwoSided } from "../dists";
import type { EngineResult, FitParameter, FitResult } from "../types";
import { getModel, type NonlinearModel } from "./models";

export interface FitOptions {
  /** Override the model's data-driven initial guess. */
  initialValues?: number[];
  minValues?: number[];
  maxValues?: number[];
  maxIterations?: number;
  damping?: number;
}

function finitePairs(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const xv = x[i];
    const yv = y[i];
    if (
      typeof xv === "number" &&
      typeof yv === "number" &&
      Number.isFinite(xv) &&
      Number.isFinite(yv)
    ) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  return { xs, ys };
}

/**
 * Numeric Jacobian of the model wrt its parameters at the solution, by central
 * differences. Returns an n x P matrix (rows = data points, cols = params).
 */
function numericJacobian(
  model: NonlinearModel,
  params: number[],
  xs: number[],
): number[][] {
  const n = xs.length;
  const p = params.length;
  const J: number[][] = Array.from({ length: n }, () => new Array(p).fill(0));
  for (let j = 0; j < p; j++) {
    // Relative step scaled to the parameter magnitude, with an absolute floor.
    const h = Math.max(1e-6, Math.abs(params[j]) * 1e-6);
    const up = params.slice();
    const dn = params.slice();
    up[j] += h;
    dn[j] -= h;
    const fUp = model.fn(up);
    const fDn = model.fn(dn);
    for (let i = 0; i < n; i++) {
      J[i][j] = (fUp(xs[i]) - fDn(xs[i])) / (2 * h);
    }
  }
  return J;
}

export function fitModel(
  modelId: string,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: FitOptions = {},
): EngineResult<FitResult> {
  const model = getModel(modelId);
  if (!model) {
    return { ok: false, error: `Unknown model "${modelId}".` };
  }
  const { xs, ys } = finitePairs(x, y);
  const n = xs.length;
  const p = model.paramNames.length;
  if (n <= p) {
    return {
      ok: false,
      error: `Need more than ${p} finite points to fit ${model.label}.`,
    };
  }

  const initialValues = options.initialValues ?? model.initialGuess(xs, ys);
  if (initialValues.length !== p) {
    return {
      ok: false,
      error: `Expected ${p} initial values for ${model.label}.`,
    };
  }
  const bounds = model.defaultBounds?.(xs, ys);

  let lm;
  try {
    lm = levenbergMarquardt(
      { x: xs, y: ys },
      model.fn,
      {
        initialValues,
        maxIterations: options.maxIterations ?? 200,
        damping: options.damping ?? 1e-2,
        gradientDifference: 1e-6,
        centralDifference: true,
        minValues: options.minValues ?? bounds?.min,
        maxValues: options.maxValues ?? bounds?.max,
      },
    );
  } catch (err) {
    return {
      ok: false,
      error: `Fit failed to converge: ${(err as Error).message}`,
    };
  }

  let params = lm.parameterValues;
  if (!params.every((v) => Number.isFinite(v))) {
    return { ok: false, error: "Fit produced non-finite parameters." };
  }
  // Collapse any model sign/mirror degeneracy to the conventional orientation so
  // the reported parameters (and their SEs / CIs, computed below) are one stable
  // answer regardless of which equivalent optimum the solver reached. The
  // transform returns an identical curve, so residuals / R-squared are unchanged.
  if (model.canonicalize) params = model.canonicalize(params);

  // Residuals + SSR + R-squared.
  const fn = model.fn(params);
  const fitted = xs.map((xv) => fn(xv));
  const residuals = ys.map((yv, i) => yv - fitted[i]);
  let ssr = 0;
  for (const r of residuals) ssr += r * r;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sst = 0;
  for (const yv of ys) sst += (yv - meanY) ** 2;
  const rSquared = sst === 0 ? NaN : 1 - ssr / sst;
  const df = n - p;
  const adjustedRSquared =
    sst === 0 || df <= 0
      ? NaN
      : 1 - ((1 - rSquared) * (n - 1)) / df;

  // --- Parameter covariance: pcov = s^2 * pinv(J^T J) ---
  const s2 = ssr / df;
  const J = numericJacobian(model, params, xs);
  const Jm = new Matrix(J);
  const JtJ = Jm.transpose().mmul(Jm); // P x P

  let parameters: FitParameter[];
  try {
    const cov = pseudoInverse(JtJ).mul(s2); // P x P covariance
    const tCrit = tCritTwoSided(0.05, df);
    parameters = model.paramNames.map((name, j) => {
      const variance = cov.get(j, j);
      const se = variance > 0 ? Math.sqrt(variance) : NaN;
      const half = Number.isFinite(se) ? tCrit * se : NaN;
      const value = params[j];
      const ci95: [number, number] = Number.isFinite(half)
        ? [value - half, value + half]
        : [NaN, NaN];
      return { name, value, standardError: se, ci95 };
    });
  } catch {
    // Singular / non-invertible Jacobian: report params without SE/CI.
    parameters = model.paramNames.map((name, j) => ({
      name,
      value: params[j],
      standardError: NaN,
      ci95: [NaN, NaN] as [number, number],
    }));
  }

  const values: Record<string, number> = {};
  parameters.forEach((pr) => (values[pr.name] = pr.value));

  return {
    ok: true,
    modelId: model.id,
    modelLabel: model.label,
    parameters,
    values,
    rSquared,
    adjustedRSquared,
    ssr,
    df,
    residuals,
    fitted,
    iterations: lm.iterations,
    derived: model.derived?.(params),
  };
}
