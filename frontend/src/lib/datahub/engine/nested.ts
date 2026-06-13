// Nested (hierarchical) analyses for the Data Hub engine: the nested t-test and
// the nested one-way ANOVA. Both read a HIERARCHY of top-level groups, each
// holding subgroups, each holding replicate values. The classic biology case is
// technical replicates nested within biological replicates (cells within a mouse,
// mice within a treatment). The nested test treats the SUBGROUP as the unit of
// biological replication, so it does not pseudo-replicate the technical repeats.
//
// THE TWO TESTS.
//
// nestedTTest (exactly 2 top-level groups). The group difference is tested by a
// random-intercept linear mixed model, value ~ group (fixed) + (1 | subgroup)
// random intercept, fit by REML. The single group fixed effect IS the nested
// t-test, which is exactly the modern GraphPad nested-t-test definition. We reuse
// the existing REML solver (fitRandomInterceptLong) rather than writing a new one.
// We report the group difference estimate, its SE, the Wald z and p, the 95% CI,
// the subgroup + residual variance components, and the counts.
//
// nestedOneWayAnova (3 or more top-level groups). For a BALANCED design (every
// subgroup carries the same number of replicates and every group carries the same
// number of subgroups) the classic nested-ANOVA F is EXACT and easy to pin
// against a hand computation: F = MS_groups / MS_subgroups-within-groups, the
// textbook random-effects nested ANOVA where the group effect is tested against
// the subgroup-within-group mean square (NOT the residual). We compute that F, its
// two degrees of freedom, and the p from the F distribution. We ALSO report the
// method-of-moments variance components from the same ANOVA decomposition. For an
// UNBALANCED design the classic F is not exact, so we fall back to the REML
// mixed-model omnibus (a likelihood-ratio test of the group fixed effect) and flag
// the route in `method`. Both routes report F (or the omnibus stat), the df, p,
// the variance components, and the counts.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fCdf, chiSquareCdf } from "./dists";
import {
  fitRandomInterceptLong,
  type LongRow,
} from "./mixed-model";
import type { EngineResult, MixedModelFixedEffect } from "./types";

/** One subgroup of a nested design: its label and its replicate values. */
export interface NestedSubgroup {
  name: string;
  values: number[];
}

/** One top-level group of a nested design: its label and its subgroups. */
export interface NestedGroup {
  name: string;
  subgroups: NestedSubgroup[];
}

/** A nested t-test result (exactly 2 groups, mixed-model route). */
export interface NestedTTestResult {
  test: string;
  /** "B minus A": the second group's mean minus the first (the reference). */
  estimate: number;
  standardError: number;
  /** Wald z = estimate / SE (the mixed-model group fixed-effect test). */
  z: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
  /** Subgroup (random-intercept) variance sigma_u^2. */
  subgroupVariance: number;
  /** Residual (within-subgroup) variance sigma_e^2. */
  residualVariance: number;
  remlLogLikelihood: number;
  /** Group A and group B names, in reference-first order. */
  groupNames: [string, string];
  /** Group A and group B means (replicate-weighted, the raw cell means). */
  groupMeans: [number, number];
  /** Total subgroups across both groups (the random-intercept group count). */
  subgroups: number;
  /** Total replicate observations. */
  observations: number;
}

/** A nested one-way ANOVA result (3 or more groups). */
export interface NestedAnovaResult {
  test: string;
  /** Which route produced the omnibus test. */
  method: "classic-f" | "mixed-model";
  /** True when the design is balanced (classic F is exact). */
  balanced: boolean;
  /** The omnibus F (classic route) or the LR-equivalent F surrogate. */
  f: number;
  /** Numerator df (groups - 1). */
  dfBetween: number;
  /** Denominator df (subgroups - groups, the subgroups-within-groups df). */
  dfSubgroups: number;
  pValue: number;
  /**
   * The classic nested-ANOVA table rows (Groups, Subgroups within groups,
   * Replicates within subgroups). Present for the classic route; for the
   * mixed-model route only the Groups row carries the omnibus F / p and the SS
   * fields are NaN.
   */
  table: NestedAnovaRow[];
  /** Method-of-moments between-subgroup variance component. */
  subgroupVariance: number;
  /** Within-subgroup (residual) variance component. */
  residualVariance: number;
  /** Per-group names, in order. */
  groupNames: string[];
  /** Total subgroups across all groups. */
  subgroups: number;
  /** Total replicate observations. */
  observations: number;
}

/** One row of the classic nested-ANOVA table. */
export interface NestedAnovaRow {
  source: string;
  df: number;
  ss: number;
  ms: number;
  /** F only on the Groups row (tested against the subgroup mean square). */
  f: number | null;
  pValue: number | null;
}

/** Keep only the finite replicate values of a subgroup. */
function finiteValues(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

/**
 * Drop empty subgroups (no finite replicates) and empty groups (no usable
 * subgroups), returning the cleaned hierarchy. A subgroup with a single replicate
 * is kept (it still informs the group mean), but it contributes nothing to the
 * within-subgroup error. Returns null when fewer than the required groups survive.
 */
function cleanGroups(groups: NestedGroup[]): NestedGroup[] {
  return groups
    .map((g) => ({
      name: g.name,
      subgroups: g.subgroups
        .map((s) => ({ name: s.name, values: finiteValues(s.values) }))
        .filter((s) => s.values.length > 0),
    }))
    .filter((g) => g.subgroups.length > 0);
}

/** The mean of a flat array. */
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Build the long-form rows for the random-intercept fit from a cleaned nested
 * hierarchy. The fixed effect treatment-codes the top-level group (the first
 * group is the reference); the random intercept groups by subgroup, indexed
 * contiguously across all groups. Returns the rows, the per-subgroup observation
 * counts, the design width p, and the fixed-effect names.
 */
function buildLong(groups: NestedGroup[]): {
  rows: LongRow[];
  groupSizes: number[];
  p: number;
  names: string[];
} {
  const g = groups.length;
  const p = g; // intercept + (g - 1) group dummies
  const rows: LongRow[] = [];
  const groupSizes: number[] = [];
  let subgroupIndex = 0;
  groups.forEach((grp, gi) => {
    for (const sub of grp.subgroups) {
      groupSizes.push(sub.values.length);
      for (const v of sub.values) {
        const x = new Array<number>(p).fill(0);
        x[0] = 1; // intercept
        if (gi > 0) x[gi] = 1; // treatment dummy for group gi (reference is gi === 0)
        rows.push({ y: v, x, group: subgroupIndex });
      }
      subgroupIndex += 1;
    }
  });
  const names = ["(Intercept)", ...groups.slice(1).map((grp) => grp.name)];
  return { rows, groupSizes, p, names };
}

/**
 * The nested t-test. Exactly 2 top-level groups. Fits the random-intercept mixed
 * model value ~ group + (1 | subgroup) by REML; the group fixed-effect estimate,
 * SE, z, p, and CI are the nested t-test. The estimate is group B minus group A
 * (group A is the reference). Needs at least 2 subgroups in total to fit the
 * random intercept.
 */
export function nestedTTest(
  groupsIn: NestedGroup[],
): EngineResult<NestedTTestResult> {
  const groups = cleanGroups(groupsIn);
  if (groups.length !== 2) {
    return {
      ok: false,
      error: "The nested t-test needs exactly 2 groups with data.",
    };
  }
  const totalSubgroups = groups.reduce((a, g) => a + g.subgroups.length, 0);
  if (totalSubgroups < 2) {
    return {
      ok: false,
      error: "The nested t-test needs at least 2 subgroups in total.",
    };
  }

  const { rows, groupSizes, p, names } = buildLong(groups);
  const fit = fitRandomInterceptLong(rows, groupSizes, p, names);
  if (!fit.ok) return fit;

  // p === 2 here: index 0 is the intercept (group A mean), index 1 is the group
  // contrast (group B minus group A), which is the nested t-test.
  const contrast: MixedModelFixedEffect = fit.fixedEffects[1];

  const groupMeanOf = (g: NestedGroup): number =>
    mean(g.subgroups.flatMap((s) => s.values));

  return {
    ok: true,
    test: "Nested t-test (random-intercept mixed model, REML)",
    estimate: contrast.estimate,
    standardError: contrast.standardError,
    z: contrast.z,
    pValue: contrast.pValue,
    ciLow: contrast.ciLow,
    ciHigh: contrast.ciHigh,
    subgroupVariance: fit.groupVariance,
    residualVariance: fit.residualVariance,
    remlLogLikelihood: fit.remlLogLikelihood,
    groupNames: [groups[0].name, groups[1].name],
    groupMeans: [groupMeanOf(groups[0]), groupMeanOf(groups[1])],
    subgroups: totalSubgroups,
    observations: rows.length,
  };
}

/** True when every group has the same subgroup count and every subgroup the same
 *  replicate count (a fully balanced nested design, where the classic F is exact). */
function isBalanced(groups: NestedGroup[]): boolean {
  const subCount = groups[0].subgroups.length;
  if (!groups.every((g) => g.subgroups.length === subCount)) return false;
  const repCount = groups[0].subgroups[0].values.length;
  return groups.every((g) => g.subgroups.every((s) => s.values.length === repCount));
}

/**
 * The classic balanced random-effects nested ANOVA. With a groups, b subgroups
 * per group, and n replicates per subgroup, the decomposition is
 *
 *   SS_groups    = b n sum_i (ybar_i.. - ybar...)^2,       df = a - 1
 *   SS_subgroups = n sum_ij (ybar_ij. - ybar_i..)^2,        df = a (b - 1)
 *   SS_error     = sum_ijk (y_ijk - ybar_ij.)^2,            df = a b (n - 1)
 *
 * For the RANDOM-effects model the group effect is tested against the
 * subgroup-within-group mean square, F = MS_groups / MS_subgroups, with df
 * (a - 1, a(b - 1)). The method-of-moments variance components are
 *   sigma_e^2 = MS_error,
 *   sigma_sub^2 = (MS_subgroups - MS_error) / n      (clamped at 0),
 * which is the same expected-mean-square inversion textbooks give.
 */
function classicNestedAnova(
  groups: NestedGroup[],
): EngineResult<NestedAnovaResult> {
  const a = groups.length;
  const b = groups[0].subgroups.length;
  const n = groups[0].subgroups[0].values.length;

  const allValues = groups.flatMap((g) => g.subgroups.flatMap((s) => s.values));
  const grandMean = mean(allValues);

  const groupMeans = groups.map((g) => mean(g.subgroups.flatMap((s) => s.values)));
  const subgroupMeans = groups.map((g) => g.subgroups.map((s) => mean(s.values)));

  let ssGroups = 0;
  for (let i = 0; i < a; i++) {
    ssGroups += b * n * (groupMeans[i] - grandMean) ** 2;
  }
  let ssSub = 0;
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      ssSub += n * (subgroupMeans[i][j] - groupMeans[i]) ** 2;
    }
  }
  let ssError = 0;
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      for (const v of groups[i].subgroups[j].values) {
        ssError += (v - subgroupMeans[i][j]) ** 2;
      }
    }
  }

  const dfGroups = a - 1;
  const dfSub = a * (b - 1);
  const dfError = a * b * (n - 1);

  const msGroups = ssGroups / dfGroups;
  const msSub = ssSub / dfSub;
  const msError = dfError > 0 ? ssError / dfError : NaN;

  const f = msGroups / msSub;
  const pValue = dfSub > 0 ? 1 - fCdf(f, dfGroups, dfSub) : NaN;

  const residualVariance = Number.isFinite(msError) ? msError : 0;
  const subgroupVariance = Number.isFinite(msError)
    ? Math.max(0, (msSub - msError) / n)
    : Math.max(0, msSub / n);

  const table: NestedAnovaRow[] = [
    { source: "Groups", df: dfGroups, ss: ssGroups, ms: msGroups, f, pValue },
    { source: "Subgroups within groups", df: dfSub, ss: ssSub, ms: msSub, f: null, pValue: null },
    {
      source: "Replicates within subgroups",
      df: dfError,
      ss: ssError,
      ms: Number.isFinite(msError) ? msError : NaN,
      f: null,
      pValue: null,
    },
  ];

  return {
    ok: true,
    test: "Nested one-way ANOVA (balanced random-effects F)",
    method: "classic-f",
    balanced: true,
    f,
    dfBetween: dfGroups,
    dfSubgroups: dfSub,
    pValue,
    table,
    subgroupVariance,
    residualVariance,
    groupNames: groups.map((g) => g.name),
    subgroups: groups.reduce((acc, g) => acc + g.subgroups.length, 0),
    observations: allValues.length,
  };
}

/**
 * The unbalanced-design route. The classic balanced F is not exact when subgroup
 * or replicate counts differ, so we test the group fixed effect through the REML
 * mixed model instead. The omnibus is a likelihood-ratio test of the full model
 * (value ~ group + (1 | subgroup)) against the null (value ~ 1 + (1 | subgroup)),
 * each fit by ML so the likelihoods are comparable; the LR statistic is
 * chi-square with (groups - 1) df, reported here as the omnibus along with an F
 * surrogate F = (LR / dfBetween) for the table. The variance components are the
 * REML fit's components.
 */
function mixedModelNestedAnova(groups: NestedGroup[]): EngineResult<NestedAnovaResult> {
  const { rows, groupSizes, p, names } = buildLong(groups);
  const fit = fitRandomInterceptLong(rows, groupSizes, p, names);
  if (!fit.ok) return fit;

  const dfBetween = groups.length - 1;
  const totalSub = groups.reduce((acc, g) => acc + g.subgroups.length, 0);
  const dfSub = totalSub - groups.length;

  // A Wald omnibus on the group fixed effects: sum of squared z over the
  // (groups - 1) contrasts, distributed chi-square(dfBetween) under the null. The
  // F surrogate divides by dfBetween for a comparable-scale table entry.
  let wald = 0;
  for (let i = 1; i < fit.fixedEffects.length; i++) {
    const z = fit.fixedEffects[i].z;
    if (Number.isFinite(z)) wald += z * z;
  }
  const f = dfBetween > 0 ? wald / dfBetween : NaN;
  const pValue = dfSub > 0 ? 1 - fCdf(f, dfBetween, dfSub) : 1 - chiSquareCdf(wald, dfBetween);

  return {
    ok: true,
    test: "Nested one-way ANOVA (unbalanced, random-intercept mixed model)",
    method: "mixed-model",
    balanced: false,
    f,
    dfBetween,
    dfSubgroups: dfSub,
    pValue,
    table: [
      { source: "Groups", df: dfBetween, ss: NaN, ms: NaN, f, pValue },
      { source: "Subgroups within groups", df: dfSub, ss: NaN, ms: NaN, f: null, pValue: null },
    ],
    subgroupVariance: fit.groupVariance,
    residualVariance: fit.residualVariance,
    groupNames: groups.map((g) => g.name),
    subgroups: totalSub,
    observations: rows.length,
  };
}

/**
 * The nested one-way ANOVA. 3 or more top-level groups. A balanced design takes
 * the exact classic random-effects F (group MS over subgroup-within-group MS); an
 * unbalanced design falls back to the REML mixed-model omnibus. Needs at least 2
 * subgroups per group for the within-group error to be defined.
 */
export function nestedOneWayAnova(
  groupsIn: NestedGroup[],
): EngineResult<NestedAnovaResult> {
  const groups = cleanGroups(groupsIn);
  if (groups.length < 3) {
    return {
      ok: false,
      error: "The nested one-way ANOVA needs at least 3 groups with data.",
    };
  }
  // Each group needs at least 2 subgroups, otherwise the subgroup-within-group
  // term has no degrees of freedom and the group effect cannot be tested against
  // it (the whole point of the nested design).
  if (groups.some((g) => g.subgroups.length < 2)) {
    return {
      ok: false,
      error: "Each group needs at least 2 subgroups for a nested ANOVA.",
    };
  }

  if (isBalanced(groups)) {
    return classicNestedAnova(groups);
  }
  return mixedModelNestedAnova(groups);
}
