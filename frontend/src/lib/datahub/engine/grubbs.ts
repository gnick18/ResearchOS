// Grubbs test for outliers (the extreme-studentized-deviate test). Screens a
// single sample for the one value that sits farthest from the mean, in standard
// deviations, and asks whether that distance is larger than chance would
// produce in a normal sample of this size.
//
// Two-sided Grubbs statistic on a sample of n values:
//   G = max_i |x_i - mean| / sd      (sd is the sample sd, n - 1 denominator)
// The critical value is Bonferroni-corrected for screening every point at once:
//   t = upper alpha / (2n) critical value of Student's t with n - 2 df
//   G_crit = ((n - 1) / sqrt(n)) * sqrt(t^2 / (n - 2 + t^2))
// The extreme point is flagged as an outlier when G > G_crit.
//
// Iterative mode applies the same test repeatedly, removing one flagged point
// at a time and recomputing the mean / sd on what remains, until no point is
// flagged or the sample gets too small to test (n < 3). This is the standard
// Grubbs sweep used to clear more than one outlier from a sample.
//
// Validated against scipy.stats.t (the critical value is exact) in the
// transparency gate. No em-dashes, no emojis, no mid-sentence colons.

import { tQuantile } from "./dists";
import type { EngineResult } from "./types";
import { clean, mean as meanOf, sampleSD } from "./util";

const DEFAULT_ALPHA = 0.05;

/** The smallest sample Grubbs can test (needs n - 2 >= 1 df for the t critical). */
export const GRUBBS_MIN_N = 3;

/** One outlier removed on a single Grubbs pass (one step of the iterative sweep). */
export interface GrubbsStep {
  /** 1-based step number in the iterative sweep (1 for the single-pass test). */
  step: number;
  /** The sample size this pass tested. */
  n: number;
  /** The Grubbs G statistic for the most extreme point this pass. */
  g: number;
  /** The Bonferroni-corrected two-sided critical value at this n. */
  gCritical: number;
  /** The most extreme value this pass examined. */
  value: number;
  /**
   * The row index of that value in the ORIGINAL input array (so the UI can
   * point at the offending row even after earlier removals shifted positions).
   */
  rowIndex: number;
  /** True when G > G_critical, meaning this pass flagged the value as an outlier. */
  flagged: boolean;
}

/** The result of running Grubbs (single-pass or iterative) on one sample. */
export interface GrubbsResult {
  /** The alpha the critical values were computed at. */
  alpha: number;
  /** Whether the iterative sweep was run (false for a single pass). */
  iterative: boolean;
  /** The original sample size (finite values only). */
  n: number;
  /** Every pass that ran, in order. The last entry is the one that did not flag. */
  steps: GrubbsStep[];
  /** The values flagged as outliers (the flagged steps' values), in sweep order. */
  outlierValues: number[];
  /** The original-array row indices of the flagged outliers, in sweep order. */
  outlierRowIndices: number[];
  /** The sample size after removing every flagged outlier (n - outlierValues.length). */
  cleanedN: number;
}

/**
 * The Bonferroni-corrected two-sided Grubbs critical value at sample size n and
 * significance alpha. Returns NaN for n < GRUBBS_MIN_N (no t df to evaluate).
 *
 *   t = upper alpha / (2n) critical of Student's t with n - 2 df
 *   G_crit = ((n - 1) / sqrt(n)) * sqrt(t^2 / (n - 2 + t^2))
 */
export function grubbsCriticalValue(n: number, alpha = DEFAULT_ALPHA): number {
  if (n < GRUBBS_MIN_N) return NaN;
  const df = n - 2;
  // Upper alpha / (2n) critical of the t distribution (two-sided, Bonferroni
  // over the n points). tQuantile takes a lower-tail probability.
  const t = tQuantile(1 - alpha / (2 * n), df);
  const t2 = t * t;
  return ((n - 1) / Math.sqrt(n)) * Math.sqrt(t2 / (df + t2));
}

/** The most extreme point of a sample by absolute deviation from the mean. */
function extremePoint(
  values: number[],
): { g: number; index: number; value: number } {
  const m = meanOf(values);
  const sd = sampleSD(values);
  let bestIdx = 0;
  let bestDev = -1;
  for (let i = 0; i < values.length; i++) {
    const dev = Math.abs(values[i] - m);
    if (dev > bestDev) {
      bestDev = dev;
      bestIdx = i;
    }
  }
  // sd is the sample sd (n - 1). A zero-spread sample (all equal) has G = 0.
  const g = sd === 0 ? 0 : bestDev / sd;
  return { g, index: bestIdx, value: values[bestIdx] };
}

/**
 * Run the Grubbs outlier test on one sample.
 *
 * `iterative` (default true) sweeps repeatedly, removing one flagged point at a
 * time and recomputing on the remainder, until no point is flagged or the sample
 * drops below GRUBBS_MIN_N. With `iterative` false it runs a single pass.
 *
 * Non-finite inputs are dropped first. Row indices in the result refer to the
 * position in the ORIGINAL (pre-clean) array so the caller can map a flagged
 * value back to its table row.
 */
export function grubbsTest(
  values: ArrayLike<number>,
  options: { alpha?: number; iterative?: boolean } = {},
): EngineResult<GrubbsResult> {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const iterative = options.iterative ?? true;

  if (alpha <= 0 || alpha >= 1) {
    return { ok: false, error: "Grubbs alpha must be between 0 and 1." };
  }

  // Keep the original index alongside each finite value so a removal during the
  // sweep never loses the mapping back to the input row.
  const indexed: { value: number; rowIndex: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      indexed.push({ value: v, rowIndex: i });
    }
  }
  const n = indexed.length;
  if (n < GRUBBS_MIN_N) {
    return {
      ok: false,
      error: `Grubbs needs at least ${GRUBBS_MIN_N} values.`,
    };
  }

  const steps: GrubbsStep[] = [];
  const outlierValues: number[] = [];
  const outlierRowIndices: number[] = [];

  // A working copy we remove flagged points from on each iterative pass.
  let working = indexed.slice();
  let step = 0;

  while (working.length >= GRUBBS_MIN_N) {
    step += 1;
    const vals = working.map((p) => p.value);
    const ex = extremePoint(vals);
    const gCritical = grubbsCriticalValue(working.length, alpha);
    const flagged = ex.g > gCritical;
    const point = working[ex.index];

    steps.push({
      step,
      n: working.length,
      g: ex.g,
      gCritical,
      value: point.value,
      rowIndex: point.rowIndex,
      flagged,
    });

    if (!flagged) break;

    outlierValues.push(point.value);
    outlierRowIndices.push(point.rowIndex);

    if (!iterative) break;

    // Remove the flagged point and sweep again on the remainder.
    working = working.filter((_, i) => i !== ex.index);
  }

  return {
    ok: true,
    alpha,
    iterative,
    n,
    steps,
    outlierValues,
    outlierRowIndices,
    cleanedN: n - outlierValues.length,
  };
}
