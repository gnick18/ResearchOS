// Assumption checks that power a later "Report Card" wizard: Shapiro-Wilk
// normality, and Levene / Brown-Forsythe equal-variance. Each returns a clear
// pass/fail plus the statistic and p so the wizard can explain the decision.
//
// Shapiro-Wilk uses Royston's (1992) AS R94 algorithm, the same approximation
// scipy.stats.shapiro implements. It is valid for 3 <= n <= 5000. The W
// statistic is pinned against scipy in the test suite; the p-value uses
// Royston's normalizing transform.

import { fPValue, normalCdf, normalQuantile } from "./dists";
import type { AssumptionResult, EngineResult } from "./types";
import { clean, mean as meanOf } from "./util";

const DEFAULT_ALPHA = 0.05;

function poly(c: number[], x: number): number {
  // Horner evaluation of c[0] + c[1] x + c[2] x^2 + ...
  let r = c[c.length - 1];
  for (let i = c.length - 2; i >= 0; i--) r = r * x + c[i];
  return r;
}

/**
 * Shapiro-Wilk W test for normality (Royston AS R94). Returns W, the p-value,
 * and pass = (p >= alpha) meaning "consistent with normal".
 */
export function shapiroWilk(
  values: ArrayLike<number>,
  alpha = DEFAULT_ALPHA,
): EngineResult<AssumptionResult> {
  const data = clean(values);
  const n = data.length;
  if (n < 3) {
    return { ok: false, error: "Shapiro-Wilk needs at least 3 values." };
  }
  if (n > 5000) {
    return { ok: false, error: "Shapiro-Wilk is valid up to n = 5000." };
  }

  const x = [...data].sort((a, b) => a - b);
  const mean = meanOf(x);

  // m_i = expected values of standard normal order statistics (Blom approx).
  const m = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25), 0, 1);
  }
  let ssm = 0;
  for (const v of m) ssm += v * v;
  const rsn = 1 / Math.sqrt(n);

  // Royston's coefficients a_i. The polynomial coefficient lists are in
  // ASCENDING power order to match poly()'s Horner evaluation:
  //   a_n      = 0 + 0.221157 u - 0.147981 u^2 - 2.071190 u^3 + 4.434685 u^4
  //               - 2.706056 u^5  +  m_n / sqrt(m'm)
  //   a_{n-1}  = 0 + 0.042981 u - 0.293762 u^2 - 1.752461 u^3 + 5.682633 u^4
  //               - 3.582633 u^5  +  m_{n-1} / sqrt(m'm)
  // with u = 1 / sqrt(n). (Royston 1992 / AS R94.)
  const a = new Array<number>(n).fill(0);
  const a1 =
    poly([0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056], rsn) +
    m[n - 1] / Math.sqrt(ssm);
  const a2 =
    poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], rsn) +
    m[n - 2] / Math.sqrt(ssm);

  let phi: number;
  if (n > 5) {
    phi = (ssm - 2 * m[n - 1] * m[n - 1] - 2 * m[n - 2] * m[n - 2]) /
      (1 - 2 * a1 * a1 - 2 * a2 * a2);
    a[n - 1] = a1;
    a[0] = -a1;
    a[n - 2] = a2;
    a[1] = -a2;
    for (let i = 2; i < n - 2; i++) {
      a[i] = m[i] / Math.sqrt(phi);
    }
  } else {
    phi = (ssm - 2 * m[n - 1] * m[n - 1]) / (1 - 2 * a1 * a1);
    a[n - 1] = a1;
    a[0] = -a1;
    for (let i = 1; i < n - 1; i++) {
      a[i] = m[i] / Math.sqrt(phi);
    }
  }

  // W = (sum a_i x_i)^2 / sum (x_i - xbar)^2.
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += a[i] * x[i];
    const d = x[i] - mean;
    den += d * d;
  }
  const W = (num * num) / den;

  // Royston's p-value transform.
  let pValue: number;
  if (n === 3) {
    // Exact small-sample result for n = 3.
    const pi6 = 6 / Math.PI;
    const stqr = Math.asin(Math.sqrt(0.75));
    pValue = pi6 * (Math.asin(Math.sqrt(W)) - stqr);
    pValue = Math.min(1, Math.max(0, pValue));
  } else {
    const lnn = Math.log(n);
    let mu: number;
    let sigma: number;
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      mu = poly([0.5440, -0.39978, 0.025054, -0.0006714], n);
      sigma = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
      const w1 = -Math.log(gamma - Math.log(1 - W));
      const z = (w1 - mu) / sigma;
      pValue = 1 - normalCdf(z, 0, 1);
    } else {
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], lnn);
      sigma = Math.exp(poly([-0.4803, -0.082676, 0.0030302], lnn));
      const w1 = Math.log(1 - W);
      const z = (w1 - mu) / sigma;
      pValue = 1 - normalCdf(z, 0, 1);
    }
  }

  return {
    ok: true,
    test: "Shapiro-Wilk normality",
    statistic: W,
    pValue,
    pass: pValue >= alpha,
    alpha,
    note:
      pValue >= alpha
        ? "Consistent with a normal distribution."
        : "Departure from normality detected.",
  };
}

type Center = "mean" | "median";

/**
 * Levene-style equal-variance test. center = "mean" gives the classic Levene
 * test; center = "median" gives the Brown-Forsythe variant (more robust to
 * non-normality). Both compute an F statistic on the absolute deviations from
 * each group's center. Pinned against scipy.stats.levene in the tests.
 */
function leveneCore(
  groups: ArrayLike<number>[],
  center: Center,
  alpha: number,
  label: string,
): EngineResult<AssumptionResult> {
  const cleaned = groups.map(clean).filter((g) => g.length > 0);
  const k = cleaned.length;
  if (k < 2) {
    return { ok: false, error: "Need at least 2 non-empty groups." };
  }
  const N = cleaned.reduce((acc, g) => acc + g.length, 0);
  if (N - k <= 0) {
    return { ok: false, error: "Not enough observations across groups." };
  }

  // z_ij = |x_ij - center_i|.
  const centers = cleaned.map((g) => {
    if (center === "mean") return meanOf(g);
    const sorted = [...g].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  });
  const z = cleaned.map((g, i) => g.map((v) => Math.abs(v - centers[i])));
  const zMeans = z.map((g) => meanOf(g));
  const zGrand = meanOf(z.flat());

  // Between-group and within-group sums of squares of the z's.
  let between = 0;
  for (let i = 0; i < k; i++) {
    const d = zMeans[i] - zGrand;
    between += z[i].length * d * d;
  }
  let within = 0;
  for (let i = 0; i < k; i++) {
    for (const v of z[i]) {
      const d = v - zMeans[i];
      within += d * d;
    }
  }
  if (within === 0) {
    return { ok: false, error: "Zero within-group spread; F undefined." };
  }

  const dfBetween = k - 1;
  const dfWithin = N - k;
  const F = (between / dfBetween) / (within / dfWithin);
  const pValue = fPValue(F, dfBetween, dfWithin);

  return {
    ok: true,
    test: label,
    statistic: F,
    pValue,
    pass: pValue >= alpha,
    alpha,
    note:
      pValue >= alpha
        ? "Group variances are consistent with being equal."
        : "Group variances differ significantly.",
  };
}

export function levene(
  groups: ArrayLike<number>[],
  alpha = DEFAULT_ALPHA,
): EngineResult<AssumptionResult> {
  return leveneCore(groups, "mean", alpha, "Levene equal-variance");
}

export function brownForsythe(
  groups: ArrayLike<number>[],
  alpha = DEFAULT_ALPHA,
): EngineResult<AssumptionResult> {
  return leveneCore(
    groups,
    "median",
    alpha,
    "Brown-Forsythe equal-variance",
  );
}
