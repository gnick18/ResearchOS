// Internal numeric helpers shared across the engine. Pure, no I/O, no
// randomness. Not part of the public API surface.

/** Filter to finite numbers only (drops NaN / Infinity / non-numbers). */
export function clean(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: number[]): number {
  return values.length === 0 ? NaN : sum(values) / values.length;
}

/** Sample variance (n - 1 denominator). NaN for n < 2. */
export function sampleVariance(values: number[]): number {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  let s = 0;
  for (const v of values) {
    const d = v - m;
    s += d * d;
  }
  return s / (n - 1);
}

export function sampleSD(values: number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/**
 * Linear-interpolation quantile (the "type 7" definition, matching numpy /
 * Excel PERCENTILE.INC and R's default quantile). `p` in [0, 1].
 */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return quantileSorted(sorted, 0.5);
}

/**
 * Fractional (average) ranks with tie handling. Returns ranks aligned to the
 * input order, plus the sum over groups of (t^3 - t) used by tie corrections,
 * where t is each tie-group size.
 */
export function rankWithTies(values: number[]): {
  ranks: number[];
  tieCorrection: number;
} {
  const n = values.length;
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let tieCorrection = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1].v === idx[i].v) j++;
    // Average rank for the tie block [i, j] (1-based ranks).
    const avg = (i + j) / 2 + 1;
    const t = j - i + 1;
    if (t > 1) tieCorrection += t * t * t - t;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return { ranks, tieCorrection };
}

/** Numeric matrix multiply A (m x k) * B (k x n) -> m x n. */
export function matMul(a: number[][], b: number[][]): number[][] {
  const m = a.length;
  const k = b.length;
  const n = b[0].length;
  const out: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < n; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}
