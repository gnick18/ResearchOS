// Deterministic tree-recipe comparison for BeakerBot (BeakerAI lane, 2026-06-14).
//
// The reproduce-from-PDF "light comparison" carve-out: lay the paper's
// tree-building recipe next to the user's, as a FACTUAL side-by-side. This is the
// ONE scoped loosening of the no-interpretation rule Grant signed off for this flow
// (2026-06-12): BeakerBot may state that the two recipes DIFFER (tools, models,
// parameters, replicate counts, rooting) but NEVER which is better, never "your
// bootstrap is low", never "you should switch". Descriptive, not prescriptive.
//
// Why it is safe to allow: the diff is computed HERE, deterministically, from two
// resolved BuilderOptions. The model only reads the rows off; it cannot rank them
// because this produces no ranking, only same/different facts. The comparison
// rides UI-only under the shared _ui key so it renders as a fixed inline widget
// (the tool's exact values, never reformatted by the model) and is stripped before
// the model sees the result.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { BuilderOptions } from "@/lib/phylo/catalog";

/** One row of the side-by-side: a recipe step and each side's value, with whether
 *  they match. Values are plain strings the widget renders verbatim. */
export type RecipeCompareRow = {
  label: string;
  paper: string;
  mine: string;
  same: boolean;
};

/** Format the replicate count for a side, which depends on the support type. */
function replicatesOf(o: BuilderOptions): string {
  if (o.support === "ufboot") return `${o.ufbootReps} (ultrafast bootstrap)`;
  if (o.support === "bootstrap") return `${o.bsReps} (standard bootstrap)`;
  return "none";
}

/** Format the substitution model for a side (a fixed model string, or the
 *  ModelFinder selection). */
function modelOf(o: BuilderOptions): string {
  return o.model === "fixed" ? (o.fixedModel.trim() || "fixed") : "ModelFinder";
}

/** The recipe dimensions compared, in reading order. Each reads one labeled fact
 *  off a resolved BuilderOptions. Pure. */
const FIELDS: { label: string; get: (o: BuilderOptions) => string }[] = [
  { label: "Data type", get: (o) => o.dataType },
  { label: "Aligner", get: (o) => o.align },
  { label: "Trimming", get: (o) => o.trim },
  { label: "Substitution model", get: modelOf },
  { label: "Tree method", get: (o) => o.infer },
  { label: "Branch support", get: (o) => o.support },
  { label: "Replicates", get: replicatesOf },
  { label: "Rooting / outgroup", get: (o) => o.outgroup.trim() || "none" },
];

/** Build the factual side-by-side of two resolved recipes. Pure + deterministic,
 *  no judgment, only same/different facts. */
export function compareBuilderOptions(
  paper: BuilderOptions,
  mine: BuilderOptions,
): RecipeCompareRow[] {
  return FIELDS.map(({ label, get }) => {
    const p = get(paper);
    const m = get(mine);
    return { label, paper: p, mine: m, same: p === m };
  });
}

// ---------------------------------------------------------------------------
// Inline-widget _ui seam (mirrors overlay-wizard.ts / record-set.ts)
// ---------------------------------------------------------------------------

const UI_KEY = "_ui";

/** The comparison payload carried UI-only so it renders as a fixed inline card,
 *  the tool's exact values, never reformatted by the model. */
export type RecipeComparisonPayload = {
  widget: "recipeComparison";
  rows: RecipeCompareRow[];
  /** Column headers, e.g. "Paper" and "Your tree". */
  paperLabel: string;
  mineLabel: string;
};

export function withRecipeComparisonUi<T extends object>(
  result: T,
  payload: RecipeComparisonPayload,
): T & { _ui: RecipeComparisonPayload } {
  return { ...result, [UI_KEY]: payload } as T & { _ui: RecipeComparisonPayload };
}

export function recipeComparisonFromResult(
  result: unknown,
): RecipeComparisonPayload | null {
  if (result === null || typeof result !== "object") return null;
  const value = (result as Record<string, unknown>)[UI_KEY];
  if (value === null || typeof value !== "object") return null;
  const p = value as Partial<RecipeComparisonPayload>;
  if (p.widget !== "recipeComparison" || !Array.isArray(p.rows)) return null;
  return value as RecipeComparisonPayload;
}
