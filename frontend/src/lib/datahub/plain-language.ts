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
  const stat = `one-way ANOVA, F(${r.dfBetween}, ${r.dfWithin}) = ${num(
    r.statistic,
  )}, ${formatP(r.pValue)}`;

  if (r.pValue < ALPHA) {
    const sig = r.comparisons.filter((c) => c.significant).length;
    const pairTail =
      sig > 0
        ? ` ${sig} of ${r.comparisons.length} pairs differ after Tukey correction, so see the comparisons below for which ones.`
        : " The omnibus test is significant, so see the Tukey comparisons for where the difference sits.";
    return `At least one of ${list} stands apart from the rest (${stat}).${pairTail}`;
  }
  return `${list} look the same on this measure (${stat}). There is not enough evidence to call any group different.`;
}

function ttestSummary(r: NormalizedTTest): string {
  const [a, b] = r.groups;
  const stat = `${r.test}, t(${num(r.df, r.df % 1 === 0 ? 0 : 1)}) = ${num(
    r.statistic,
    2,
  )}, ${formatP(r.pValue)}`;

  if (r.pValue < ALPHA) {
    const higher = r.meanDiff > 0 ? a.name : b.name;
    const lower = r.meanDiff > 0 ? b.name : a.name;
    return `${higher} is higher than ${lower} by ${num(
      Math.abs(r.meanDiff),
      2,
    )} on average, and that gap is unlikely to be chance (${stat}).`;
  }
  return `${a.name} and ${b.name} are statistically indistinguishable here (${stat}). The means differ by ${num(
    Math.abs(r.meanDiff),
    2,
  )}, which is within what chance would produce.`;
}

/**
 * The one-sentence (or two-sentence) plain-language verdict for a normalized
 * result. The ResultsSheet renders this above the stats table.
 */
export function plainLanguageSummary(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaSummary(result);
  return ttestSummary(result);
}
