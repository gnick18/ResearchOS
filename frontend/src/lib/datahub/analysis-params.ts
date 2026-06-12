// analysis-params.ts
//
// The editable-parameter schema for Data Hub analyses. Today a result is
// read-only once it is run, so a researcher who wants a one-sided t-test or a
// Student (pooled-variance) test has to delete and re-pick. This file describes,
// per analysis type, exactly which options the ALREADY-VALIDATED engine can act
// on, so the results panel can render real controls and the run layer can pass
// them straight into the engine option objects.
//
// Grounding rule: every option here maps to a parameter the engine actually
// computes. We do NOT expose a control the math layer ignores (correlation and
// linear regression take no options, so they have empty schemas; correlation is
// two-sided only and regression reports a fixed 95 percent interval). Every new
// selectable value is also pinned against scipy in the validation gate, per the
// standing rule that every option a user can pick is validated.
//
// Defaults are chosen so an analysis with an empty params bag (every analysis
// made before this feature, and every fresh one) reproduces the exact behavior
// run-analysis used before, byte for byte. defaultParams + readParams are the
// single source of truth the run layer reads, so the hardcoded engine options
// in run-analysis are replaced by a schema lookup rather than scattered literals.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { AnalysisSpec } from "@/lib/datahub/model/types";

/** The control surface a single parameter renders as. */
export type ParamControl = "seg" | "select";

/** One allowed value for a seg / select control, with its display label. */
export interface ParamOption {
  value: string;
  label: string;
}

/**
 * One editable parameter. `key` is the storage key inside spec.params; the
 * stored value is always one of `options[].value`. `why` is a short reason shown
 * under the control so the choice reads as a real statistical decision, not a
 * mystery toggle.
 */
export interface ParamField {
  key: string;
  label: string;
  control: ParamControl;
  options: ParamOption[];
  default: string;
  /** A one-line reason the option exists (states the why for the user). */
  why: string;
}

/** Tail control, shared by the tests whose engine accepts an `alternative`. */
const TAIL_FIELD: ParamField = {
  key: "tail",
  label: "Tail",
  control: "seg",
  options: [
    { value: "two-sided", label: "Two-sided" },
    { value: "greater", label: "One-sided (greater)" },
    { value: "less", label: "One-sided (less)" },
  ],
  default: "two-sided",
  why: "Two-sided asks whether the groups differ at all. A one-sided test asks only about a difference in the direction you predicted in advance, and is more sensitive when that prediction is sound.",
};

/** Variance assumption for the unpaired t-test. */
const VARIANCE_FIELD: ParamField = {
  key: "variance",
  label: "Variance",
  control: "seg",
  options: [
    { value: "welch", label: "Welch (unequal)" },
    { value: "student", label: "Student (pooled)" },
  ],
  default: "welch",
  why: "Welch does not assume the two groups have the same spread and is the safer default. Student pools the variances, which is only appropriate when the spreads are genuinely equal.",
};

/** Post-hoc family for one-way ANOVA. Only the families the engine computes. */
const ONEWAY_POSTHOC_FIELD: ParamField = {
  key: "postHoc",
  label: "Post-hoc",
  control: "select",
  options: [
    { value: "tukey", label: "Tukey HSD" },
    { value: "sidak", label: "Sidak" },
    { value: "bonferroni", label: "Bonferroni" },
    { value: "holm-sidak", label: "Holm-Sidak" },
    { value: "none", label: "None" },
  ],
  default: "tukey",
  why: "The omnibus ANOVA only says the groups are not all equal. A post-hoc family says which pairs differ while holding the overall false-positive rate at 0.05. None skips the pairwise comparisons.",
};

/**
 * Post-hoc factor for two-way ANOVA. The engine runs Tukey on the marginal
 * means of factor A or factor B, or skips comparisons entirely. Dunnett is NOT
 * offered here because the engine only does Tukey on the two-way marginals.
 */
const TWOWAY_POSTHOC_FIELD: ParamField = {
  key: "postHocFactor",
  label: "Compare levels of",
  control: "select",
  options: [
    { value: "B", label: "Group (factor B)" },
    { value: "A", label: "Row factor (factor A)" },
    { value: "none", label: "None" },
  ],
  default: "B",
  why: "Tukey post-hoc compares the marginal means of one factor. Pick which factor's levels you want pairwise comparisons for, or None to show the ANOVA table alone.",
};

/**
 * Curve model for the dose-response analysis. The 4PL is the symmetric default a
 * pharmacologist reaches for first; the 5PL adds an asymmetry exponent for curves
 * that approach their top and bottom plateaus at different rates. Both fit the same
 * EC50 / Hill / Top / Bottom readouts, validated against scipy.optimize.curve_fit.
 */
const DOSE_RESPONSE_MODEL_FIELD: ParamField = {
  key: "model",
  label: "Curve model",
  control: "seg",
  options: [
    { value: "logistic4pl", label: "4PL (symmetric)" },
    { value: "logistic5pl", label: "5PL (asymmetric)" },
  ],
  default: "logistic4pl",
  why: "The 4-parameter logistic assumes the curve is symmetric about its midpoint and is the standard dose-response fit. The 5-parameter logistic adds an asymmetry term for curves that bend toward one plateau faster than the other, at the cost of one more parameter to estimate.",
};

/**
 * The two model picks plus the nested flag for the model-comparison analysis.
 * Both pickers list the same fittable curve models; the run layer orders them by
 * parameter count so the F test always treats the simpler model as the baseline.
 * The model ids must match the engine's MODELS registry exactly.
 */
const MODEL_OPTIONS: ParamOption[] = [
  { value: "logistic4pl", label: "4PL logistic (variable slope)" },
  { value: "logistic5pl", label: "5PL logistic (asymmetric)" },
  { value: "michaelis-menten", label: "Michaelis-Menten" },
  { value: "exp-decay-1phase", label: "One-phase exponential decay" },
  { value: "exp-association-1phase", label: "One-phase exponential association" },
  { value: "linear", label: "Linear" },
  { value: "polynomial2", label: "Quadratic polynomial" },
  { value: "gaussian", label: "Gaussian" },
];

const COMPARE_MODEL_A_FIELD: ParamField = {
  key: "modelA",
  label: "First model",
  control: "select",
  options: MODEL_OPTIONS,
  default: "logistic4pl",
  why: "The two models are fit to the same data and ranked. Their parameter count decides which one the F test treats as the simpler baseline, so pick order does not matter.",
};

const COMPARE_MODEL_B_FIELD: ParamField = {
  key: "modelB",
  label: "Second model",
  control: "select",
  options: MODEL_OPTIONS,
  default: "logistic5pl",
  why: "Compared against the first model. The lower-AICc model is preferred, and for a nested pair the F test says whether the extra parameters earn their keep.",
};

const COMPARE_NESTED_FIELD: ParamField = {
  key: "nested",
  label: "Models nested",
  control: "seg",
  options: [
    { value: "yes", label: "Nested" },
    { value: "no", label: "Not nested" },
  ],
  default: "yes",
  why: "The extra-sum-of-squares F test only applies when the simpler model is a special case of the complex one (for example a 4PL is the 5PL with the asymmetry fixed at 1). AICc works either way, so a not-nested pair still gets an AICc verdict.",
};

/**
 * Curve model for the global (shared-parameter) fit. Scoped to the dose-response
 * family, the case global fitting is built for. The 4PL is the symmetric default;
 * the 5PL adds the asymmetry exponent. Both share / localize the same way.
 */
const GLOBAL_FIT_MODEL_FIELD: ParamField = {
  key: "model",
  label: "Curve model",
  control: "seg",
  options: [
    { value: "logistic4pl", label: "4PL (symmetric)" },
    { value: "logistic5pl", label: "5PL (asymmetric)" },
  ],
  default: "logistic4pl",
  why: "Global fitting holds one curve shape across every dataset. The 4-parameter logistic is the symmetric standard; the 5-parameter logistic adds an asymmetry term for curves that bend toward one plateau faster than the other.",
};

/**
 * Which parameters are SHARED across all datasets in the global fit. Every other
 * parameter is fit LOCAL (one value per dataset). The default shares the Hill
 * slope and both plateaus and keeps the EC50 local, the standard pharmacology
 * choice that lets you compare EC50s with all curves held to a common shape. The
 * stored value is a preset; the run layer expands it to the explicit shared list.
 */
const GLOBAL_FIT_SHARE_FIELD: ParamField = {
  key: "share",
  label: "Shared parameters",
  control: "select",
  options: [
    { value: "hill-top-bottom", label: "Hill, Top, Bottom (EC50 local)" },
    { value: "hill", label: "Hill only (Top, Bottom, EC50 local)" },
    { value: "top-bottom", label: "Top, Bottom (Hill, EC50 local)" },
    { value: "all-but-ec50", label: "Everything except EC50" },
  ],
  default: "hill-top-bottom",
  why: "A shared parameter is fit to one value across every curve; a local parameter is fit separately per curve. Sharing the Hill slope and the plateaus while keeping the EC50 local is the standard way to compare potencies with all curves constrained to a common shape. The asymmetry term of the 5PL is always shared.",
};

/**
 * The schema per analysis type. An empty array means the engine takes no
 * editable options for that analysis (correlation, regression). The order here
 * is the order the controls render in the panel.
 */
export const ANALYSIS_PARAM_SCHEMA: Record<string, ParamField[]> = {
  unpairedTTest: [TAIL_FIELD, VARIANCE_FIELD],
  pairedTTest: [TAIL_FIELD],
  mannWhitneyU: [TAIL_FIELD],
  wilcoxonSignedRank: [TAIL_FIELD],
  oneWayAnova: [ONEWAY_POSTHOC_FIELD],
  kruskalWallis: [],
  repeatedMeasuresAnova: [],
  twoWayAnova: [TWOWAY_POSTHOC_FIELD],
  correlationPearson: [],
  correlationSpearman: [],
  linearRegression: [],
  logisticRegression: [],
  doseResponse: [DOSE_RESPONSE_MODEL_FIELD],
  modelComparison: [
    COMPARE_MODEL_A_FIELD,
    COMPARE_MODEL_B_FIELD,
    COMPARE_NESTED_FIELD,
  ],
  kaplanMeier: [],
  coxRegression: [],
  multipleRegression: [],
  globalFit: [GLOBAL_FIT_MODEL_FIELD, GLOBAL_FIT_SHARE_FIELD],
};

/**
 * Expand a global-fit `share` preset into the explicit list of model parameter
 * names fit as SHARED. The names match the dose-response models' paramNames
 * (Bottom, Top, logEC50, HillSlope, and S for the 5PL). logEC50 is never shared
 * (the EC50 is the per-curve readout the analysis exists to compare), and the
 * 5PL asymmetry exponent S is always shared so the shape is common. An unknown
 * preset falls back to the pharmacology default.
 */
export function globalFitSharedNames(share: string): string[] {
  switch (share) {
    case "hill":
      return ["HillSlope", "S"];
    case "top-bottom":
      return ["Top", "Bottom", "S"];
    case "all-but-ec50":
      return ["Bottom", "Top", "HillSlope", "S"];
    case "hill-top-bottom":
    default:
      return ["HillSlope", "Top", "Bottom", "S"];
  }
}

/** The schema for one analysis type (empty if the type takes no options). */
export function paramSchema(type: string): ParamField[] {
  return ANALYSIS_PARAM_SCHEMA[type] ?? [];
}

/** True when this analysis type exposes at least one editable parameter. */
export function hasEditableParams(type: string): boolean {
  return paramSchema(type).length > 0;
}

/**
 * The default params bag for an analysis type, built from the schema defaults.
 * An analysis run with these values is identical to the pre-feature behavior.
 */
export function defaultParams(type: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of paramSchema(type)) out[field.key] = field.default;
  return out;
}

/**
 * Read the resolved params for a spec. Merges any stored spec.params over the
 * schema defaults and drops any stored value that is not an allowed option (a
 * defensive guard so a corrupt or stale bag can never feed the engine an option
 * it cannot honor). The result is a complete, valid bag for every schema key.
 */
export function readParams(spec: AnalysisSpec): Record<string, string> {
  const fields = paramSchema(spec.type);
  const stored = (spec.params ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const raw = stored[field.key];
    const valid =
      typeof raw === "string" && field.options.some((o) => o.value === raw);
    out[field.key] = valid ? (raw as string) : field.default;
  }
  return out;
}

/**
 * Validate and coerce a single param edit against the schema before it is
 * stored. Returns the value when it is an allowed option for that key on that
 * type, or null when it is not (so the caller can ignore an out-of-schema edit).
 */
export function coerceParam(
  type: string,
  key: string,
  value: string,
): string | null {
  const field = paramSchema(type).find((f) => f.key === key);
  if (!field) return null;
  return field.options.some((o) => o.value === value) ? value : null;
}
