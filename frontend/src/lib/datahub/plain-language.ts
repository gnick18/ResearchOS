// plain-language.ts
//
// Turn a normalized analysis result into one warm, plain-language verdict in
// house voice. The point of Data Hub is that a researcher reads the takeaway
// first (does it differ, which way, by how much) and only then the table, so
// this sentence leads the Results sheet.
//
// House voice: state the practical takeaway, not just the numbers; no
// em-dashes, no emojis, no mid-sentence colons.

import type {
  NormalizedAnova,
  NormalizedCorrelation,
  NormalizedRegression,
  NormalizedResult,
  NormalizedTTest,
} from "@/lib/datahub/run-analysis";

const ALPHA = 0.05;

/** Format a p-value the way a methods section reads it. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "p could not be computed";
  if (p < 0.0001) return "p < 0.0001";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(p < 0.01 ? 4 : 3)}`;
}

/** Round a number for inline prose with a sensible default precision. */
function num(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(digits);
}

function anovaSummary(r: NormalizedAnova): string {
  const names = r.groups.map((g) => g.name);
  const list =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const postHocLabel = r.nonparametric ? "Dunn" : "Tukey";
  const stat = r.nonparametric
    ? `Kruskal-Wallis, H(${r.dfBetween}) = ${num(r.statistic)}, ${formatP(
        r.pValue,
      )}`
    : `one-way ANOVA, F(${r.dfBetween}, ${r.dfWithin}) = ${num(
        r.statistic,
      )}, ${formatP(r.pValue)}`;

  if (r.pValue < ALPHA) {
    const sig = r.comparisons.filter((c) => c.significant).length;
    const pairTail =
      sig > 0
        ? ` ${sig} of ${r.comparisons.length} pairs differ after ${postHocLabel} correction, so see the comparisons below for which ones.`
        : ` The omnibus test is significant, so see the ${postHocLabel} comparisons for where the difference sits.`;
    return `At least one of ${list} stands apart from the rest (${stat}).${pairTail}`;
  }
  return `${list} look the same on this measure (${stat}). There is not enough evidence to call any group different.`;
}

function ttestSummary(r: NormalizedTTest): string {
  const [a, b] = r.groups;
  // A rank test reports its own statistic (U or W) with no df, and it compares
  // distributions rather than means, so the prose says "shifts higher" not "is
  // higher by N on average".
  const statLabel = r.nonparametric
    ? r.test.startsWith("Wilcoxon")
      ? "W"
      : "U"
    : "t";
  const statHead = r.nonparametric
    ? `${r.test}, ${statLabel} = ${num(r.statistic, 2)}, ${formatP(r.pValue)}`
    : `${r.test}, t(${num(r.df, r.df % 1 === 0 ? 0 : 1)}) = ${num(
        r.statistic,
        2,
      )}, ${formatP(r.pValue)}`;

  if (r.pValue < ALPHA) {
    const higher = r.meanDiff > 0 ? a.name : b.name;
    const lower = r.meanDiff > 0 ? b.name : a.name;
    if (r.nonparametric) {
      return `${higher} tends to read higher than ${lower}, and that shift is unlikely to be chance (${statHead}). A rank test compares the whole distribution, so it holds up even when the numbers are not normally distributed.`;
    }
    return `${higher} is higher than ${lower} by ${num(
      Math.abs(r.meanDiff),
      2,
    )} on average, and that gap is unlikely to be chance (${statHead}).`;
  }
  if (r.nonparametric) {
    return `${a.name} and ${b.name} are statistically indistinguishable here (${statHead}). A rank test found no reliable shift between the two distributions.`;
  }
  return `${a.name} and ${b.name} are statistically indistinguishable here (${statHead}). The means differ by ${num(
    Math.abs(r.meanDiff),
    2,
  )}, which is within what chance would produce.`;
}

/** Plain-language strength word for a correlation magnitude. */
function strengthWord(abs: number): string {
  if (abs >= 0.7) return "strong";
  if (abs >= 0.4) return "moderate";
  if (abs >= 0.2) return "weak";
  return "negligible";
}

function correlationSummary(r: NormalizedCorrelation): string {
  const sym = r.coefficientLabel;
  const stat = `${
    r.method === "spearman" ? "Spearman" : "Pearson"
  }, ${sym} = ${num(r.coefficient, 2)}, ${formatP(r.pValue)}, n = ${r.n}`;
  const dir = r.coefficient >= 0 ? "rises with" : "falls as";
  const strength = strengthWord(Math.abs(r.coefficient));
  if (r.pValue < ALPHA) {
    return `${r.yName} ${dir} ${r.xName} (${stat}). That is a ${strength}, statistically reliable ${
      r.method === "spearman" ? "monotone" : "linear"
    } association.`;
  }
  return `${r.yName} and ${r.xName} show no reliable association here (${stat}). The ${strength} trend that is present is within what chance would produce.`;
}

function regressionSummary(r: NormalizedRegression): string {
  const stat = `y = ${num(r.intercept, 3)} + ${num(
    r.slope,
    3,
  )} x, R-squared = ${num(r.rSquared, 3)}, n = ${r.n}`;
  const dir = r.slope >= 0 ? "increases" : "decreases";
  return `Each one-unit rise in ${r.xName} ${dir} ${r.yName} by about ${num(
    Math.abs(r.slope),
    3,
  )} (${stat}). The line explains ${num(
    r.rSquared * 100,
    0,
  )} percent of the variation in ${r.yName}.`;
}

/**
 * The one-sentence (or two-sentence) plain-language verdict for a normalized
 * result. The ResultsSheet renders this above the stats table.
 */
export function plainLanguageSummary(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaSummary(result);
  if (result.kind === "correlation") return correlationSummary(result);
  if (result.kind === "regression") return regressionSummary(result);
  return ttestSummary(result);
}
