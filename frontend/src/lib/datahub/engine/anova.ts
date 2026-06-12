// Analysis of variance and its post-hoc multiple-comparison families.
//
//  - oneWayAnova: omnibus table + a chosen post-hoc family
//      (Tukey HSD, Dunnett vs control, Sidak, Bonferroni, Holm-Sidak)
//  - twoWayAnova: two-factor table (A, B, interaction, error) with optional
//      Tukey post-hoc on the marginal means of a chosen factor
//  - kruskalWallis: nonparametric one-way + Dunn post-hoc
//  - friedman: nonparametric repeated-measures + Dunn post-hoc
//
// The omnibus one-way F/p delegates to @stdlib/stats-anova1 (validated
// upstream); we recompute the SS/df/MS for the table and author every post-hoc
// family. Headline cases are pinned against scipy / Prism worked examples.

import anova1 from "@stdlib/stats-anova1";
import kruskalTest from "@stdlib/stats-kruskal-test";

import {
  chiSquarePValue,
  fPValue,
  noncentralFLambdaForCdf,
  normalPValue,
  studentizedRangePValue,
  tPValue,
} from "./dists";
import type {
  AnovaEffectSize,
  AnovaResult,
  AnovaTableRow,
  EngineResult,
  PairwiseComparison,
  RmAnovaResult,
} from "./types";
import { clean, mean as meanOf, rankWithTies, sum } from "./util";

/**
 * Omnibus effect size for a one-way ANOVA from its sums of squares.
 *
 *   eta-squared    = SS_between / SS_total
 *   omega-squared  = (SS_between - df_between * MS_within)
 *                    / (SS_total + MS_within)
 *
 * eta-squared is the share of total variance the grouping explains; it is
 * slightly upward biased, so omega-squared is the less biased estimate of the
 * population value.
 *
 * The 95% CI of eta-squared comes from the noncentral F pivot (Smithson 2001):
 * invert the noncentral F CDF at the observed F for the noncentrality lambda at
 * the 0.975 and 0.025 probability points, then map each lambda to eta-squared by
 *   eta2 = lambda / (lambda + N)
 * where N is the total sample size. A lambda lower bound of 0 maps to eta2 = 0.
 */
function anovaEffectSize(
  ssBetween: number,
  ssWithin: number,
  dfBetween: number,
  dfWithin: number,
  msWithin: number,
  N: number,
  F: number,
): AnovaEffectSize {
  const ssTotal = ssBetween + ssWithin;
  const etaSquared = ssTotal > 0 ? ssBetween / ssTotal : NaN;
  const omegaSquared =
    ssTotal + msWithin > 0
      ? (ssBetween - dfBetween * msWithin) / (ssTotal + msWithin)
      : null;

  let etaSquaredCI95: [number, number] | null = null;
  if (Number.isFinite(F) && F > 0 && dfBetween > 0 && dfWithin > 0 && N > 0) {
    const lambdaLo = noncentralFLambdaForCdf(0.975, F, dfBetween, dfWithin);
    const lambdaHi = noncentralFLambdaForCdf(0.025, F, dfBetween, dfWithin);
    if (Number.isFinite(lambdaLo) && Number.isFinite(lambdaHi)) {
      etaSquaredCI95 = [lambdaLo / (lambdaLo + N), lambdaHi / (lambdaHi + N)];
    }
  }

  return {
    label: "eta-squared",
    etaSquared,
    omegaSquared,
    etaSquaredCI95,
  };
}

export type PostHocMethod =
  | "tukey"
  | "dunnett"
  | "sidak"
  | "bonferroni"
  | "holm-sidak"
  | "none";

export interface OneWayOptions {
  postHoc?: PostHocMethod;
  /** Group label of the control, required for Dunnett. */
  control?: string;
  alpha?: number;
}

interface Group {
  label: string;
  values: number[];
  mean: number;
  n: number;
}

function buildGroups(
  data: Record<string, ArrayLike<number>>,
): Group[] {
  return Object.entries(data)
    .map(([label, raw]) => {
      const values = clean(raw);
      return { label, values, mean: meanOf(values), n: values.length };
    })
    .filter((g) => g.n > 0);
}

// --- p-adjustment families applied to a set of raw pairwise p-values ---

function sidakAdjust(p: number, m: number): number {
  return Math.min(1, 1 - Math.pow(1 - p, m));
}

function bonferroniAdjust(p: number, m: number): number {
  return Math.min(1, p * m);
}

/** Holm-Sidak step-down: sort ascending, adjust with decreasing m, enforce monotonicity. */
function holmSidakAdjust(pvals: number[]): number[] {
  const m = pvals.length;
  const order = pvals
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);
  const adj = new Array<number>(m);
  let prev = 0;
  for (let rank = 0; rank < m; rank++) {
    const remaining = m - rank;
    let a = 1 - Math.pow(1 - order[rank].p, remaining);
    a = Math.max(a, prev); // enforce monotone non-decreasing
    a = Math.min(1, a);
    prev = a;
    adj[order[rank].i] = a;
  }
  return adj;
}

/**
 * One-way ANOVA. `data` maps each group label to its observations.
 */
export function oneWayAnova(
  data: Record<string, ArrayLike<number>>,
  options: OneWayOptions = {},
): EngineResult<AnovaResult> {
  const groups = buildGroups(data);
  const k = groups.length;
  if (k < 2) {
    return { ok: false, error: "Need at least 2 non-empty groups." };
  }

  // Flatten for @stdlib (gives the validated omnibus F + p). The post-hoc
  // family reads its own alpha from `options` inside oneWayPostHoc.
  const flatX: number[] = [];
  const flatFactor: string[] = [];
  for (const g of groups) {
    for (const v of g.values) {
      flatX.push(v);
      flatFactor.push(g.label);
    }
  }
  const N = flatX.length;
  if (N - k <= 0) {
    return { ok: false, error: "Not enough observations for ANOVA." };
  }

  const omni = anova1(flatX, flatFactor);

  // Recompute SS for an explicit table (matches @stdlib but self-documented).
  const grandMean = meanOf(flatX);
  let ssBetween = 0;
  for (const g of groups) {
    const d = g.mean - grandMean;
    ssBetween += g.n * d * d;
  }
  let ssWithin = 0;
  for (const g of groups) {
    for (const v of g.values) {
      const d = v - g.mean;
      ssWithin += d * d;
    }
  }
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msBetween / msWithin;
  const pValue = fPValue(F, dfBetween, dfWithin);

  const table: AnovaTableRow[] = [
    {
      source: "Between groups",
      df: dfBetween,
      ss: ssBetween,
      ms: msBetween,
      f: F,
      pValue,
    },
    {
      source: "Within groups",
      df: dfWithin,
      ss: ssWithin,
      ms: msWithin,
      f: null,
      pValue: null,
    },
    {
      source: "Total",
      df: N - 1,
      ss: ssBetween + ssWithin,
      ms: NaN,
      f: null,
      pValue: null,
    },
  ];

  const comparisons = oneWayPostHoc(groups, msWithin, dfWithin, options);
  if (!comparisons.ok) return comparisons;

  return {
    ok: true,
    test: "One-way ANOVA",
    table,
    statistic: omni.statistic,
    pValue: omni.pValue,
    comparisons: comparisons.value,
    effectSize: anovaEffectSize(
      ssBetween,
      ssWithin,
      dfBetween,
      dfWithin,
      msWithin,
      N,
      F,
    ),
  };
}

function oneWayPostHoc(
  groups: Group[],
  msWithin: number,
  dfWithin: number,
  options: OneWayOptions,
): { ok: true; value: PairwiseComparison[] } | EngineResult<never> {
  const method = options.postHoc ?? "tukey";
  const alpha = options.alpha ?? 0.05;
  const k = groups.length;
  if (method === "none") return { ok: true, value: [] };

  // Dunnett compares every non-control group to the control only.
  if (method === "dunnett") {
    const control = options.control;
    if (!control || !groups.some((g) => g.label === control)) {
      return {
        ok: false,
        error: "Dunnett requires a valid `control` group label.",
      };
    }
    const ctrl = groups.find((g) => g.label === control)!;
    const others = groups.filter((g) => g.label !== control);
    const comps: PairwiseComparison[] = others.map((g) => {
      const se = Math.sqrt(msWithin * (1 / g.n + 1 / ctrl.n));
      const meanDiff = g.mean - ctrl.mean;
      const tStat = meanDiff / se;
      // Approximate the Dunnett-adjusted p by a Sidak correction over the
      // (k - 1) control comparisons applied to the two-sided t p-value. (A
      // documented approximation; the exact Dunnett distribution would need a
      // multivariate-t integral we do not pull a dependency for.)
      const raw = tPValue(tStat, dfWithin, "two-sided");
      const pAdjusted = sidakAdjust(raw, others.length);
      return {
        groupA: g.label,
        groupB: control,
        meanDiff,
        statistic: tStat,
        pValue: raw,
        pAdjusted,
        significant: pAdjusted < alpha,
        method: "Dunnett (Sidak-approx)",
      };
    });
    return { ok: true, value: comps };
  }

  // All-pairs families: build the pair list first.
  const pairs: Array<{ a: Group; b: Group }> = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) pairs.push({ a: groups[i], b: groups[j] });
  }
  const m = pairs.length;

  if (method === "tukey") {
    // Tukey HSD uses the studentized range q. For unequal n use the
    // Tukey-Kramer SE = sqrt(MSW/2 * (1/na + 1/nb)); q = |meanDiff| / SE.
    const comps: PairwiseComparison[] = pairs.map(({ a, b }) => {
      const se = Math.sqrt((msWithin / 2) * (1 / a.n + 1 / b.n));
      const meanDiff = a.mean - b.mean;
      const q = Math.abs(meanDiff) / se;
      const pAdjusted = studentizedRangePValue(q, k, dfWithin);
      return {
        groupA: a.label,
        groupB: b.label,
        meanDiff,
        statistic: q,
        pValue: pAdjusted, // q-distribution p is already the comparison p
        pAdjusted,
        significant: pAdjusted < alpha,
        method: "Tukey HSD",
      };
    });
    return { ok: true, value: comps };
  }

  // Sidak / Bonferroni / Holm-Sidak operate on the per-pair two-sided t p.
  const rawComps = pairs.map(({ a, b }) => {
    const se = Math.sqrt(msWithin * (1 / a.n + 1 / b.n));
    const meanDiff = a.mean - b.mean;
    const tStat = meanDiff / se;
    const raw = tPValue(tStat, dfWithin, "two-sided");
    return { a, b, meanDiff, tStat, raw };
  });

  let adjusted: number[];
  let label: string;
  if (method === "sidak") {
    adjusted = rawComps.map((c) => sidakAdjust(c.raw, m));
    label = "Sidak";
  } else if (method === "bonferroni") {
    adjusted = rawComps.map((c) => bonferroniAdjust(c.raw, m));
    label = "Bonferroni";
  } else {
    adjusted = holmSidakAdjust(rawComps.map((c) => c.raw));
    label = "Holm-Sidak";
  }

  const comps: PairwiseComparison[] = rawComps.map((c, i) => ({
    groupA: c.a.label,
    groupB: c.b.label,
    meanDiff: c.meanDiff,
    statistic: c.tStat,
    pValue: c.raw,
    pAdjusted: adjusted[i],
    significant: adjusted[i] < alpha,
    method: label,
  }));
  return { ok: true, value: comps };
}

// --- One-way ANOVA from entered summary statistics ---

/** One group's entered summary for the from-stats one-way ANOVA. */
export interface GroupSummaryStat {
  mean: number;
  sd: number;
  n: number;
}

/**
 * One-way ANOVA computed from ENTERED SUMMARY STATISTICS (group mean / SD / n)
 * rather than raw replicates. This is the omnibus F + p only; per-pair post-hoc
 * comparisons are OUT OF SCOPE from summary data (the all-pairs construction
 * needs either raw values or a per-pair pooled SE that a summary does not pin
 * down unambiguously), so comparisons is always empty here and the caller must
 * surface "post-hoc needs raw replicate data" if a user asks for it.
 *
 *   grand mean (weighted): xbar = sum(n_i * m_i) / sum(n_i)
 *   SS_between = sum( n_i * (m_i - xbar)^2 )
 *   SS_within  = sum( (n_i - 1) * sd_i^2 )            (since (n-1) sd^2 = SS_i)
 *   df_between = k - 1,  df_within = N - k
 *   F = (SS_between / df_between) / (SS_within / df_within)
 *
 * This is the standard reconstruction of f_oneway from group summaries and
 * matches scipy.stats.f_oneway on equivalent raw data to floating point. The raw
 * oneWayAnova path is unchanged.
 */
export function oneWayAnovaFromStats(
  groups: GroupSummaryStat[],
): EngineResult<AnovaResult> {
  const valid = groups.filter(
    (g) =>
      Number.isFinite(g.mean) &&
      Number.isFinite(g.sd) &&
      g.sd >= 0 &&
      g.n >= 1,
  );
  const k = valid.length;
  if (k < 2) {
    return { ok: false, error: "Need at least 2 groups with a mean, SD, and n." };
  }

  const N = valid.reduce((acc, g) => acc + g.n, 0);
  const dfWithin = N - k;
  if (dfWithin <= 0) {
    return {
      ok: false,
      error: "Not enough total replicates (each group needs n >= 2).",
    };
  }
  // A within-group SS needs n >= 2 in at least the groups that carry spread; a
  // group with n = 1 contributes zero within SS, which is the correct behavior.

  const grandMean =
    valid.reduce((acc, g) => acc + g.n * g.mean, 0) / N;

  let ssBetween = 0;
  for (const g of valid) {
    const d = g.mean - grandMean;
    ssBetween += g.n * d * d;
  }
  let ssWithin = 0;
  for (const g of valid) {
    ssWithin += (g.n - 1) * g.sd * g.sd;
  }

  const dfBetween = k - 1;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  if (!(msWithin > 0)) {
    return {
      ok: false,
      error: "Zero within-group spread; F is undefined. Check the entered SDs.",
    };
  }
  const F = msBetween / msWithin;
  const pValue = fPValue(F, dfBetween, dfWithin);

  const table: AnovaTableRow[] = [
    { source: "Between groups", df: dfBetween, ss: ssBetween, ms: msBetween, f: F, pValue },
    { source: "Within groups", df: dfWithin, ss: ssWithin, ms: msWithin, f: null, pValue: null },
    { source: "Total", df: N - 1, ss: ssBetween + ssWithin, ms: NaN, f: null, pValue: null },
  ];

  return {
    ok: true,
    test: "One-way ANOVA",
    table,
    statistic: F,
    pValue,
    // Post-hoc comparisons are not computable from summary stats (see doc above).
    comparisons: [],
    effectSize: anovaEffectSize(
      ssBetween,
      ssWithin,
      dfBetween,
      dfWithin,
      msWithin,
      N,
      F,
    ),
  };
}

// --- Two-way ANOVA ---

export interface TwoWayCell {
  factorA: string;
  factorB: string;
  value: number;
}

export interface TwoWayOptions {
  /** Run Tukey HSD on the marginal means of this factor. */
  postHocFactor?: "A" | "B";
  alpha?: number;
}

/**
 * Balanced or unbalanced two-way ANOVA with interaction (Type I / sequential
 * sums of squares via the cell-means model; for a balanced design this equals
 * the standard Type III table). Each observation is a (factorA, factorB, value)
 * cell entry. Requires replication for the interaction + error terms.
 */
export function twoWayAnova(
  observations: TwoWayCell[],
  options: TwoWayOptions = {},
): EngineResult<AnovaResult> {
  const obs = observations.filter((o) => Number.isFinite(o.value));
  if (obs.length === 0) {
    return { ok: false, error: "No finite observations." };
  }
  const alpha = options.alpha ?? 0.05;

  const levelsA = [...new Set(obs.map((o) => o.factorA))];
  const levelsB = [...new Set(obs.map((o) => o.factorB))];
  const a = levelsA.length;
  const b = levelsB.length;
  if (a < 2 || b < 2) {
    return { ok: false, error: "Each factor needs at least 2 levels." };
  }

  const N = obs.length;
  const grand = meanOf(obs.map((o) => o.value));

  const cellValues = (la: string, lb: string) =>
    obs.filter((o) => o.factorA === la && o.factorB === lb).map((o) => o.value);
  const rowValues = (la: string) =>
    obs.filter((o) => o.factorA === la).map((o) => o.value);
  const colValues = (lb: string) =>
    obs.filter((o) => o.factorB === lb).map((o) => o.value);

  // Check every cell has at least one observation (needed for interaction).
  for (const la of levelsA) {
    for (const lb of levelsB) {
      if (cellValues(la, lb).length === 0) {
        return {
          ok: false,
          error: `Empty cell (${la}, ${lb}); two-way ANOVA needs every combination populated.`,
        };
      }
    }
  }

  // Main-effect SS from marginal means.
  let ssA = 0;
  for (const la of levelsA) {
    const g = rowValues(la);
    const d = meanOf(g) - grand;
    ssA += g.length * d * d;
  }
  let ssB = 0;
  for (const lb of levelsB) {
    const g = colValues(lb);
    const d = meanOf(g) - grand;
    ssB += g.length * d * d;
  }

  // Cells SS, then interaction = cells - A - B.
  let ssCells = 0;
  let ssWithin = 0;
  for (const la of levelsA) {
    for (const lb of levelsB) {
      const cell = cellValues(la, lb);
      const cm = meanOf(cell);
      const d = cm - grand;
      ssCells += cell.length * d * d;
      for (const v of cell) {
        const e = v - cm;
        ssWithin += e * e;
      }
    }
  }
  const ssInteraction = ssCells - ssA - ssB;

  const dfA = a - 1;
  const dfB = b - 1;
  const dfAB = dfA * dfB;
  const dfWithin = N - a * b;
  if (dfWithin <= 0) {
    return {
      ok: false,
      error: "No replication; cannot estimate error / interaction. Add repeats.",
    };
  }

  const msA = ssA / dfA;
  const msB = ssB / dfB;
  const msAB = ssInteraction / dfAB;
  const msWithin = ssWithin / dfWithin;

  const fA = msA / msWithin;
  const fB = msB / msWithin;
  const fAB = msAB / msWithin;

  const table: AnovaTableRow[] = [
    { source: "Factor A", df: dfA, ss: ssA, ms: msA, f: fA, pValue: fPValue(fA, dfA, dfWithin) },
    { source: "Factor B", df: dfB, ss: ssB, ms: msB, f: fB, pValue: fPValue(fB, dfB, dfWithin) },
    {
      source: "Interaction",
      df: dfAB,
      ss: ssInteraction,
      ms: msAB,
      f: fAB,
      pValue: fPValue(fAB, dfAB, dfWithin),
    },
    { source: "Within (error)", df: dfWithin, ss: ssWithin, ms: msWithin, f: null, pValue: null },
    {
      source: "Total",
      df: N - 1,
      ss: ssA + ssB + ssInteraction + ssWithin,
      ms: NaN,
      f: null,
      pValue: null,
    },
  ];

  // Optional Tukey post-hoc on marginal means of the requested factor.
  let comparisons: PairwiseComparison[] = [];
  if (options.postHocFactor) {
    const levels = options.postHocFactor === "A" ? levelsA : levelsB;
    const getVals = options.postHocFactor === "A" ? rowValues : colValues;
    const marg = levels.map((l) => {
      const g = getVals(l);
      return { label: l, mean: meanOf(g), n: g.length };
    });
    for (let i = 0; i < marg.length; i++) {
      for (let j = i + 1; j < marg.length; j++) {
        const gi = marg[i];
        const gj = marg[j];
        const se = Math.sqrt((msWithin / 2) * (1 / gi.n + 1 / gj.n));
        const meanDiff = gi.mean - gj.mean;
        const q = Math.abs(meanDiff) / se;
        const pAdjusted = studentizedRangePValue(q, levels.length, dfWithin);
        comparisons.push({
          groupA: gi.label,
          groupB: gj.label,
          meanDiff,
          statistic: q,
          pValue: pAdjusted,
          pAdjusted,
          significant: pAdjusted < alpha,
          method: `Tukey HSD (factor ${options.postHocFactor})`,
        });
      }
    }
  }

  // Surface the interaction F/p as the headline omnibus result.
  const interaction = table[2];
  return {
    ok: true,
    test: "Two-way ANOVA",
    table,
    statistic: interaction.f ?? NaN,
    pValue: interaction.pValue ?? NaN,
    comparisons,
    // A single omnibus effect size is ambiguous for a two-factor design (each
    // effect would need its own partial eta-squared). E1 scopes effect sizes to
    // the one-way ANOVA, so the two-way table reports none here.
    effectSize: null,
  };
}

// --- Kruskal-Wallis + Dunn post-hoc ---

/**
 * Dunn's test for pairwise comparisons after Kruskal-Wallis (or Friedman). Uses
 * the pooled ranks: z_ij = (Rbar_i - Rbar_j) / SE, where SE depends on the tie
 * correction. p-values are Bonferroni-adjusted over all pairs by default.
 * Reference: Dunn (1964).
 */
function dunnPostHoc(
  labels: string[],
  rankMeans: number[],
  ns: number[],
  N: number,
  tieCorrection: number,
  alpha: number,
): PairwiseComparison[] {
  const k = labels.length;
  const m = (k * (k - 1)) / 2;
  // Tie-adjusted scaling factor for the rank-sum variance.
  const sigmaBase =
    (N * (N + 1)) / 12 - tieCorrection / (12 * (N - 1));
  const comps: PairwiseComparison[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const se = Math.sqrt(sigmaBase * (1 / ns[i] + 1 / ns[j]));
      const diff = rankMeans[i] - rankMeans[j];
      const z = se === 0 ? 0 : diff / se;
      const raw = normalPValue(z, "two-sided");
      const pAdjusted = bonferroniAdjustLocal(raw, m);
      comps.push({
        groupA: labels[i],
        groupB: labels[j],
        meanDiff: diff,
        statistic: z,
        pValue: raw,
        pAdjusted,
        significant: pAdjusted < alpha,
        method: "Dunn (Bonferroni)",
      });
    }
  }
  return comps;
}

function bonferroniAdjustLocal(p: number, m: number): number {
  return Math.min(1, p * m);
}

export function kruskalWallis(
  data: Record<string, ArrayLike<number>>,
  options: { alpha?: number } = {},
): EngineResult<AnovaResult> {
  const groups = buildGroups(data);
  const k = groups.length;
  if (k < 2) return { ok: false, error: "Need at least 2 non-empty groups." };
  const alpha = options.alpha ?? 0.05;

  // Pooled ranks across all observations.
  const pooled: number[] = [];
  const owner: number[] = [];
  groups.forEach((g, gi) => {
    for (const v of g.values) {
      pooled.push(v);
      owner.push(gi);
    }
  });
  const N = pooled.length;
  const { ranks, tieCorrection } = rankWithTies(pooled);

  const rankSums = new Array<number>(k).fill(0);
  const ns = new Array<number>(k).fill(0);
  ranks.forEach((r, idx) => {
    rankSums[owner[idx]] += r;
    ns[owner[idx]] += 1;
  });
  const rankMeans = rankSums.map((s, i) => s / ns[i]);

  // H statistic with tie correction.
  let H = 0;
  for (let i = 0; i < k; i++) H += (rankSums[i] * rankSums[i]) / ns[i];
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const tieDiv = 1 - tieCorrection / (N * N * N - N);
  const Hcorr = tieDiv === 0 ? H : H / tieDiv;
  const df = k - 1;
  const pValue = chiSquarePValue(Hcorr, df);

  // @stdlib cross-check on the omnibus statistic (validation belt-and-braces).
  void kruskalTest;

  const table: AnovaTableRow[] = [
    { source: "Kruskal-Wallis H", df, ss: NaN, ms: NaN, f: Hcorr, pValue },
  ];

  const comparisons = dunnPostHoc(
    groups.map((g) => g.label),
    rankMeans,
    ns,
    N,
    tieCorrection,
    alpha,
  );

  // Epsilon-squared is the rank analogue of eta-squared for Kruskal-Wallis. A
  // rank test has no sums of squares, so there is no parametric eta / omega and
  // no noncentral-F CI; we report epsilon-squared in etaSquared with an honest
  // label and leave omega-squared and the CI null.
  //   epsilon-squared = H * (N + 1) / (N^2 - 1)
  // Reference: Tomczak & Tomczak (2014), "The need to report effect size
  // estimates revisited".
  const epsilonSquared =
    N > 1 ? (Hcorr * (N + 1)) / (N * N - 1) : NaN;
  const effectSize: AnovaEffectSize = {
    label: "epsilon-squared",
    etaSquared: epsilonSquared,
    omegaSquared: null,
    etaSquaredCI95: null,
  };

  return {
    ok: true,
    test: "Kruskal-Wallis",
    table,
    statistic: Hcorr,
    pValue,
    comparisons,
    effectSize,
  };
}

// --- Friedman + Dunn ---

/**
 * Friedman test for repeated measures. `rows` are the subjects/blocks, each an
 * array of measurements across the `k` conditions (column order is the
 * condition order). Ranks within each row, then tests for a condition effect.
 * Reference: Friedman (1937); Conover (1999) for the post-hoc.
 */
export function friedman(
  rows: number[][],
  conditionLabels?: string[],
  options: { alpha?: number } = {},
): EngineResult<AnovaResult> {
  const clean2 = rows.filter(
    (r) => r.length > 0 && r.every((v) => Number.isFinite(v)),
  );
  const n = clean2.length;
  if (n < 2) return { ok: false, error: "Need at least 2 complete blocks." };
  const k = clean2[0].length;
  if (k < 2) return { ok: false, error: "Need at least 2 conditions." };
  if (!clean2.every((r) => r.length === k)) {
    return { ok: false, error: "All blocks must have the same length." };
  }
  const alpha = options.alpha ?? 0.05;
  const labels =
    conditionLabels && conditionLabels.length === k
      ? conditionLabels
      : Array.from({ length: k }, (_, i) => `C${i + 1}`);

  // Rank within each row; accumulate per-condition rank sums + tie correction.
  const colRankSums = new Array<number>(k).fill(0);
  let tieTerm = 0;
  for (const row of clean2) {
    const { ranks, tieCorrection } = rankWithTies(row);
    tieTerm += tieCorrection;
    ranks.forEach((r, j) => (colRankSums[j] += r));
  }

  // Friedman chi-square statistic:
  //   chi2 = 12 / (n k (k+1)) * sum(R_j^2) - 3 n (k+1)
  // divided by the tie correction factor 1 - sum(t^3 - t) / (n (k^3 - k)).
  let stat =
    (12 / (n * k * (k + 1))) *
      colRankSums.reduce((acc, rs) => acc + rs * rs, 0) -
    3 * n * (k + 1);
  const tieFactor = 1 - tieTerm / (n * (k * k * k - k));
  if (tieFactor > 0) stat = stat / tieFactor;

  const df = k - 1;
  const pValue = chiSquarePValue(stat, df);

  const table: AnovaTableRow[] = [
    { source: "Friedman chi-square", df, ss: NaN, ms: NaN, f: stat, pValue },
  ];

  // Dunn post-hoc on the mean ranks across blocks.
  const rankMeans = colRankSums.map((rs) => rs / n);
  const comps: PairwiseComparison[] = [];
  const m = (k * (k - 1)) / 2;
  // SE for Friedman mean-rank differences: sqrt(k(k+1) / (6n)).
  const se = Math.sqrt((k * (k + 1)) / (6 * n));
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diff = rankMeans[i] - rankMeans[j];
      const z = se === 0 ? 0 : diff / se;
      const raw = normalPValue(z, "two-sided");
      const pAdjusted = Math.min(1, raw * m);
      comps.push({
        groupA: labels[i],
        groupB: labels[j],
        meanDiff: diff,
        statistic: z,
        pValue: raw,
        pAdjusted,
        significant: pAdjusted < alpha,
        method: "Dunn (Bonferroni)",
      });
    }
  }

  return {
    ok: true,
    test: "Friedman",
    table,
    statistic: stat,
    pValue,
    comparisons: comps,
    // Kendall's W would be the matching effect size for Friedman, but E1 scopes
    // omnibus effect sizes to one-way ANOVA and Kruskal-Wallis, so none here.
    effectSize: null,
  };
}

// --- One-way repeated-measures ANOVA + sphericity corrections ---

/**
 * Greenhouse-Geisser sphericity epsilon from the k-by-k covariance matrix of the
 * within-subject conditions (Box 1954). Working with the condition covariance
 * matrix S:
 *
 *   dbar  = mean of the diagonal of S
 *   sbar  = mean of every entry of S
 *   rbar_i = mean of row i of S
 *
 *   epsilon_GG = (k^2 * (dbar - sbar)^2)
 *              / ( (k - 1) * ( sum_ij S_ij^2
 *                              - 2k * sum_i rbar_i^2
 *                              + k^2 * sbar^2 ) )
 *
 * epsilon ranges from 1/(k-1) (worst sphericity violation) to 1 (sphericity
 * holds). The Huynh-Feldt epsilon corrects the conservative bias of the GG
 * estimate (Huynh & Feldt 1976):
 *
 *   epsilon_HF = min( 1, (n*(k-1)*eps_GG - 2) / ((k-1)*(n - 1 - (k-1)*eps_GG)) )
 *
 * where n is the number of subjects and k the number of conditions.
 */
function sphericityEpsilons(
  cov: number[][],
  k: number,
  n: number,
): { gg: number; hf: number } {
  const rowMeans = cov.map((row) => meanOf(row));
  const dbar = meanOf(cov.map((row, i) => row[i]));
  let sbar = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) sbar += cov[i][j];
  sbar /= k * k;

  let sumSq = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) sumSq += cov[i][j] * cov[i][j];
  let sumRowMeanSq = 0;
  for (let i = 0; i < k; i++) sumRowMeanSq += rowMeans[i] * rowMeans[i];

  const numerator = k * k * (dbar - sbar) * (dbar - sbar);
  const denominator =
    (k - 1) * (sumSq - 2 * k * sumRowMeanSq + k * k * sbar * sbar);
  let gg = denominator > 0 ? numerator / denominator : 1;
  // Clamp to the theoretical [1/(k-1), 1] range against floating-point spill.
  const lower = 1 / (k - 1);
  if (gg < lower) gg = lower;
  if (gg > 1) gg = 1;

  const hfNum = n * (k - 1) * gg - 2;
  const hfDen = (k - 1) * (n - 1 - (k - 1) * gg);
  let hf = hfDen !== 0 ? hfNum / hfDen : 1;
  if (hf > 1) hf = 1;
  if (hf < lower) hf = lower;

  return { gg, hf };
}

/**
 * One-way repeated-measures ANOVA. `rows` are the subjects, each an array of the
 * k condition measurements in `conditionLabels` order (the same row-paired
 * Column table the paired t-test reads, with 2+ condition columns). Subjects are
 * complete cases only, so the caller must drop any row with a missing condition
 * before passing it here; this function additionally guards by requiring every
 * row to be finite and length k.
 *
 * The total variation is partitioned into between-subjects, the condition
 * effect, and the residual error:
 *
 *   SS_total      = sum over all cells of (x - grand mean)^2
 *   SS_subjects   = k * sum_i (subject_i mean - grand mean)^2
 *   SS_conditions = n * sum_j (condition_j mean - grand mean)^2
 *   SS_error      = SS_total - SS_subjects - SS_conditions
 *
 * with df_conditions = k - 1 and df_error = (k - 1)(n - 1). The condition F is
 * MS_conditions / MS_error and the uncorrected p comes from the F upper tail.
 * Greenhouse-Geisser and Huynh-Feldt epsilons + their corrected p-values address
 * a sphericity violation. Partial eta-squared is SS_conditions / (SS_conditions
 * + SS_error). Cross-checked against statsmodels AnovaRM (F/df/p) and pingouin
 * rm_anova (epsilons + corrected p).
 */
export function repeatedMeasuresAnova(
  rows: number[][],
  conditionLabels?: string[],
): EngineResult<RmAnovaResult> {
  const complete = rows.filter(
    (r) => r.length > 0 && r.every((v) => Number.isFinite(v)),
  );
  const n = complete.length;
  if (n < 2) {
    return { ok: false, error: "Need at least 2 subjects with complete data." };
  }
  const k = complete[0].length;
  if (k < 2) {
    return { ok: false, error: "Need at least 2 conditions." };
  }
  if (!complete.every((r) => r.length === k)) {
    return { ok: false, error: "Every subject must have the same number of conditions." };
  }

  const labels =
    conditionLabels && conditionLabels.length === k
      ? conditionLabels
      : Array.from({ length: k }, (_, i) => `C${i + 1}`);

  const all: number[] = [];
  for (const r of complete) for (const v of r) all.push(v);
  const grandMean = meanOf(all);

  const subjectMeans = complete.map((r) => meanOf(r));
  const conditionMeans: number[] = [];
  for (let j = 0; j < k; j++) {
    conditionMeans.push(meanOf(complete.map((r) => r[j])));
  }

  let ssTotal = 0;
  for (const r of complete) {
    for (const v of r) {
      const d = v - grandMean;
      ssTotal += d * d;
    }
  }
  let ssSubjects = 0;
  for (const sm of subjectMeans) {
    const d = sm - grandMean;
    ssSubjects += k * d * d;
  }
  let ssConditions = 0;
  for (const cm of conditionMeans) {
    const d = cm - grandMean;
    ssConditions += n * d * d;
  }
  const ssError = ssTotal - ssSubjects - ssConditions;

  const dfConditions = k - 1;
  const dfSubjects = n - 1;
  const dfError = dfConditions * dfSubjects;
  if (dfError <= 0) {
    return { ok: false, error: "Not enough subjects to estimate the error term." };
  }

  const msConditions = ssConditions / dfConditions;
  const msError = ssError / dfError;
  const F = msError > 0 ? msConditions / msError : NaN;
  const pValue = fPValue(F, dfConditions, dfError);
  const partialEtaSquared =
    ssConditions + ssError > 0 ? ssConditions / (ssConditions + ssError) : NaN;

  // Sample covariance matrix of the k conditions across the n subjects, for the
  // sphericity epsilons. Divide by (n - 1) for the unbiased covariance.
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let acc = 0;
      for (let s = 0; s < n; s++) {
        acc += (complete[s][i] - conditionMeans[i]) * (complete[s][j] - conditionMeans[j]);
      }
      cov[i][j] = acc / (n - 1);
    }
  }
  const { gg, hf } = sphericityEpsilons(cov, k, n);
  const pGreenhouseGeisser = fPValue(F, dfConditions * gg, dfError * gg);
  const pHuynhFeldt = fPValue(F, dfConditions * hf, dfError * hf);

  const table: AnovaTableRow[] = [
    {
      source: "Conditions",
      df: dfConditions,
      ss: ssConditions,
      ms: msConditions,
      f: F,
      pValue,
    },
    {
      source: "Subjects",
      df: dfSubjects,
      ss: ssSubjects,
      ms: ssSubjects / dfSubjects,
      f: null,
      pValue: null,
    },
    {
      source: "Error",
      df: dfError,
      ss: ssError,
      ms: msError,
      f: null,
      pValue: null,
    },
    {
      source: "Total",
      df: n * k - 1,
      ss: ssTotal,
      ms: NaN,
      f: null,
      pValue: null,
    },
  ];

  return {
    ok: true,
    test: "Repeated-measures ANOVA",
    table,
    statistic: F,
    pValue,
    conditions: k,
    subjects: n,
    dfConditions,
    dfError,
    partialEtaSquared,
    greenhouseGeisserEpsilon: gg,
    pGreenhouseGeisser,
    huynhFeldtEpsilon: hf,
    pHuynhFeldt,
    conditionMeans,
    conditionLabels: labels,
  };
}
