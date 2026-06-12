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
  NormalizedRmAnova,
  NormalizedMixedModel,
  NormalizedCorrelation,
  NormalizedDoseResponse,
  NormalizedGlobalFit,
  NormalizedLogisticRegression,
  NormalizedMultipleRegression,
  NormalizedModelComparison,
  NormalizedRegression,
  NormalizedResult,
  NormalizedSurvival,
  NormalizedCoxRegression,
  NormalizedGrubbsOutlier,
  NormalizedTTest,
  NormalizedTwoWayAnova,
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

function rmAnovaSummary(r: NormalizedRmAnova): string {
  const names = r.groups.map((g) => g.name);
  const list =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const stat = `repeated-measures ANOVA, F(${r.dfConditions}, ${r.dfError}) = ${num(
    r.statistic,
  )}, ${formatP(r.pValue)}`;
  // The Greenhouse-Geisser p is the conservative sphericity-corrected reading; we
  // report it alongside so a sphericity violation does not silently change the
  // verdict. eta-p2 is the partial eta-squared share of variance.
  const corrected = `partial eta-squared = ${num(
    r.partialEtaSquared,
    2,
  )}, Greenhouse-Geisser ${formatP(r.pGreenhouseGeisser)}`;

  if (r.pValue < ALPHA) {
    return `At least one of ${list} differs across the ${r.conditions} conditions measured on the same ${r.subjects} subjects (${stat}; ${corrected}).`;
  }
  return `${list} look the same across the ${r.conditions} conditions (${stat}; ${corrected}). There is not enough evidence of a condition effect.`;
}

function mixedModelSummary(r: NormalizedMixedModel): string {
  const reference = r.conditionLabels[0];
  // The non-reference fixed effects (everything past the intercept) are the
  // condition contrasts. Report the strongest one as the headline.
  const contrasts = r.fixedEffects.slice(1);
  const head = `random-intercept linear mixed model on ${r.observations} observations from ${r.subjects} subjects, fit by REML`;
  if (contrasts.length === 0) {
    return `A ${head}. No condition contrasts were estimated.`;
  }
  const significant = contrasts.filter((c) => c.pValue < ALPHA);
  if (significant.length === 0) {
    return `None of the conditions differ from the reference (${reference}) once each subject's own baseline is accounted for (${head}). There is not enough evidence of a condition effect.`;
  }
  const strongest = significant.reduce((best, c) =>
    Math.abs(c.z) > Math.abs(best.z) ? c : best,
  );
  const direction = strongest.estimate >= 0 ? "higher" : "lower";
  return `${strongest.name} is ${num(
    Math.abs(strongest.estimate),
    2,
  )} ${direction} than the reference (${reference}) on average, holding each subject's baseline fixed (z = ${num(
    strongest.z,
    2,
  )}, ${formatP(strongest.pValue)}; ${head}).`;
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

function logisticRegressionSummary(r: NormalizedLogisticRegression): string {
  const sig = r.slope.pValue < ALPHA;
  const dir = r.slope.estimate >= 0 ? "raises" : "lowers";
  const orPart =
    Number.isFinite(r.oddsRatioCI95[0]) && Number.isFinite(r.oddsRatioCI95[1])
      ? ` (95% CI ${num(r.oddsRatioCI95[0], 2)} to ${num(r.oddsRatioCI95[1], 2)})`
      : "";
  const stat = `odds ratio ${num(r.oddsRatio, 2)}${orPart}, ${formatP(
    r.slope.pValue,
  )}`;
  const lead = sig
    ? `Each one-unit rise in ${r.xName} ${dir} the odds of ${r.yName} (${stat}).`
    : `${r.xName} shows no clear effect on the odds of ${r.yName} (${stat}).`;
  const half = Number.isFinite(r.xAtHalf)
    ? ` The model crosses an even 50/50 chance at a ${r.xName} of about ${num(
        r.xAtHalf,
        2,
      )}.`
    : "";
  return `${lead}${half} McFadden pseudo-R-squared is ${num(
    r.mcFaddenR2,
    3,
  )} (n = ${r.n}).`;
}

function multipleRegressionSummary(r: NormalizedMultipleRegression): string {
  const k = r.nPredictors;
  const fitWord =
    r.rSquared >= 0.9
      ? "explains most of the variation in"
      : r.rSquared >= 0.5
        ? "explains a moderate share of the variation in"
        : "explains only a small share of the variation in";
  const overall =
    r.fPValue < ALPHA
      ? `The model as a whole is significant (F(${r.fDfNum}, ${r.fDfDen}) = ${num(
          r.fStatistic,
          2,
        )}, ${formatP(r.fPValue)}).`
      : `The model as a whole is not significant (F(${r.fDfNum}, ${r.fDfDen}) = ${num(
          r.fStatistic,
          2,
        )}, ${formatP(r.fPValue)}).`;
  // Name the predictors that carry their own weight (a significant slope).
  const sigSlopes = r.slopes.filter((s) => s.pValue < ALPHA).map((s) => s.name);
  const slopeWord =
    sigSlopes.length === 0
      ? "No single predictor stands out once the others are held constant."
      : sigSlopes.length === r.slopes.length
        ? "Each predictor contributes once the others are held constant."
        : `${sigSlopes.join(" and ")} contribute${
            sigSlopes.length === 1 ? "s" : ""
          } once the other predictors are held constant.`;
  return `The ${k} predictors together ${fitWord} ${r.yName} (R-squared ${num(
    r.rSquared,
    3,
  )}, adjusted ${num(r.adjRSquared, 3)}, n = ${r.n}). ${overall} ${slopeWord}`;
}

/** A concentration for inline prose (scientific notation for tiny/large doses). */
function concText(x: number): string {
  if (!Number.isFinite(x)) return "n/a";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return x.toExponential(2);
  return Number(x.toPrecision(3)).toString();
}

function doseResponseSummary(r: NormalizedDoseResponse): string {
  const modelWord = r.model === "logistic5pl" ? "5PL (asymmetric)" : "4PL";
  const ciPart =
    Number.isFinite(r.ec50CI95[0]) && Number.isFinite(r.ec50CI95[1])
      ? ` (95% CI ${concText(r.ec50CI95[0])} to ${concText(r.ec50CI95[1])})`
      : "";
  const fitWord =
    r.rSquared >= 0.98
      ? "fits the data closely"
      : r.rSquared >= 0.9
        ? "fits the data reasonably well"
        : "fits the data only loosely, so read the EC50 with caution";
  return `The half-maximal response (EC50) is at a ${r.xName} of about ${concText(
    r.ec50,
  )}${ciPart}, with a Hill slope of ${num(
    r.hillSlope.value,
    2,
  )}. The ${modelWord} curve runs from a bottom plateau of ${num(
    r.bottom.value,
    2,
  )} to a top of ${num(r.top.value, 2)} and ${fitWord} (R-squared = ${num(
    r.rSquared,
    3,
  )}, n = ${r.n}).`;
}

function modelComparisonSummary(r: NormalizedModelComparison): string {
  const pref = r.aicc.preferredLabel;
  // Lead with the AICc verdict since it is always defined. The evidence ratio
  // turns the delta into "how many times more likely", which reads plainly.
  const ratio = r.aicc.evidenceRatio;
  const ratioPart =
    Number.isFinite(ratio) && ratio >= 1.5
      ? ` and is about ${num(ratio, ratio >= 100 ? 0 : 1)} times more likely to be the better description (AICc lower by ${num(
          r.aicc.deltaAbs,
          1,
        )})`
      : ` (AICc lower by ${num(r.aicc.deltaAbs, 1)})`;
  const closeCall =
    Number.isFinite(ratio) && ratio < 1.5
      ? " The two are close, so the data do not strongly favor either model."
      : "";
  let fPart = "";
  if (r.fTest) {
    const stat = `F(${r.fTest.dfNumerator}, ${r.fTest.dfDenominator}) = ${num(
      r.fTest.f,
      2,
    )}, ${formatP(r.fTest.pValue)}`;
    fPart =
      r.fTest.pValue < ALPHA
        ? ` The extra-sum-of-squares F test agrees the added complexity is justified (${stat}), preferring ${r.fTest.preferredLabel}.`
        : ` The extra-sum-of-squares F test finds the added complexity is not justified (${stat}), so it keeps the simpler ${r.fTest.preferredLabel}.`;
  } else {
    fPart =
      " The models are not nested, so only the AICc comparison applies (no F test).";
  }
  return `By AICc the data prefer ${pref}${ratioPart}.${closeCall}${fPart}`;
}

function globalFitSummary(r: NormalizedGlobalFit): string {
  const modelWord = r.model === "logistic5pl" ? "5PL (asymmetric)" : "4PL";
  // Lead with the comparison of per-curve EC50s, the reason to fit globally.
  const ec50Part = r.localParams
    .map((lp) => `${lp.datasetLabel} ${concText(lp.ec50)}`)
    .join(", ");
  const sharedList = r.sharedParams.map((p) => p.name).join(", ");
  const fitWord =
    r.rSquared >= 0.98
      ? "fits the curves closely"
      : r.rSquared >= 0.9
        ? "fits the curves reasonably well"
        : "fits the curves only loosely, so read the EC50s with caution";
  return `Fitting one ${modelWord} shape to all ${r.nDatasets} curves at once with ${sharedList} shared, each curve keeps its own EC50: ${ec50Part}. The global fit ${fitWord} (R-squared = ${num(
    r.rSquared,
    3,
  )} across ${r.nTotal} points, ${r.nParams} parameters). Because every curve is held to the same shape, these EC50s are directly comparable.`;
}

function twoWaySummary(r: NormalizedTwoWayAnova): string {
  const effect = (name: string, f: number, p: number, dfText: string): string => {
    const stat = `F${dfText} = ${num(f)}, ${formatP(p)}`;
    return p < ALPHA
      ? `${name} has a real effect (${stat})`
      : `${name} shows no clear effect (${stat})`;
  };
  // The df text is read off the table rows for the methods-style F(df1, df2).
  const within = r.table.find((row) => row.source.startsWith("Within"));
  const dfW = within?.df ?? NaN;
  const dfOf = (source: string) =>
    `(${r.table.find((row) => row.source === source)?.df ?? "?"}, ${dfW})`;

  const a = effect(r.factorAName, r.fA, r.pA, dfOf("Factor A"));
  const b = effect(`the ${r.factorBName.toLowerCase()} factor`, r.fB, r.pB, dfOf("Factor B"));
  const interactionReal = r.pInteraction < ALPHA;
  const inter = interactionReal
    ? `The two factors interact (${`F${dfOf(
        "Interaction",
      )} = ${num(r.fInteraction)}, ${formatP(r.pInteraction)}`}), so the effect of one depends on the level of the other. Read the main effects with that in mind.`
    : `There is no significant interaction (${`F${dfOf(
        "Interaction",
      )} = ${num(r.fInteraction)}, ${formatP(r.pInteraction)}`}), so the two factors act independently here.`;
  return `${a}, and ${b}. ${inter}`;
}

function medianText(m: number | null): string {
  return m === null ? "not reached" : num(m, 1);
}

function survivalSummary(r: NormalizedSurvival): string {
  const medianPart = r.groups
    .map((g) => `${g.name} ${medianText(g.median)}`)
    .join(", ");
  const lead =
    r.groups.length === 1
      ? `The median survival is ${medianText(r.groups[0].median)} (${
          r.groups[0].events
        } events in ${r.groups[0].n} subjects).`
      : `Median survival by group: ${medianPart}.`;
  if (!r.logRank) {
    return `${lead} Add a Group label to compare arms with a log-rank test.`;
  }
  const stat = `log-rank chi-square(${r.logRank.df}) = ${num(
    r.logRank.chiSquare,
    2,
  )}, ${formatP(r.logRank.pValue)}`;
  const gbwPart = r.gehanBreslowWilcoxon
    ? ` The Gehan-Breslow-Wilcoxon test, which weights early time points more, gives chi-square(${r.gehanBreslowWilcoxon.df}) = ${num(
        r.gehanBreslowWilcoxon.chiSquare,
        2,
      )}, ${formatP(r.gehanBreslowWilcoxon.pValue)}.`
    : "";
  if (r.logRank.pValue < ALPHA) {
    return `${lead} The survival curves differ between groups (${stat}), so the event happens at a different rate across arms.${gbwPart}`;
  }
  return `${lead} The survival curves are statistically indistinguishable (${stat}). There is not enough evidence that the arms differ.${gbwPart}`;
}

function coxSummary(r: NormalizedCoxRegression): string {
  const arm = r.coefficients[0];
  if (!arm) {
    return "Cox regression needs a comparison arm to estimate a hazard ratio.";
  }
  const hr = num(arm.hazardRatio, 2);
  const ci = `95% CI ${num(arm.hrCiLow, 2)} to ${num(arm.hrCiHigh, 2)}`;
  const direction =
    arm.hazardRatio < 1
      ? "a lower hazard"
      : arm.hazardRatio > 1
        ? "a higher hazard"
        : "the same hazard";
  const lead = `The hazard ratio for ${arm.name} is ${hr} (${ci}), ${direction} than the reference arm.`;
  if (arm.pValue < ALPHA) {
    return `${lead} The difference is significant (${formatP(arm.pValue)}), and the model orders ${num(
      r.concordance,
      2,
    )} of comparable subject pairs correctly.`;
  }
  return `${lead} There is not enough evidence that the hazards differ (${formatP(
    arm.pValue,
  )}).`;
}

function grubbsSummary(r: NormalizedGrubbsOutlier): string {
  const sweep = r.iterative ? "iterative" : "single-point";
  if (r.totalOutliers === 0) {
    if (r.columns.length === 1) {
      return `No outliers were flagged in ${r.columns[0].name} by the ${sweep} Grubbs test at alpha ${num(
        r.alpha,
        2,
      )}. Every value is within the range chance would produce for a sample this size.`;
    }
    return `No outliers were flagged across the ${r.columns.length} screened columns by the ${sweep} Grubbs test at alpha ${num(
      r.alpha,
      2,
    )}. Every value is within the range chance would produce for a sample this size.`;
  }
  // Name the flagged values per column so the verdict points at the offending
  // points, not just a count.
  const flaggedCols = r.columns.filter((c) => c.result.outlierValues.length > 0);
  const detail = flaggedCols
    .map(
      (c) =>
        `${c.name} (${c.result.outlierValues.map((v) => num(v, 2)).join(", ")})`,
    )
    .join("; ");
  const noun = r.totalOutliers === 1 ? "outlier" : "outliers";
  return `The ${sweep} Grubbs test flagged ${r.totalOutliers} ${noun} at alpha ${num(
    r.alpha,
    2,
  )}, in ${detail}. A flagged value is a candidate for review, not an automatic deletion, so confirm it against the experiment before removing it.`;
}

/**
 * The one-sentence (or two-sentence) plain-language verdict for a normalized
 * result. The ResultsSheet renders this above the stats table.
 */
export function plainLanguageSummary(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaSummary(result);
  if (result.kind === "rmAnova") return rmAnovaSummary(result);
  if (result.kind === "mixedModel") return mixedModelSummary(result);
  if (result.kind === "correlation") return correlationSummary(result);
  if (result.kind === "regression") return regressionSummary(result);
  if (result.kind === "logisticRegression")
    return logisticRegressionSummary(result);
  if (result.kind === "multipleRegression")
    return multipleRegressionSummary(result);
  if (result.kind === "doseResponse") return doseResponseSummary(result);
  if (result.kind === "modelComparison") return modelComparisonSummary(result);
  if (result.kind === "globalFit") return globalFitSummary(result);
  if (result.kind === "twoWayAnova") return twoWaySummary(result);
  if (result.kind === "survival") return survivalSummary(result);
  if (result.kind === "coxRegression") return coxSummary(result);
  if (result.kind === "grubbsOutlier") return grubbsSummary(result);
  return ttestSummary(result);
}
