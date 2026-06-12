// Data Hub statistics + curve-fitting engine: the single public entry point.
// Pure, browser-safe, no I/O. A free open-source GraphPad Prism style analysis
// core. UI / data-model / routing live elsewhere and consume only this surface.

export * from "./types";

// Distributions (shared p-value / critical-value backend).
export * as dists from "./dists";

// Descriptive statistics.
export { describe } from "./descriptive";

// Two-group tests.
export {
  unpairedTTest,
  unpairedTTestFromStats,
  pairedTTest,
  mannWhitneyU,
  wilcoxonSignedRank,
  type UnpairedOptions,
  type UnpairedFromStatsInput,
} from "./ttests";

// ANOVA family + nonparametric counterparts.
export {
  oneWayAnova,
  oneWayAnovaFromStats,
  twoWayAnova,
  kruskalWallis,
  friedman,
  type PostHocMethod,
  type OneWayOptions,
  type TwoWayOptions,
  type TwoWayCell,
  type GroupSummaryStat,
} from "./anova";

// Correlation.
export { pearson, spearman } from "./correlation";

// Linear regression.
export { linearRegression } from "./regression-linear";

// Binary logistic regression (IRLS / Newton-Raphson MLE).
export {
  logisticRegression,
  type LogisticRegressionResult,
  type LogisticCoefficient,
} from "./regression-logistic";

// Multiple (OLS) linear regression via the normal equations.
export {
  multipleRegression,
  type MultipleRegressionResult,
  type MultipleRegressionCoefficient,
} from "./regression-multiple";

// Assumption checks (normality + equal variance).
export { shapiroWilk, levene, brownForsythe } from "./assumptions";

// Survival analysis (Kaplan-Meier + log-rank).
export {
  kaplanMeier,
  logRank,
  gehanBreslowWilcoxon,
  coxPH,
  type SurvivalObservation,
  type KaplanMeierStep,
  type KaplanMeierResult,
  type LogRankGroup,
  type LogRankResult,
  type GehanBreslowWilcoxonGroup,
  type GehanBreslowWilcoxonResult,
  type CoxObservation,
  type CoxCoefficient,
  type CoxResult,
} from "./survival";

// Nonlinear curve fitting (the crown jewel).
export {
  fitModel,
  fitGlobal,
  getModel,
  listModels,
  fivePLLogEC50Shift,
  MODELS,
  aicc,
  aiccCompare,
  extraSumOfSquaresF,
  type FitOptions,
  type GlobalDataset,
  type GlobalFitOptions,
  type GlobalFitParameter,
  type GlobalFitResult,
  type NonlinearModel,
  type ModelFitSummary,
  type FTestComparison,
  type AiccComparison,
  type AiccModelLine,
} from "./fit";

// Bootstrap / resampling confidence intervals (distribution-free, the robust
// fallback when normality is shaky). Generic primitive plus ready statistic
// helpers; estimation plots consume the same surface.
export {
  bootstrapCI,
  bootstrapDiffCI,
  percentileInterval,
  biasCorrection,
  jackknifeAcceleration,
  mulberry32,
  sampleMean,
  sampleMedian,
  meanDifference,
  medianDifference,
  ratioOfMeans,
  type BootstrapMethod,
  type BootstrapOptions,
  type BootstrapResult,
} from "./bootstrap";

// Power and sample-size planning (a study-design calculator, not stored data).
export {
  powerTwoSampleT,
  sampleSizeTwoSampleT,
  detectableDTwoSampleT,
  powerPairedT,
  sampleSizePairedT,
  detectableDzPairedT,
  powerOneWayAnova,
  sampleSizeOneWayAnova,
  detectableFOneWayAnova,
  cohenFFromEtaSquared,
  etaSquaredFromCohenF,
  powerCorrelation,
  sampleSizeCorrelation,
  detectableRCorrelation,
} from "./power";
