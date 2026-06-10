// Descriptive statistics for a single column / group. Pure functions; bad input
// yields an EngineError rather than a throw.

import { tCritTwoSided } from "./dists";
import type { Descriptives, EngineResult } from "./types";
import {
  clean,
  mean as meanOf,
  quantileSorted,
  sampleSD,
  sampleVariance,
} from "./util";

export function describe(values: ArrayLike<number>): EngineResult<Descriptives> {
  const data = clean(values);
  const n = data.length;
  if (n === 0) {
    return { ok: false, error: "No finite values to summarize." };
  }

  const sorted = [...data].sort((a, b) => a - b);
  const mean = meanOf(data);
  const variance = n >= 2 ? sampleVariance(data) : NaN;
  const sd = n >= 2 ? sampleSD(data) : NaN;
  const sem = n >= 2 ? sd / Math.sqrt(n) : NaN;

  // 95% CI of the mean uses the Student t critical value on n - 1 df.
  let ci95: [number, number] = [NaN, NaN];
  if (n >= 2) {
    const tCrit = tCritTwoSided(0.05, n - 1);
    const half = tCrit * sem;
    ci95 = [mean - half, mean + half];
  }

  const cvPercent = mean !== 0 && n >= 2 ? (100 * sd) / Math.abs(mean) : NaN;

  return {
    ok: true,
    n,
    mean,
    sd,
    sem,
    variance,
    median: quantileSorted(sorted, 0.5),
    q1: quantileSorted(sorted, 0.25),
    q3: quantileSorted(sorted, 0.75),
    min: sorted[0],
    max: sorted[n - 1],
    ci95,
    cvPercent,
  };
}

/** Internal variant that returns a bare Descriptives (assumes valid input). */
export function describeUnsafe(values: number[]): Descriptives {
  const r = describe(values);
  if (!r.ok) {
    return {
      n: 0,
      mean: NaN,
      sd: NaN,
      sem: NaN,
      variance: NaN,
      median: NaN,
      q1: NaN,
      q3: NaN,
      min: NaN,
      max: NaN,
      ci95: [NaN, NaN],
      cvPercent: NaN,
    };
  }
  // Strip the discriminant for embedding in other results.
  const { ok: _ok, ...rest } = r;
  void _ok;
  return rest;
}
