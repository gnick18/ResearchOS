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

// Assumption checks (normality + equal variance).
export { shapiroWilk, levene, brownForsythe } from "./assumptions";

// Survival analysis (Kaplan-Meier + log-rank).
export {
  kaplanMeier,
  logRank,
  type SurvivalObservation,
  type KaplanMeierStep,
  type KaplanMeierResult,
  type LogRankGroup,
  type LogRankResult,
} from "./survival";

// Nonlinear curve fitting (the crown jewel).
export {
  fitModel,
  getModel,
  listModels,
  MODELS,
  type FitOptions,
  type NonlinearModel,
} from "./fit";

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
