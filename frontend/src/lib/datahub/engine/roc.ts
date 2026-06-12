// ROC curve and the area under it (AUC) for a binary classifier score.
//
// Input is a continuous score x and a binary true label y (0 or 1). The curve
// sweeps every distinct score as a decision threshold, plotting the false
// positive rate (1 - specificity, x axis) against the true positive rate
// (sensitivity, y axis). The area under that curve is the AUC, the probability
// that a randomly chosen positive scores higher than a randomly chosen negative.
//
// AUC is computed two equivalent ways and they agree: the trapezoidal area under
// the swept ROC points, and the Mann-Whitney U / rank-sum identity. We report the
// trapezoidal value (the area of the curve we draw) and assert it matches the
// rank-sum form within floating-point slack in the unit tests.
//
// The standard error and 95% CI use the Hanley and McNeil (1982) closed form,
// the same formula GraphPad Prism and pROC report. The optimal cut point is by
// Youden's J (max of sensitivity + specificity - 1), with its sensitivity and
// specificity carried for the readout.
//
// Matches sklearn.metrics.roc_auc_score / roc_curve for the AUC and the curve;
// pinned at tight tolerance in the transparency suite (oracle "sklearn").
//
// No em-dashes, no emojis, no mid-sentence colons.

import { normalQuantile } from "./dists";
import type { EngineResult } from "./types";

/** One point on the ROC curve at a swept score threshold. */
export interface RocPoint {
  /** The score threshold. A case scores positive when x >= threshold. */
  threshold: number;
  /** False positive rate at this threshold, 1 - specificity. */
  fpr: number;
  /** True positive rate at this threshold, the sensitivity. */
  tpr: number;
}

export interface RocAucResult {
  /** Rows kept (finite score, label exactly 0 or 1). */
  n: number;
  /** Count of positives (y = 1) among the kept rows. */
  nPositive: number;
  /** Count of negatives (y = 0) among the kept rows. */
  nNegative: number;
  /** Area under the ROC curve (trapezoidal, equals the Mann-Whitney form). */
  auc: number;
  /** Hanley-McNeil standard error of the AUC. */
  aucStandardError: number;
  /** Lower bound of the 95% CI of the AUC (clamped to [0, 1]). */
  aucCiLow: number;
  /** Upper bound of the 95% CI of the AUC (clamped to [0, 1]). */
  aucCiHigh: number;
  /** Optimal threshold by Youden's J (max tpr - fpr). */
  youdenThreshold: number;
  /** Sensitivity (tpr) at the Youden-optimal threshold. */
  youdenSensitivity: number;
  /** Specificity (1 - fpr) at the Youden-optimal threshold. */
  youdenSpecificity: number;
  /** The full ROC curve, from (0, 0) up to (1, 1), one point per threshold. */
  points: RocPoint[];
}

/**
 * Compute the ROC curve and AUC for a binary outcome y against a continuous
 * score x. Rows whose x is not finite, or whose y is not exactly 0 or 1, are
 * dropped. A case is called positive when its score is at or above the threshold,
 * so higher scores mean more likely positive.
 */
export function rocAuc(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): EngineResult<RocAucResult> {
  // Keep aligned rows with a finite score and a binary (0/1) label.
  const scores: number[] = [];
  const labels: number[] = [];
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const xv = x[i];
    const yv = y[i];
    if (typeof xv !== "number" || !Number.isFinite(xv)) continue;
    if (typeof yv !== "number" || (yv !== 0 && yv !== 1)) continue;
    scores.push(xv);
    labels.push(yv);
  }
  const n = scores.length;
  if (n === 0) {
    return { ok: false, error: "No rows with a finite score and a binary (0/1) outcome." };
  }
  let nPositive = 0;
  for (const l of labels) if (l === 1) nPositive++;
  const nNegative = n - nPositive;
  if (nPositive === 0 || nNegative === 0) {
    return {
      ok: false,
      error: "The outcome must contain both 0s and 1s to draw a ROC curve.",
    };
  }

  // Sort row indices by score DESCENDING. Sweeping high-to-low adds cases to the
  // positive-call set one threshold block at a time, walking the curve from
  // (0, 0) toward (1, 1).
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => scores[b] - scores[a],
  );

  // Sweep the distinct thresholds. The curve starts at the origin (call nothing
  // positive). For each block of tied scores, advance the true / false positive
  // counts past the whole block before recording the next point, so ties do not
  // create a fake staircase.
  const points: RocPoint[] = [{ threshold: Number.POSITIVE_INFINITY, fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  let i = 0;
  while (i < n) {
    const tScore = scores[order[i]];
    // Consume every row tied at this score.
    while (i < n && scores[order[i]] === tScore) {
      if (labels[order[i]] === 1) tp++;
      else fp++;
      i++;
    }
    points.push({
      threshold: tScore,
      fpr: fp / nNegative,
      tpr: tp / nPositive,
    });
  }

  // AUC by the trapezoidal rule over the swept points (the area of the curve we
  // draw). Equivalent to the Mann-Whitney rank-sum AUC; the unit tests confirm.
  let auc = 0;
  for (let k = 1; k < points.length; k++) {
    const dx = points[k].fpr - points[k - 1].fpr;
    const ymid = (points[k].tpr + points[k - 1].tpr) / 2;
    auc += dx * ymid;
  }

  // Hanley-McNeil (1982) standard error of the AUC.
  //   Q1 = AUC / (2 - AUC),  Q2 = 2*AUC^2 / (1 + AUC)
  //   SE = sqrt( [ AUC(1-AUC) + (nP-1)(Q1-AUC^2) + (nN-1)(Q2-AUC^2) ] / (nP*nN) )
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const seVar =
    (auc * (1 - auc) +
      (nPositive - 1) * (q1 - auc * auc) +
      (nNegative - 1) * (q2 - auc * auc)) /
    (nPositive * nNegative);
  const aucStandardError = seVar > 0 ? Math.sqrt(seVar) : 0;
  const z975 = normalQuantile(0.975); // ~1.959964
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const aucCiLow = clamp01(auc - z975 * aucStandardError);
  const aucCiHigh = clamp01(auc + z975 * aucStandardError);

  // Youden's J: the threshold maximizing tpr - fpr (sensitivity + specificity - 1).
  // Skip the synthetic origin point (threshold = +Infinity), which always has
  // J = 0, so the chosen cut point is a real observed score.
  let bestJ = -Infinity;
  let youdenThreshold = NaN;
  let youdenSensitivity = NaN;
  let youdenSpecificity = NaN;
  for (let k = 1; k < points.length; k++) {
    const j = points[k].tpr - points[k].fpr;
    if (j > bestJ) {
      bestJ = j;
      youdenThreshold = points[k].threshold;
      youdenSensitivity = points[k].tpr;
      youdenSpecificity = 1 - points[k].fpr;
    }
  }

  return {
    ok: true,
    n,
    nPositive,
    nNegative,
    auc,
    aucStandardError,
    aucCiLow,
    aucCiHigh,
    youdenThreshold,
    youdenSensitivity,
    youdenSpecificity,
    points,
  };
}
