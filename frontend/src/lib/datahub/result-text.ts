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
      if (result.gehanBreslowWilcoxon) {
        lines.push(
          "",
          row(
            "Gehan-Breslow-Wilcoxon chi-square",
            n(result.gehanBreslowWilcoxon.chiSquare, 3),
          ),
          row("df", result.gehanBreslowWilcoxon.df),
          row("p", formatP(result.gehanBreslowWilcoxon.pValue)),
        );
      }
      break;
    }
    case "coxRegression": {
      lines.push(row("Term", "Coef", "SE", "z", "p", "HR", "95% CI"));
      for (const c of result.coefficients) {
        lines.push(
          row(
            c.name,
            n(c.coef, 4),
            n(c.se, 4),
            n(c.z, 3),
            formatP(c.pValue),
            n(c.hazardRatio, 4),
            `${n(c.hrCiLow, 3)} to ${n(c.hrCiHigh, 3)}`,
          ),
        );
      }
      lines.push(
        "",
        row("Concordance", n(result.concordance, 4)),
        row("Log-likelihood", n(result.logLikelihood, 3)),
        row("LR chi-square", `${n(result.lrChiSquare, 3)} (df ${result.lrDf})`),
        row("LR p", formatP(result.lrPValue)),
      );
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
    case "logisticRegression": {
      lines.push(
        row("Term", "Estimate", "SE", "z", "p", "95% CI"),
        row(
          "Intercept",
          n(result.intercept.estimate, 6),
          n(result.intercept.standardError, 6),
          n(result.intercept.z, 4),
          formatP(result.intercept.pValue),
          ci(result.intercept.ci95),
        ),
        row(
          `Slope (${result.slope.name})`,
          n(result.slope.estimate, 6),
          n(result.slope.standardError, 6),
          n(result.slope.z, 4),
          formatP(result.slope.pValue),
          ci(result.slope.ci95),
        ),
        "",
        row("Odds ratio (per unit X)", n(result.oddsRatio, 6)),
        row("95% CI of odds ratio", ci(result.oddsRatioCI95)),
        row("X at P=0.5", n(result.xAtHalf, 6)),
        row("McFadden pseudo-R-squared", n(result.mcFaddenR2, 6)),
        row("Log-likelihood", n(result.logLikelihood, 4)),
        row("Null log-likelihood", n(result.nullLogLikelihood, 4)),
        row("ROC AUC", Number.isFinite(result.auc) ? n(result.auc, 4) : ""),
        row("Iterations", n(result.iterations, 0)),
        row("Rows (n)", n(result.n, 0)),
      );
      break;
    }
    case "multipleRegression": {
      lines.push(row("Term", "Estimate", "SE", "t", "p", "95% CI"));
      for (const c of result.coefficients) {
        lines.push(
          row(
            c.name,
            n(c.estimate, 6),
            n(c.standardError, 6),
            n(c.t, 4),
            formatP(c.pValue),
            ci(c.ci95),
          ),
        );
      }
      lines.push("", row("Term", "Std. beta", "VIF"));
      for (const c of result.slopes) {
        lines.push(
          row(
            c.name,
            Number.isFinite(c.standardizedBeta) ? n(c.standardizedBeta, 4) : "",
            Number.isFinite(c.vif) ? n(c.vif, 4) : "inf",
          ),
        );
      }
      lines.push(
        "",
        row("R-squared", n(result.rSquared, 6)),
        row("Adjusted R-squared", n(result.adjRSquared, 6)),
        row("Residual SE (sigma)", n(result.residualSE, 6)),
        row(
          `Overall F (${result.fDfNum}, ${result.fDfDen})`,
          n(result.fStatistic, 6),
        ),
        row("Overall F p", formatP(result.fPValue)),
        row("Log-likelihood", n(result.logLikelihood, 4)),
        row("Predictors (k)", n(result.nPredictors, 0)),
        row("Rows (n)", n(result.n, 0)),
      );
      break;
    }
    case "doseResponse": {
      // Use exponential text for the EC50 so a sub-nanomolar dose stays readable.
      const conc = (x: number): string =>
        !Number.isFinite(x)
          ? ""
          : Math.abs(x) !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4)
            ? x.toExponential(4)
            : Number(x.toPrecision(5)).toString();
      const concCi = (c: [number, number]): string =>
        !Number.isFinite(c[0]) || !Number.isFinite(c[1])
          ? ""
          : `${conc(c[0])} to ${conc(c[1])}`;
      lines.push(
        row("Model", result.modelLabel),
        row("EC50 / IC50", conc(result.ec50)),
        row("95% CI of EC50", concCi(result.ec50CI95)),
        row("Hill slope", n(result.hillSlope.value, 4)),
        row("95% CI of Hill slope", ci(result.hillSlope.ci95)),
        row("Top", n(result.top.value, 4)),
        row("95% CI of Top", ci(result.top.ci95)),
        row("Bottom", n(result.bottom.value, 4)),
        row("95% CI of Bottom", ci(result.bottom.ci95)),
      );
      if (result.asymmetryS) {
        lines.push(
          row("Asymmetry (S)", n(result.asymmetryS.value, 4)),
          row("95% CI of S", ci(result.asymmetryS.ci95)),
        );
      }
      lines.push(
        row("R-squared", n(result.rSquared, 6)),
        row("Points (n)", n(result.n, 0)),
      );
      break;
    }
    case "modelComparison": {
      lines.push(
        row("Model", "Params", "SS", "R-squared", "AICc", "AICc delta", "Probability"),
        row(
          result.simpler.label,
          result.simpler.nParams,
          n(result.simpler.ssr, 4),
          n(result.simpler.rSquared, 6),
          n(result.simpler.aicc, 3),
          n(result.simpler.aiccDelta, 3),
          n(result.simpler.aiccProbability, 4),
        ),
        row(
          result.complex.label,
          result.complex.nParams,
          n(result.complex.ssr, 4),
          n(result.complex.rSquared, 6),
          n(result.complex.aicc, 3),
          n(result.complex.aiccDelta, 3),
          n(result.complex.aiccProbability, 4),
        ),
        "",
        row("AICc preferred", result.aicc.preferredLabel),
        row("Evidence ratio", n(result.aicc.evidenceRatio, 2)),
      );
      if (result.fTest) {
        lines.push(
          "",
          row("Extra-sum-of-squares F", n(result.fTest.f, 4)),
          row("df", `${result.fTest.dfNumerator}, ${result.fTest.dfDenominator}`),
          row("p", formatP(result.fTest.pValue)),
          row("F-test preferred", result.fTest.preferredLabel),
        );
      } else {
        lines.push("", row("F test", "not nested, AICc only"));
      }
      lines.push(row("Points (n)", n(result.n, 0)));
      break;
    }
    case "globalFit": {
      const conc = (x: number): string =>
        !Number.isFinite(x)
          ? ""
          : Math.abs(x) !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4)
            ? x.toExponential(4)
            : Number(x.toPrecision(5)).toString();
      const concCi = (c: [number, number]): string =>
        !Number.isFinite(c[0]) || !Number.isFinite(c[1])
          ? ""
          : `${conc(c[0])} to ${conc(c[1])}`;
      lines.push(row("Model", result.modelLabel));
      // Shared parameters (one global value each).
      lines.push("", row("Shared parameter", "Value", "95% CI"));
      for (const p of result.sharedParams) {
        lines.push(row(p.name, n(p.value, 4), ci(p.ci95)));
      }
      // Local EC50 per curve.
      lines.push("", row("Curve", "EC50 / IC50", "95% CI of EC50"));
      for (const lp of result.localParams) {
        lines.push(
          row(lp.datasetLabel, conc(lp.ec50), concCi(lp.ec50CI95)),
        );
      }
      lines.push(
        "",
        row("Global R-squared", n(result.rSquared, 6)),
        row("Total residual SS", n(result.ssrTotal, 4)),
        row("Datasets", n(result.nDatasets, 0)),
        row("Total points", n(result.nTotal, 0)),
        row("Total parameters", n(result.nParams, 0)),
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
