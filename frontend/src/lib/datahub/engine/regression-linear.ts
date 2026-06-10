// Simple (ordinary least squares) linear regression y = intercept + slope * x.
// Returns slope, intercept, R-squared, parameter standard errors and their 95%
// confidence intervals, residual standard error, residuals, and fitted values.
// Standard textbook OLS; pinned against scipy.stats.linregress in the tests.

import { tCritTwoSided } from "./dists";
import type { EngineResult, LinearRegressionResult } from "./types";
import { mean as meanOf } from "./util";

export function linearRegression(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): EngineResult<LinearRegressionResult> {
  // Keep only pairs where both members are finite.
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
  const n = xs.length;
  if (n < 3) {
    return {
      ok: false,
      error: "Need at least 3 paired finite values for regression.",
    };
  }

  const mx = meanOf(xs);
  const my = meanOf(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) {
    return { ok: false, error: "Zero variance in x; slope undefined." };
  }

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  const fitted = xs.map((xv) => intercept + slope * xv);
  const residuals = ys.map((yv, i) => yv - fitted[i]);

  // SSR (residual sum of squares) and R-squared.
  let ssr = 0;
  for (const r of residuals) ssr += r * r;
  const rSquared = syy === 0 ? NaN : 1 - ssr / syy;

  // Residual variance s^2 on (n - 2) df; residual standard error.
  const df = n - 2;
  const s2 = ssr / df;
  const residualSE = Math.sqrt(s2);

  // SE(slope) = s / sqrt(Sxx); SE(intercept) = s * sqrt(1/n + xbar^2 / Sxx).
  const slopeSE = Math.sqrt(s2 / sxx);
  const interceptSE = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));

  const tCrit = tCritTwoSided(0.05, df);
  const slopeCI95: [number, number] = [
    slope - tCrit * slopeSE,
    slope + tCrit * slopeSE,
  ];
  const interceptCI95: [number, number] = [
    intercept - tCrit * interceptSE,
    intercept + tCrit * interceptSE,
  ];

  return {
    ok: true,
    n,
    slope,
    intercept,
    rSquared,
    slopeSE,
    interceptSE,
    slopeCI95,
    interceptCI95,
    residualSE,
    residuals,
    fitted,
  };
}
