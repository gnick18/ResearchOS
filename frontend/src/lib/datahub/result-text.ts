// result-text (datahub-chrome). Render a normalized Data Hub result as plain
// tab-separated text so the results toolbar's Export action can copy it straight
// into a spreadsheet or a note, the same numbers the results tables show. This
// is the text companion to show-code.ts (which emits reproducible Python): here
// we just lay out the verdict plus the result tables as tab-delimited rows.
//
// We format from the SAME normalized result the ResultsSheet renders, so the
// copied text matches the screen. Numbers keep a sensible precision; a null /
// non-finite cell becomes an empty field, never the literal "null".
//
// No em-dashes, no emojis, no mid-sentence colons.

import { formatP, plainLanguageSummary } from "@/lib/datahub/plain-language";
import type { NormalizedResult } from "@/lib/datahub/run-analysis";

function n(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  return x.toFixed(digits);
}

/** One tab-separated row. */
function row(...cells: (string | number)[]): string {
  return cells.map((c) => String(c)).join("\t");
}

function ci(c: [number, number] | null | undefined): string {
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return "";
  return `${n(c[0], 2)} to ${n(c[1], 2)}`;
}

/**
 * Serialize a normalized result to tab-separated text. The first line is the
 * plain-language verdict, then a blank line, then the result table(s) for the
 * specific test kind. Multiple comparisons (Tukey) follow their own header.
 */
export function resultToText(result: NormalizedResult): string {
  const lines: string[] = [plainLanguageSummary(result), ""];

  switch (result.kind) {
    case "anova":
    case "twoWayAnova": {
      lines.push(row("Source", "SS", "df", "MS", "F", "p"));
      for (const r of result.table) {
        lines.push(
          row(
            r.source,
            n(r.ss, 2),
            r.df,
            Number.isFinite(r.ms) ? n(r.ms, 2) : "",
            r.f === null ? "" : n(r.f, 3),
            r.pValue === null ? "" : formatP(r.pValue),
          ),
        );
      }
      if (result.kind === "anova" && result.effectSize) {
        const es = result.effectSize;
        lines.push("", row(es.label, n(es.etaSquared, 4)));
        if (es.etaSquaredCI95) {
          lines.push(row(`95% CI of ${es.label}`, ci(es.etaSquaredCI95)));
        }
        if (es.omegaSquared !== null && Number.isFinite(es.omegaSquared)) {
          lines.push(row("omega-squared", n(es.omegaSquared, 4)));
        }
      }
      if (result.comparisons.length > 0) {
        lines.push("", row("Comparison", "Mean diff", "Adj. p"));
        for (const c of result.comparisons) {
          lines.push(
            row(`${c.groupA} vs ${c.groupB}`, n(c.meanDiff, 3), formatP(c.pAdjusted)),
          );
        }
      }
      break;
    }
    case "survival": {
      lines.push(row("Group", "Subjects", "Events", "Median survival"));
      for (const g of result.groups) {
        lines.push(
          row(g.name, g.n, g.events, g.median === null ? "not reached" : n(g.median, 2)),
        );
      }
      if (result.logRank) {
        lines.push(
          "",
          row("Log-rank chi-square", n(result.logRank.chiSquare, 3)),
          row("df", result.logRank.df),
          row("p", formatP(result.logRank.pValue)),
        );
      }
      break;
    }
    case "correlation": {
      lines.push(
        row("Method", result.method === "spearman" ? "Spearman rank" : "Pearson"),
        row(`Coefficient (${result.coefficientLabel})`, n(result.coefficient, 4)),
        row("95% CI", ci(result.ci95)),
        row("R-squared", n(result.rSquared, 4)),
        row("95% CI of R-squared", ci(result.rSquaredCI95)),
        row("t", n(result.statistic, 4)),
        row("df", n(result.df, 0)),
        row("p", formatP(result.pValue)),
        row("Pairs (n)", n(result.n, 0)),
      );
      break;
    }
    case "regression": {
      lines.push(
        row("Slope", n(result.slope, 6)),
        row("Slope SE", n(result.slopeSE, 6)),
        row("95% CI of slope", ci(result.slopeCI95)),
        row("Intercept", n(result.intercept, 6)),
        row("Intercept SE", n(result.interceptSE, 6)),
        row("95% CI of intercept", ci(result.interceptCI95)),
        row("R-squared", n(result.rSquared, 6)),
        row("Residual SE", n(result.residualSE, 6)),
        row("Pairs (n)", n(result.n, 0)),
      );
      break;
    }
    default: {
      // t-test family (parametric and rank tests).
      const statLabel = result.nonparametric
        ? result.test.startsWith("Wilcoxon")
          ? "W"
          : "U"
        : "t";
      lines.push(
        row("Test", result.test),
        row(`Mean (${result.groups[0].name})`, n(result.meanA, 4)),
        row(`Mean (${result.groups[1].name})`, n(result.meanB, 4)),
        row("Difference of means", n(result.meanDiff, 4)),
        row(statLabel, n(result.statistic, 4)),
      );
      if (!result.nonparametric) {
        lines.push(row("df", n(result.df, result.df % 1 === 0 ? 0 : 2)));
      }
      lines.push(row("p", formatP(result.pValue)));
      if (!result.nonparametric) {
        lines.push(row("95% CI of difference", ci(result.ci95)));
      }
      lines.push(row(result.effectSizeLabel, n(result.effectSize, 4)));
      if (result.effectSizeCI95) {
        lines.push(
          row(`95% CI of ${result.effectSizeLabel}`, ci(result.effectSizeCI95)),
        );
      }
      if (result.hedgesG !== null && Number.isFinite(result.hedgesG)) {
        lines.push(row("Hedges' g", n(result.hedgesG, 4)));
      }
      break;
    }
  }

  return lines.join("\n") + "\n";
}
