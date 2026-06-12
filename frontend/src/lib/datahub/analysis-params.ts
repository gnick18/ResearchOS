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
  twoWayAnova: [TWOWAY_POSTHOC_FIELD],
  correlationPearson: [],
  correlationSpearman: [],
  linearRegression: [],
  kaplanMeier: [],
};

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
