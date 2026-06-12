import { describe as suite, it, expect } from "vitest";

import { rocAuc } from "../roc";

// The same binary-outcome dataset pinned for the ROC + logistic cases in the
// transparency gate (frontend/src/lib/transparency/datasets/datahub-stats.ts:
// LOGIT_X score, LOGIT_Y label). Reference AUC / SE / CI / Youden values come
// from scikit-learn 1.9.0 roc_auc_score + roc_curve and the Hanley-McNeil closed
// form, computed in gen-datahub-stats-golden.py.
const SCORE = [
  0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5,
  8.0, 8.5, 9.0, 9.5, 10.0,
];
const LABEL = [0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1];

suite("ROC curve and AUC", () => {
  it("matches the scikit-learn reference AUC, SE, CI, and Youden cut point", () => {
    const r = rocAuc(SCORE, LABEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.n).toBe(20);
    expect(r.nPositive).toBe(12);
    expect(r.nNegative).toBe(8);
    // sklearn roc_auc_score reference 0.84375.
    expect(r.auc).toBeCloseTo(0.84375, 6);
    // Hanley-McNeil SE / 95% CI (upper bound clamps to 1.0).
    expect(r.aucStandardError).toBeCloseTo(0.088396, 5);
    expect(r.aucCiLow).toBeCloseTo(0.670497, 5);
    expect(r.aucCiHigh).toBeCloseTo(1.0, 6);
    // Youden's J optimum at a score threshold of 4.5.
    expect(r.youdenThreshold).toBeCloseTo(4.5, 6);
    expect(r.youdenSensitivity).toBeCloseTo(0.833333, 5);
    expect(r.youdenSpecificity).toBeCloseTo(0.75, 6);
  });

  it("starts at the origin, ends at (1, 1), and is monotone", () => {
    const r = rocAuc(SCORE, LABEL);
    if (!r.ok) throw new Error("expected ok");
    const first = r.points[0];
    const last = r.points[r.points.length - 1];
    expect(first.fpr).toBe(0);
    expect(first.tpr).toBe(0);
    expect(last.fpr).toBeCloseTo(1, 12);
    expect(last.tpr).toBeCloseTo(1, 12);
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i].fpr).toBeGreaterThanOrEqual(r.points[i - 1].fpr);
      expect(r.points[i].tpr).toBeGreaterThanOrEqual(r.points[i - 1].tpr);
    }
  });

  it("trapezoidal AUC equals the Mann-Whitney rank-sum AUC", () => {
    const r = rocAuc(SCORE, LABEL);
    if (!r.ok) throw new Error("expected ok");
    // Independent rank-sum computation of the AUC (ties averaged), the identity
    // the curve area must reproduce.
    const idx = SCORE.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
    const ranks = new Array<number>(SCORE.length);
    let k = 0;
    while (k < idx.length) {
      let j = k;
      while (j + 1 < idx.length && idx[j + 1].s === idx[k].s) j++;
      const avg = (k + j) / 2 + 1;
      for (let t = k; t <= j; t++) ranks[idx[t].i] = avg;
      k = j + 1;
    }
    let rankSumPos = 0;
    let pos = 0;
    for (let i = 0; i < LABEL.length; i++) {
      if (LABEL[i] === 1) {
        rankSumPos += ranks[i];
        pos++;
      }
    }
    const neg = LABEL.length - pos;
    const mwAuc = (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
    expect(r.auc).toBeCloseTo(mwAuc, 12);
  });

  it("a perfect separator scores AUC 1", () => {
    const r = rocAuc([1, 2, 3, 4, 5, 6], [0, 0, 0, 1, 1, 1]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.auc).toBeCloseTo(1, 12);
    expect(r.youdenSensitivity).toBeCloseTo(1, 12);
    expect(r.youdenSpecificity).toBeCloseTo(1, 12);
  });

  it("a non-informative (all-tied) score scores AUC exactly 0.5", () => {
    // Every case shares one score, so positives and negatives are perfectly
    // tied and the score carries no separating information.
    const r = rocAuc([1, 1, 1, 1, 1, 1], [0, 1, 0, 1, 0, 1]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.auc).toBeCloseTo(0.5, 12);
  });

  it("drops rows with a non-finite score or a non-binary label", () => {
    const r = rocAuc(
      [1, NaN, 2, 3, 4, 5, 6],
      [0, 0, 0, 1, 2, 1, 1], // the NaN score and the label-2 row are dropped
    );
    if (!r.ok) throw new Error("expected ok");
    // Kept rows: scores 1,2,3,5,6 with labels 0,0,1,1,1 (the NaN and the 2 gone).
    expect(r.n).toBe(5);
    expect(r.nPositive).toBe(3);
    expect(r.nNegative).toBe(2);
  });

  it("rejects a single-class outcome", () => {
    const r = rocAuc([1, 2, 3], [1, 1, 1]);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty input", () => {
    const r = rocAuc([], []);
    expect(r.ok).toBe(false);
  });
});
