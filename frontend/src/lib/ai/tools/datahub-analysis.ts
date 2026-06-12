// BeakerBot Data Hub analysis tools (ai datahub-analysis bot, 2026-06-11;
// ai analysis-ux bot, 2026-06-11).
//
// BeakerBot's first DATA coworker pair. They let the assistant run a real
// statistical analysis on a Data Hub table from a natural-language request,
// through the SAME deterministic planner and reference-validated engine the
// guided wizard uses.
//
// The division of labor is the whole point. The LLM ORCHESTRATES, it maps the
// user's words ("the Control vs Drug columns", "compare these groups") onto a
// real table and real columns and a paired-or-not intent. The ENGINE COMPUTES,
// every statistic (the test choice's assumption checks, the p-value, the effect
// size) comes from lib/datahub, never from the model. The model only repeats the
// numbers the engine returned.
//
// Two tools.
//   - list_datahub_tables (READ-only): the user's Data Hub documents, each a
//     table, as a compact list so the model can pick the one the request means.
//   - run_datahub_analysis (NON-gated): run the analysis through the planner and
//     the engine, store the resulting AnalysisSpec in the table's Loro doc
//     (version-controlled), navigate the user to that stored result in the Data
//     Hub, and return a compact engine-computed result the model summarizes.
//
// Why run_datahub_analysis carries no `action` flag (ai analysis-ux bot). It
// writes, but the write is NON-destructive (a new, reversible, version-controlled
// AnalysisSpec, the wizard's exact write path, deleting nothing and sending nothing
// outward) AND the user already consented twice over, they asked for the analysis
// in words and picked the exact groups through ask_user. A separate "Allow it?" on
// top of that group pick was redundant friction a live test flagged, so the tool
// runs straight away like the perception tools, with no per-action approval gate.
// Its safety is the explicit request and the group pick, not a gate. The old
// describeAction / isDestructive approval path is gone with the gate.
//
// After storing, execute navigates the user to
// /datahub?doc=<tableId>&analysis=<analysisId> so they land on the test's RESULT
// sheet (not the raw data grid) and SEE the stored analysis rather than only reading
// a chat summary. The navigation is hard-wired here through the injectable navigate
// seam (default requestNavigation), not left to the model, so it is reliable.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { dataHubApi } from "@/lib/datahub/api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { openDataHubDoc, type DataHubDocHandle } from "@/lib/loro/datahub-store";
import {
  getDataHubContent,
  setAnalysis as setAnalysisInDoc,
} from "@/lib/loro/datahub-doc";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { groupColumns } from "@/lib/datahub/column-table";
import { isXYTable, yColumns } from "@/lib/datahub/xy-table";
import { getModel, listModels } from "@/lib/datahub/engine";
import { planAnalysis, type AnalysisIntent } from "@/lib/datahub/planner";
import {
  runAnalysis,
  type AnalysisType,
  type RunOutcome,
  type NormalizedModelComparison,
} from "@/lib/datahub/run-analysis";
import { plainLanguageSummary, formatP } from "@/lib/datahub/plain-language";
import { showCode } from "@/lib/datahub/show-code";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam (so the tools unit-test with no folder and no Loro).
// ---------------------------------------------------------------------------

/**
 * The data-layer reads the tools depend on, injected so a test can stub the
 * catalog list and the doc reads without a real folder. Production wires the
 * real api + store. resolveContent opens the doc and projects its content;
 * persistAnalysis opens the doc, writes the spec, and commits, mirroring the
 * page.tsx createAnalysis write path exactly (open -> setAnalysis -> commit).
 */
export type DataHubAnalysisDeps = {
  /** Current owner (defaults to the cached current user). */
  currentUser: () => Promise<string>;
  /** The Data Hub catalog list (metadata only). */
  listDocuments: () => Promise<DataHubDocument[]>;
  /** Project a table's live content by id (null when it cannot be opened). */
  resolveContent: (id: string) => Promise<DataHubDocContent | null>;
  /** Open the doc, write the spec, commit. Returns true on success. */
  persistAnalysis: (id: string, spec: AnalysisSpec) => Promise<boolean>;
  /** Take the user to a stored result by soft-navigating to an internal path.
   *  Defaults to the navigation bridge so the run lands the user on the Data Hub
   *  doc. Injected so a test asserts the navigation without a router. */
  navigate: (path: string) => void;
};

async function defaultResolveContent(
  id: string,
): Promise<DataHubDocContent | null> {
  try {
    const owner = await getCurrentUserCached();
    const handle = await openDataHubDoc(owner, id);
    return getDataHubContent(handle.doc, id);
  } catch {
    return null;
  }
}

async function defaultPersistAnalysis(
  id: string,
  spec: AnalysisSpec,
): Promise<boolean> {
  try {
    const owner = await getCurrentUserCached();
    const handle: DataHubDocHandle = await openDataHubDoc(owner, id);
    setAnalysisInDoc(handle.doc, spec);
    // Flush rather than the debounced commit so the write lands before the tool
    // returns (the model may immediately navigate the user to the stored result).
    await handle.flush();
    return true;
  } catch {
    return false;
  }
}

export const datahubAnalysisDeps: DataHubAnalysisDeps = {
  currentUser: getCurrentUserCached,
  listDocuments: () => dataHubApi.list(),
  resolveContent: defaultResolveContent,
  persistAnalysis: defaultPersistAnalysis,
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Content cache (bridges the sync describeAction to the async content read).
// ---------------------------------------------------------------------------

// The model must call list_datahub_tables before it knows a tableId, and that
// read already projects each table's content, so we cache it here. describeAction
// (which the loop requires to be synchronous) then runs the pure planner against
// the cached content with no await. execute always re-reads the live doc, so a
// stale cache never affects the STORED result, only the wording of the approval
// card (which the user reads and approves anyway).
const _contentCache = new Map<string, DataHubDocContent>();

/** Cache one table's content (used by list_datahub_tables and execute). */
export function cacheTableContent(id: string, content: DataHubDocContent): void {
  _contentCache.set(id, content);
}

/** Read a cached table content (used by the sync describeAction). */
export function getCachedTableContent(id: string): DataHubDocContent | null {
  return _contentCache.get(id) ?? null;
}

/** Test helper, clear the content cache between cases. */
export function _clearDataHubAnalysisCache(): void {
  _contentCache.clear();
}

// ---------------------------------------------------------------------------
// list_datahub_tables (READ-only)
// ---------------------------------------------------------------------------

/** The compact, model-friendly view of one Data Hub table. */
export type TableBrief = {
  id: string;
  name: string;
  table_type: string;
  /** The comparable group / Y column names, so the model can map a request to
   *  real columns (e.g. "the Control vs Drug columns"). */
  columns: string[];
  /** The non-empty replicate-row count, a cheap hint at how much data is there. */
  rows: number;
};

/** Shape one table's metadata + content into a compact brief. Pure. */
export function shapeTableBrief(
  meta: DataHubDocument,
  content: DataHubDocContent | null,
): TableBrief {
  const columns = content ? groupColumns(content).map((c) => c.name) : [];
  const rows = content ? content.rows.length : 0;
  return {
    id: meta.id,
    name: meta.name,
    table_type: meta.table_type,
    columns,
    rows,
  };
}

export const listDataHubTablesTool: AiTool = {
  name: "list_datahub_tables",
  description:
    "List the user's Data Hub tables (each Data Hub document is one table of columns and rows). Returns each table's id, name, table type, the names of its comparable group columns, and its row count. Call this FIRST whenever the user asks to run a statistical test, compare groups, or analyze Data Hub data, so you can map their words (for example \"the Control vs Drug columns\" or \"the qPCR table\") to a real table id and real column names before running anything. Returns an empty list when the user has no Data Hub tables. Read-only.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const docs = await datahubAnalysisDeps.listDocuments();
    const briefs: TableBrief[] = [];
    for (const meta of docs) {
      const content = await datahubAnalysisDeps.resolveContent(meta.id);
      if (content) cacheTableContent(meta.id, content);
      briefs.push(shapeTableBrief(meta, content));
    }
    return { count: briefs.length, tables: briefs };
  },
};

// ---------------------------------------------------------------------------
// run_datahub_analysis (ACTION) intent mapping
// ---------------------------------------------------------------------------

/** The model-supplied arguments, before mapping to a planner AnalysisIntent. */
export type RunAnalysisArgs = {
  tableId: string;
  /** The columns to compare, by name or id. Two for a t-test, three+ for ANOVA. */
  columns?: string[];
  /** Same subjects measured twice (paired) vs different subjects (independent). */
  paired?: boolean;
  /** Optional explicit test, or "auto" to let the planner pick (the default). */
  test?: AnalysisType | "auto";
};

/** Parse the loose tool args into a typed RunAnalysisArgs. */
export function parseRunAnalysisArgs(
  args: Record<string, unknown>,
): RunAnalysisArgs {
  const tableId = typeof args.tableId === "string" ? args.tableId : "";
  const columns = Array.isArray(args.columns)
    ? args.columns.filter((c): c is string => typeof c === "string")
    : undefined;
  const paired = args.paired === true;
  const test =
    typeof args.test === "string" ? (args.test as RunAnalysisArgs["test"]) : "auto";
  return { tableId, columns, paired, test };
}

/**
 * Resolve the model's column references (names OR ids, case-insensitive on name)
 * to real group-column ids in the table's declared order. Unknown references are
 * dropped. When the model passes no columns we default to every group column,
 * the same default the planner uses, so "compare the groups" just works.
 */
export function resolveColumnIds(
  content: DataHubDocContent,
  columns: string[] | undefined,
): string[] {
  const groups = groupColumns(content);
  if (!columns || columns.length === 0) return groups.map((c) => c.id);
  const byId = new Map(groups.map((c) => [c.id, c.id]));
  const byName = new Map(
    groups.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const out: string[] = [];
  for (const ref of columns) {
    const id = byId.get(ref) ?? byName.get(ref.trim().toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Map the model's request onto a planner AnalysisIntent. This slice runs MEANS
 * comparisons (Column tables, the t-test / ANOVA family plus their rank-based
 * fallbacks), which is where a natural-language "run a t-test / compare these
 * groups" request lands. The group count comes from how many columns resolved,
 * and pairing comes from the model's paired flag. The planner then chooses the
 * actual test and the assumption-aware fallback.
 */
export function buildIntent(
  content: DataHubDocContent,
  parsed: RunAnalysisArgs,
): { intent: AnalysisIntent; columnIds: string[] } | { error: string } {
  const columnIds = resolveColumnIds(content, parsed.columns);
  if (columnIds.length < 2) {
    return {
      error:
        "I need at least two group columns to compare. Tell me which columns to test (for example Control and Drug), or check the table has more than one group.",
    };
  }
  const intent: AnalysisIntent = {
    family: "means",
    groupCount: columnIds.length >= 3 ? "three-plus" : "two",
    pairing: parsed.paired ? "paired" : "independent",
    groupColumnIds: columnIds,
  };
  return { intent, columnIds };
}

// ---------------------------------------------------------------------------
// Proposal (the approval-card summary) and result summary
// ---------------------------------------------------------------------------

/** A short one-line assumption note pulled from the planner's Report Card, so the
 *  approval card states what was checked (for example "Normality OK, equal
 *  variance OK") without the full multi-line Report Card. Pure. */
function assumptionNote(reportCard: ReturnType<typeof planAnalysis>["reportCard"]): string {
  const parts: string[] = [];
  for (const row of reportCard) {
    if (row.key === "normality") {
      parts.push(row.status === "pass" ? "Normality OK" : "Normality fails");
    } else if (row.key === "equalVariance") {
      parts.push(row.status === "pass" ? "equal variance OK" : "unequal variance");
    } else if (row.key === "fallbackNote" && row.status === "note" && row.title === "Switched test") {
      parts.push("switched to a rank-based test");
    }
  }
  return parts.join(", ");
}

/**
 * Build the rich human summary for the approval card from the cached table
 * content and the pure planner. This is exactly what the user reads and approves.
 * Returns a fallback line when the table is not cached yet (the model called the
 * action without listing first) so the gate still has something to show.
 */
export function describeRunAnalysis(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseRunAnalysisArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return {
      summary:
        "run a statistical analysis on a Data Hub table (I will check the test assumptions before running it)",
    };
  }
  const built = buildIntent(content, parsed);
  if ("error" in built) {
    return { summary: `run a statistical analysis on ${content.meta.name}` };
  }
  const plan = planAnalysis(content, built.intent);
  const names = groupColumns(content)
    .filter((c) => built.columnIds.includes(c.id))
    .map((c) => c.name);
  const colPhrase =
    names.length === 2
      ? `${names[0]} vs ${names[1]}`
      : `${names.join(", ")}`;
  const note = assumptionNote(plan.reportCard);
  const notePhrase = note ? ` ${note}.` : "";
  return {
    summary: `${plan.recommendation} on ${colPhrase} in ${content.meta.name}.${notePhrase}`,
  };
}

/** The compact, model-friendly result the model summarizes after a run. The
 *  engine computed every number here, the model only relays them. */
export type RunAnalysisResult =
  | {
      ok: true;
      table: string;
      test: string;
      columns: string[];
      verdict: string;
      keyStatistic: string;
      pValue: number | null;
      nonparametricFallback: boolean;
      /** The engine-computed effect size as a human line (Cohen's d / Hedges' g
       *  + CI for t tests, eta / omega-squared for ANOVA, r-squared for
       *  correlation). Null for kinds with no effect size in this slice. */
      effectSize: string | null;
      /** A robustness note when the engine flagged borderline normality and
       *  computed a distribution-free bootstrap CI of the difference, so the
       *  model can say the result holds up without assuming normality. Null
       *  otherwise. */
      robustness: string | null;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Pull the headline statistic out of a normalized engine result, so the model
 *  can cite "the p-value" or "the F". The engine produced all of these. */
function keyStatisticOf(outcome: Extract<ReturnType<typeof runAnalysis>, { ok: true }>): {
  pValue: number | null;
  keyStatistic: string;
  nonparametric: boolean;
} {
  if (outcome.kind === "ttest") {
    const stat = outcome.nonparametric
      ? outcome.test.startsWith("Wilcoxon")
        ? `W = ${outcome.statistic.toFixed(2)}`
        : `U = ${outcome.statistic.toFixed(2)}`
      : `t = ${outcome.statistic.toFixed(2)}`;
    return {
      pValue: outcome.pValue,
      keyStatistic: `${stat}, ${formatP(outcome.pValue)}`,
      nonparametric: outcome.nonparametric,
    };
  }
  if (outcome.kind === "anova") {
    const stat = outcome.nonparametric
      ? `H = ${outcome.statistic.toFixed(2)}`
      : `F = ${outcome.statistic.toFixed(2)}`;
    return {
      pValue: outcome.pValue,
      keyStatistic: `${stat}, ${formatP(outcome.pValue)}`,
      nonparametric: outcome.nonparametric,
    };
  }
  // The remaining normalized kinds are not produced by the means family this
  // slice plans, but keep a safe default rather than throw.
  return { pValue: null, keyStatistic: "see the stored result", nonparametric: false };
}

/** Format a finite number to at most 2 decimals, trimming trailing zeros. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/** Format a 95% CI pair as a human clause, or null when not finite. */
function fmtCI(ci: [number, number] | null): string | null {
  if (!ci || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return null;
  return `95% CI ${fmtNum(ci[0])} to ${fmtNum(ci[1])}`;
}

/**
 * Pull the effect size, and where the engine computed one a robustness note, out
 * of a normalized outcome as human strings the model can relay. The engine
 * produced every number here, this only formats what it returned, nothing is
 * invented. Returns nulls for kinds that carry no effect size in this slice.
 */
function effectSizeOf(outcome: Extract<ReturnType<typeof runAnalysis>, { ok: true }>): {
  effectSize: string | null;
  robustness: string | null;
} {
  if (outcome.kind === "ttest") {
    // effectSizeLabel is "Cohen's d" on the parametric path, the rank-biserial
    // label on a nonparametric rank test.
    let es = `${outcome.effectSizeLabel} = ${fmtNum(outcome.effectSize)}`;
    if (outcome.hedgesG !== null) {
      const ci = fmtCI(outcome.effectSizeCI95);
      es += ` (Hedges' g ${fmtNum(outcome.hedgesG)}${ci ? `, ${ci}` : ""})`;
    }
    // Surface the distribution-free read only when normality is borderline AND a
    // bootstrap CI of the difference exists, so the model can volunteer that the
    // difference holds up without assuming normality.
    let robustness: string | null = null;
    if (outcome.normalityShaky && outcome.bootstrapCI95) {
      robustness = `Normality is borderline, so a distribution-free bootstrap 95% CI of the difference is ${fmtNum(
        outcome.bootstrapCI95[0],
      )} to ${fmtNum(outcome.bootstrapCI95[1])}.`;
    }
    return { effectSize: es, robustness };
  }
  if (outcome.kind === "anova") {
    const e = outcome.effectSize;
    if (!e) return { effectSize: null, robustness: null };
    let es = `${e.label} = ${fmtNum(e.etaSquared)}`;
    const extras: string[] = [];
    if (e.omegaSquared !== null) extras.push(`omega-squared ${fmtNum(e.omegaSquared)}`);
    const ci = fmtCI(e.etaSquaredCI95);
    if (ci) extras.push(ci);
    if (extras.length > 0) es += ` (${extras.join(", ")})`;
    return { effectSize: es, robustness: null };
  }
  if (outcome.kind === "correlation") {
    const ci = fmtCI(outcome.rSquaredCI95);
    return {
      effectSize: `r-squared = ${fmtNum(outcome.rSquared)}${ci ? ` (${ci})` : ""}`,
      robustness: null,
    };
  }
  if (outcome.kind === "regression") {
    return { effectSize: `r-squared = ${fmtNum(outcome.rSquared)}`, robustness: null };
  }
  return { effectSize: null, robustness: null };
}

/**
 * Run one analysis end to end against live content. Pure given the content, so a
 * test asserts the engine-computed number against a known dataset with no folder.
 * Builds the intent, runs the planner (test choice + fallback), builds the spec
 * the SAME way page.tsx does (inputs.columnIds + the planner's chosen type), runs
 * the engine, and returns both the spec (to store) and the compact result (to
 * summarize). Never fabricates, an engine failure surfaces as ok: false.
 */
export function planAndRun(
  content: DataHubDocContent,
  parsed: RunAnalysisArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<RunAnalysisResult, { ok: true }> }
  | { ok: false; error: string } {
  const built = buildIntent(content, parsed);
  if ("error" in built) return { ok: false, error: built.error };

  // The planner picks the assumption-aware test, unless the model named one.
  const plan = planAnalysis(content, built.intent);
  const planned = plan.steps[0]?.analysisType ?? null;
  const requested =
    parsed.test && parsed.test !== "auto" ? parsed.test : null;
  const chosenType = requested ?? planned;
  if (!chosenType) {
    return {
      ok: false,
      error:
        "I could not determine a runnable test for that table. It may not be a Column table of group measurements.",
    };
  }

  // Build the spec exactly like the wizard's createAnalysis (the validated write
  // path), then run it through the same engine entry point.
  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: chosenType,
    params: {},
    inputs: { columnIds: built.columnIds },
    resultCache: null,
    resultStale: false,
  };
  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  spec.resultCache = outcome;

  const names = groupColumns(content)
    .filter((c) => built.columnIds.includes(c.id))
    .map((c) => c.name);
  const stat = keyStatisticOf(outcome);
  const eff = effectSizeOf(outcome);
  // The means family this slice plans yields a ttest or anova kind, both of which
  // carry an engine `test` label. Fall back to the planner label otherwise.
  const testLabel =
    outcome.kind === "ttest" || outcome.kind === "anova"
      ? outcome.test
      : plan.recommendation;
  const result: Extract<RunAnalysisResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    test: testLabel,
    columns: names,
    verdict: plainLanguageSummary(outcome),
    keyStatistic: stat.keyStatistic,
    pValue: stat.pValue,
    nonparametricFallback: stat.nonparametric && requested === null,
    effectSize: eff.effectSize,
    robustness: eff.robustness,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

export const runDataHubAnalysisTool: AiTool = {
  name: "run_datahub_analysis",
  description:
    "Run a statistical analysis on a Data Hub table, store the result, and take the user to see it. Use this when the user asks to run a test or compare groups (for example \"run a t-test on Control vs Drug\" or \"compare these groups\"). Call list_datahub_tables first to get the table id and the real column names, then, if the table has more groups than the test needs, call ask_user so the user picks the exact groups. Then call this with the table id and those columns. You do not pick the test, the app's planner picks the right test for the data and checks its assumptions. This runs straight away, there is NO separate approval step, the user's request and their group pick are the consent, so do not call propose_plan for it and do not ask the user to allow it. It saves the result into that table as a version-controlled analysis, navigates the user to the Data Hub doc so they see it, and returns the verdict, the key statistic, and the effect size. After it returns, give ONE short line, the plain-language verdict, the key number, and the effect size it returned (for example Cohen's d or eta-squared). If the result carries a robustness note, add it, the difference holds up even without assuming the data is normal. Never invent a statistic, only repeat the numbers this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the Data Hub table to analyze, from a list_datahub_tables result.",
      },
      columns: {
        type: "array",
        items: { type: "string" },
        description:
          "The columns to compare, by their names (or ids) from list_datahub_tables. Two columns for a two-group test, three or more for a multi-group comparison. Omit to compare every group column in the table.",
      },
      paired: {
        type: "boolean",
        description:
          "True when the same subjects were measured under both conditions (a paired or repeated-measures design), false for independent groups (different subjects). Defaults to false.",
      },
      test: {
        type: "string",
        description:
          "Leave as \"auto\" (the default) to let the planner pick the right test and assumption-aware fallback. Only set an explicit test when the user names one specifically.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // No `action` flag, but `previewable: true` (ai review-mode bot, 2026-06-12).
  // This tool writes a new, reversible, version-controlled analysis, so it is not
  // a destructive action and carries no `action` flag. In whole-plan mode it runs
  // free (today's behavior, the request plus the group pick is the consent). In
  // step-by-step mode the previewable flag makes it show a preview-and-confirm
  // block first, using describeRunAnalysis to render the test name and groups
  // WITHOUT running it (the planner is pure given the cached content).
  previewable: true,
  describeAction: describeRunAnalysis,
  execute: async (args) => {
    const parsed = parseRunAnalysisArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error:
          "No table was given. Call list_datahub_tables first and pass the id of the table to analyze.",
      } satisfies RunAnalysisResult;
    }
    // Always read the LIVE doc so the stored result reflects current data, then
    // refresh the cache for any later describe pass.
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong. List the tables again and try one of those.",
      } satisfies RunAnalysisResult;
    }
    cacheTableContent(parsed.tableId, content);

    const run = planAndRun(content, parsed);
    if (!run.ok) {
      return { ok: false, error: run.error } satisfies RunAnalysisResult;
    }

    const stored = await datahubAnalysisDeps.persistAnalysis(
      parsed.tableId,
      run.spec,
    );
    if (!stored) {
      return {
        ok: false,
        error:
          "The analysis computed but could not be saved to the table. The result is not stored.",
      } satisfies RunAnalysisResult;
    }

    // Take the user to the stored result. The Data Hub page reads the
    // ?doc=<id>&analysis=<analysisId> deep link, selects that table, and then
    // selects the just-stored analysis so its result sheet (not the raw data grid)
    // is what the user lands on, so they SEE the test result instead of only reading
    // the chat summary. This is hard-wired here, not left to the model, so it always
    // happens after a successful run. The navigate seam defaults to the navigation
    // bridge, which performs a soft SPA transition that preserves the panel.
    datahubAnalysisDeps.navigate(
      `/datahub?doc=${parsed.tableId}&analysis=${run.result.analysisId}`,
    );

    return run.result satisfies RunAnalysisResult;
  },
};

// ---------------------------------------------------------------------------
// compare_models (XY model comparison, maps to the modelComparison engine type)
// ---------------------------------------------------------------------------

/** The model-supplied args for compare_models, before resolution. */
export type CompareModelsArgs = {
  tableId: string;
  /** The two curve-fit model ids to compare (must differ). */
  modelA: string;
  modelB: string;
  /** True when the pair is nested (e.g. 4PL vs 5PL), which enables the F test. */
  nested: boolean;
  /** Which Y column to fit, by name or id. Omit to use the first Y column. */
  yColumn?: string;
};

/** The compact, model-friendly result compare_models relays after a run. */
export type CompareModelsResult =
  | {
      ok: true;
      table: string;
      xName: string;
      yName: string;
      nested: boolean;
      /** The full normalized comparison (F test + AICc + per-model lines). */
      comparison: NormalizedModelComparison;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose tool args into typed CompareModelsArgs. Pure. */
export function parseCompareModelsArgs(
  args: Record<string, unknown>,
): CompareModelsArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    modelA: typeof args.modelA === "string" ? args.modelA.trim() : "",
    modelB: typeof args.modelB === "string" ? args.modelB.trim() : "",
    nested: args.nested === true,
    yColumn:
      typeof args.yColumn === "string" && args.yColumn.trim()
        ? args.yColumn.trim()
        : undefined,
  };
}

/**
 * Resolve the model's Y-column reference (name OR id, case-insensitive on name)
 * to a real Y-column id, or the first Y column when none is named or the
 * reference does not match (so a typo never yields no fit). Returns null when
 * the table has no Y column at all. Pure.
 */
export function resolveYColumnId(
  content: DataHubDocContent,
  yColumn: string | undefined,
): string | null {
  const ys = yColumns(content);
  if (ys.length === 0) return null;
  if (!yColumn) return ys[0].id;
  const ref = yColumn.trim().toLowerCase();
  const match = ys.find(
    (c) => c.id === yColumn || c.name.trim().toLowerCase() === ref,
  );
  return (match ?? ys[0]).id;
}

/**
 * Build a modelComparison AnalysisSpec for the request against live content and
 * run it through the SAME runAnalysis path the wizard uses, so BeakerBot never
 * computes a fit, an F statistic, or an AICc. The engine owns the math; this
 * only maps the model's words (a table, two model ids, a nested flag) onto the
 * validated spec. Pure given the content. Returns the spec to store plus the
 * compact result, or an error.
 */
export function buildModelComparison(
  content: DataHubDocContent,
  parsed: CompareModelsArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<CompareModelsResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isXYTable(content)) {
    return {
      ok: false,
      error:
        "Model comparison runs on an XY table (an X column plus one or more Y columns), and that table is not one. Pick an XY table, for example a dose-response curve.",
    };
  }
  if (!parsed.modelA || !parsed.modelB) {
    return { ok: false, error: "Pass two model ids to compare (modelA and modelB)." };
  }
  if (parsed.modelA === parsed.modelB) {
    return { ok: false, error: "Pick two DIFFERENT models to compare." };
  }
  if (!getModel(parsed.modelA) || !getModel(parsed.modelB)) {
    const known = listModels().map((m) => m.id).join(", ");
    return {
      ok: false,
      error: `One of those models is not one the fitter knows. Valid model ids: ${known}.`,
    };
  }

  const yId = resolveYColumnId(content, parsed.yColumn);
  if (!yId) {
    return {
      ok: false,
      error: "That XY table has no Y column to fit. Add a Y column of measurements first.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "modelComparison",
    params: {
      modelA: parsed.modelA,
      modelB: parsed.modelB,
      nested: parsed.nested ? "yes" : "no",
    },
    inputs: { columnIds: [yId] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "modelComparison") {
    return { ok: false, error: "The engine did not return a model comparison." };
  }
  spec.resultCache = outcome;

  const result: Extract<CompareModelsResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    xName: outcome.xName,
    yName: outcome.yName,
    nested: outcome.nested,
    comparison: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/**
 * Build the one-line preview summary for the compare_models step, from the args
 * and the cached table content, WITHOUT running the fit. Pure, so the step-mode
 * gate can render the preview-and-confirm block synchronously. Falls back to a
 * generic line when the table is not cached yet (the model called the tool
 * without listing first), so the gate always has something to show.
 */
export function describeCompareModels(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseCompareModelsArgs(args);
  const nestedPhrase = parsed.nested ? " (nested)" : "";
  if (!parsed.modelA || !parsed.modelB) {
    return { summary: "compare two curve-fit models on a Data Hub table" };
  }
  const content = getCachedTableContent(parsed.tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  return {
    summary: `fit ${parsed.modelA} vs ${parsed.modelB}${nestedPhrase}${where}`,
  };
}

export const compareModelsTool: AiTool = {
  name: "compare_models",
  description:
    "Compare two curve-fit models on the same XY (dose-response or time-course) Data Hub table to decide which one the data supports, then store the result and take the user to it. Use this when the user asks whether one model fits better than another (for example \"is a 5-parameter logistic better than a 4-parameter here\", \"compare one-site vs two-site binding\", \"4PL or 5PL?\"). Call list_datahub_tables first to get the XY table id. Pass the two model ids (modelA, modelB, they must differ) and a nested flag. Set nested true when one model is a special case of the other (4PL is nested in 5PL, one-site in two-site), which enables the extra-sum-of-squares F test; set it false for non-nested models, where only AICc is reported. The valid model ids are: logistic4pl, logistic5pl, michaelis-menten, exp-decay-1phase, exp-association-1phase, linear, polynomial2, gaussian. Optionally pass yColumn (a Y-column name or id) to choose which curve to fit when the table has more than one; omit to use the first. The app's engine fits both models and computes the F test (nested only) and AICc, you NEVER compute a fit, an F statistic, a p-value, or an AICc. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the comparison into the table as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the comparison. After it returns, give ONE short line, name the preferred model under the F test (if nested) and under AICc, and the key numbers (the F test p-value and the AICc delta). Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the XY Data Hub table to fit, from a list_datahub_tables result.",
      },
      modelA: {
        type: "string",
        description:
          "The first curve-fit model id. One of: logistic4pl, logistic5pl, michaelis-menten, exp-decay-1phase, exp-association-1phase, linear, polynomial2, gaussian.",
      },
      modelB: {
        type: "string",
        description:
          "The second curve-fit model id (must differ from modelA). Same valid set as modelA.",
      },
      nested: {
        type: "boolean",
        description:
          "True when one model is a special case of the other (for example 4PL nested in 5PL, one-site in two-site), which enables the extra-sum-of-squares F test. False for non-nested models, where only AICc is reported. Set this from whether the pair is genuinely nested, do not guess true to force an F test.",
      },
      yColumn: {
        type: "string",
        description:
          "Optional. Which Y column to fit, by name or id, when the XY table has more than one. Omit to fit the first Y column.",
      },
    },
    required: ["tableId", "modelA", "modelB", "nested"],
    additionalProperties: false,
  },
  // No `action` flag, mirroring run_datahub_analysis. `previewable: true` so the
  // step-by-step review mode shows a preview-and-confirm block first; in
  // whole-plan mode it still runs free, the write is a new, reversible,
  // version-controlled analysis and the user's request is the consent.
  previewable: true,
  describeAction: describeCompareModels,
  execute: async (args) => {
    const parsed = parseCompareModelsArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error:
          "No table was given. Call list_datahub_tables first and pass the id of the XY table to fit.",
      } satisfies CompareModelsResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong. List the tables again and try one of those.",
      } satisfies CompareModelsResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildModelComparison(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies CompareModelsResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error:
          "The comparison computed but could not be saved to the table. The result is not stored.",
      } satisfies CompareModelsResult;
    }

    datahubAnalysisDeps.navigate(
      `/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`,
    );

    return built.result satisfies CompareModelsResult;
  },
};

// ---------------------------------------------------------------------------
// run_multiple_regression (Column table, maps to the multipleRegression engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_multiple_regression. */
export type MultipleRegressionArgs = {
  tableId: string;
  /** The response (Y) column, by name or id. */
  yColumn: string;
  /** The predictor columns, by name or id, in order (two or more). */
  predictors: string[];
};

/** The compact result run_multiple_regression relays. */
export type MultipleRegressionToolResult =
  | {
      ok: true;
      table: string;
      yName: string;
      predictorNames: string[];
      n: number;
      rSquared: number;
      adjRSquared: number;
      fStatistic: number;
      fPValue: number;
      /** The full normalized result (per-coefficient estimate/se/t/p/ci95/vif). */
      regression: Extract<RunOutcome, { kind: "multipleRegression" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed MultipleRegressionArgs. Pure. */
export function parseMultipleRegressionArgs(
  args: Record<string, unknown>,
): MultipleRegressionArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    yColumn: typeof args.yColumn === "string" ? args.yColumn.trim() : "",
    predictors: Array.isArray(args.predictors)
      ? args.predictors.filter((p): p is string => typeof p === "string")
      : [],
  };
}

/**
 * Build a multipleRegression spec for the request against live content and run
 * it through the SAME runAnalysis path the wizard uses. The engine fits OLS; the
 * model only maps a Y column and an ordered list of predictor columns onto
 * inputs.columnIds = [yId, ...predictorIds]. Pure given the content. Returns the
 * spec to store plus the compact result, or an error.
 */
export function buildMultipleRegression(
  content: DataHubDocContent,
  parsed: MultipleRegressionArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<MultipleRegressionToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (groupColumns(content).length === 0) {
    return {
      ok: false,
      error:
        "Multiple regression runs on a Column table of measurement columns, and that table has none. Pick a Column table.",
    };
  }
  const yIds = resolveColumnIds(content, [parsed.yColumn]);
  if (yIds.length === 0) {
    return {
      ok: false,
      error: "I could not find that Y (response) column. List the table again and pick a real column name.",
    };
  }
  const yId = yIds[0];
  // Resolve predictors, dropping the Y column if it was also named there.
  const predictorIds = resolveColumnIds(content, parsed.predictors).filter((id) => id !== yId);
  if (predictorIds.length < 2) {
    return {
      ok: false,
      error:
        "Multiple regression needs a Y column and at least 2 distinct predictor columns. Name two or more predictors that are not the Y column.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "multipleRegression",
    params: {},
    inputs: { columnIds: [yId, ...predictorIds] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "multipleRegression") {
    return { ok: false, error: "The engine did not return a multiple regression." };
  }
  spec.resultCache = outcome;

  const result: Extract<MultipleRegressionToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    yName: outcome.yName,
    predictorNames: outcome.predictorNames,
    n: outcome.n,
    rSquared: outcome.rSquared,
    adjRSquared: outcome.adjRSquared,
    fStatistic: outcome.fStatistic,
    fPValue: outcome.fPValue,
    regression: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/**
 * Build the one-line preview summary for the run_multiple_regression step, from
 * the args and the cached table content, WITHOUT running the fit. Pure. Resolves
 * the model's column references to real names where the content is cached so the
 * user reads "regress Yield on Temp, pH", and falls back to a generic line
 * otherwise.
 */
export function describeMultipleRegression(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseMultipleRegressionArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content || !parsed.yColumn || parsed.predictors.length === 0) {
    return { summary: "run a multiple regression on a Data Hub table" };
  }
  const groups = groupColumns(content);
  const nameById = new Map(groups.map((c) => [c.id, c.name]));
  const lower = new Map(groups.map((c) => [c.name.trim().toLowerCase(), c.name]));
  const resolve = (ref: string): string =>
    nameById.get(ref) ?? lower.get(ref.trim().toLowerCase()) ?? ref;
  const yName = resolve(parsed.yColumn);
  const predictorNames = parsed.predictors.map(resolve).join(", ");
  return {
    summary: `multiple regression of ${yName} on ${predictorNames} in ${content.meta.name}`,
  };
}

export const runMultipleRegressionTool: AiTool = {
  name: "run_multiple_regression",
  description:
    "Fit an ordinary-least-squares multiple linear regression on a Column table (y = b0 + b1*x1 + ... + bk*xk), store the result, and take the user to it. Use this when the user wants to model one outcome from two or more predictor columns (for example \"regress yield on temperature, pH, and time\" or \"predict expression from dose and timepoint\"). Call list_datahub_tables first to get the table id and the real column names, then pass the Y (response) column and an ordered list of two or more predictor columns. The engine fits OLS by the normal equations, drops rows with any missing value (listwise), and reports each coefficient with its standard error, t, p, and 95% CI, plus R-squared, adjusted R-squared, the residual SE, the overall F test with its p, and each predictor's VIF (collinearity). You NEVER compute a coefficient, a p-value, an R-squared, or a VIF, the engine does. It errors cleanly when fewer than 2 predictors are given or there are too few rows (n must exceed predictors + 1); relay that message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the R-squared and adjusted R-squared, the overall F test p-value, and call out any predictor with a high VIF (above about 5 to 10) as collinear. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Column Data Hub table to fit, from a list_datahub_tables result.",
      },
      yColumn: {
        type: "string",
        description: "The response (Y) column to model, by name or id.",
      },
      predictors: {
        type: "array",
        items: { type: "string" },
        description:
          "The predictor (X) columns, by name or id, in the order you want them reported. Provide two or more, and none equal to the Y column.",
      },
    },
    required: ["tableId", "yColumn", "predictors"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // fit; plan mode runs it free.
  previewable: true,
  describeAction: describeMultipleRegression,
  execute: async (args) => {
    const parsed = parseMultipleRegressionArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the table id.",
      } satisfies MultipleRegressionToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies MultipleRegressionToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildMultipleRegression(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies MultipleRegressionToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The regression computed but could not be saved to the table. The result is not stored.",
      } satisfies MultipleRegressionToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies MultipleRegressionToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_logistic_regression (XY table, maps to the logisticRegression engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_logistic_regression. */
export type LogisticRegressionArgs = {
  tableId: string;
  /** The binary (0/1) outcome column, by name or id. The predictor is the
   *  table's X column. */
  yColumn?: string;
};

/** The compact result run_logistic_regression relays. */
export type LogisticRegressionToolResult =
  | {
      ok: true;
      table: string;
      xName: string;
      yName: string;
      n: number;
      oddsRatio: number;
      oddsRatioCI95: [number, number];
      mcFaddenR2: number;
      auc: number;
      xAtHalf: number;
      regression: Extract<RunOutcome, { kind: "logisticRegression" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed LogisticRegressionArgs. Pure. */
export function parseLogisticRegressionArgs(
  args: Record<string, unknown>,
): LogisticRegressionArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    yColumn:
      typeof args.yColumn === "string" && args.yColumn.trim() ? args.yColumn.trim() : undefined,
  };
}

/**
 * Build a logisticRegression spec for the request against live content and run
 * it through the SAME runAnalysis path the wizard uses. The binary outcome is
 * the chosen Y column (inputs.columnIds[0]); the single predictor is the XY
 * table's X column. The engine fits the logistic; the model only picks which Y
 * column is the binary outcome. Pure given the content.
 */
export function buildLogisticRegression(
  content: DataHubDocContent,
  parsed: LogisticRegressionArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<LogisticRegressionToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isXYTable(content)) {
    return {
      ok: false,
      error:
        "Logistic regression runs on an XY table (an X column plus a binary 0/1 Y column), and that table is not one. Pick an XY table.",
    };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  if (!yId) {
    return {
      ok: false,
      error: "That XY table has no Y column to use as the binary outcome.",
    };
  }
  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "logisticRegression",
    params: {},
    inputs: { columnIds: [yId] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "logisticRegression") {
    return { ok: false, error: "The engine did not return a logistic regression." };
  }
  spec.resultCache = outcome;

  const result: Extract<LogisticRegressionToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    xName: outcome.xName,
    yName: outcome.yName,
    n: outcome.n,
    oddsRatio: outcome.oddsRatio,
    oddsRatioCI95: outcome.oddsRatioCI95,
    mcFaddenR2: outcome.mcFaddenR2,
    auc: outcome.auc,
    xAtHalf: outcome.xAtHalf,
    regression: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/**
 * Build the one-line preview summary for the run_logistic_regression step, from
 * the args and the cached table content, WITHOUT running the fit. Pure. Names the
 * binary outcome column where the content is cached, and falls back to a generic
 * line otherwise.
 */
export function describeLogisticRegression(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseLogisticRegressionArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return { summary: "run a logistic regression on a Data Hub table" };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  const yName =
    (yId && yColumns(content).find((c) => c.id === yId)?.name) || "the outcome";
  return {
    summary: `logistic regression of ${yName} on the X column in ${content.meta.name}`,
  };
}

export const runLogisticRegressionTool: AiTool = {
  name: "run_logistic_regression",
  description:
    "Fit a binary logistic regression on an XY table (the probability of a 0/1 outcome as a function of the table's X column), store the result, and take the user to it. Use this when the user has a yes/no, pass/fail, or 0/1 outcome and wants to model it against a continuous X (for example \"logistic regression of survival on dose\" or \"does concentration predict the binary response\"). Call list_datahub_tables first to get the XY table id, then pass the binary Y column to use as the outcome (the single predictor is the table's X column). Omit yColumn to use the first Y column. The Y column must hold a binary 0/1 outcome. The engine fits the logistic by maximum likelihood and reports the odds ratio with its 95% CI, McFadden's pseudo R-squared, the AUC, and the X where probability is 0.5. You NEVER compute a coefficient, an odds ratio, or an AUC, the engine does, and it errors cleanly on data it cannot fit; relay that message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the odds ratio with its CI, McFadden's R-squared, and the AUC. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the XY Data Hub table to fit, from a list_datahub_tables result.",
      },
      yColumn: {
        type: "string",
        description:
          "The binary (0/1) outcome column, by name or id. Omit to use the first Y column. The predictor is the table's X column.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // fit; plan mode runs it free.
  previewable: true,
  describeAction: describeLogisticRegression,
  execute: async (args) => {
    const parsed = parseLogisticRegressionArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the XY table id.",
      } satisfies LogisticRegressionToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies LogisticRegressionToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildLogisticRegression(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies LogisticRegressionToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The regression computed but could not be saved to the table. The result is not stored.",
      } satisfies LogisticRegressionToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies LogisticRegressionToolResult;
  },
};

// ---------------------------------------------------------------------------
// global_fit (XY table with 2+ Y columns, maps to the globalFit engine)
// ---------------------------------------------------------------------------

/** The curve model a global fit shares parameters across. */
export type GlobalFitModel = "logistic4pl" | "logistic5pl";
/** The shared-parameter preset (which parameters are global vs per-curve). */
export type GlobalFitShare = "hill-top-bottom" | "hill" | "top-bottom" | "all-but-ec50";

/** The model-supplied args for global_fit. */
export type GlobalFitArgs = {
  tableId: string;
  model: GlobalFitModel;
  share: GlobalFitShare;
};

/** The compact result global_fit relays. */
export type GlobalFitToolResult =
  | {
      ok: true;
      table: string;
      model: GlobalFitModel;
      share: GlobalFitShare;
      datasetNames: string[];
      nDatasets: number;
      nTotal: number;
      nParams: number;
      rSquared: number;
      /** The full normalized result (shared params + per-curve local EC50s). */
      fit: Extract<RunOutcome, { kind: "globalFit" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed GlobalFitArgs, defaulting to the pharmacology
 *  standard (4PL, Hill + Top + Bottom shared, EC50 local). Pure. */
export function parseGlobalFitArgs(args: Record<string, unknown>): GlobalFitArgs {
  const model: GlobalFitModel = args.model === "logistic5pl" ? "logistic5pl" : "logistic4pl";
  const share: GlobalFitShare =
    args.share === "hill" ||
    args.share === "top-bottom" ||
    args.share === "all-but-ec50"
      ? args.share
      : "hill-top-bottom";
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    model,
    share,
  };
}

/**
 * Build a globalFit spec for the request against live content and run it through
 * the SAME runAnalysis path the wizard uses. Global fitting shares parameters
 * across EVERY Y column of an XY table (the engine reads them all), so the table
 * must be XY with two or more Y columns. The spec carries all Y ids in
 * inputs.columnIds for record-keeping (the engine reads the columns regardless),
 * and the model only picks the curve model + the share preset. Pure given the
 * content.
 */
export function buildGlobalFit(
  content: DataHubDocContent,
  parsed: GlobalFitArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<GlobalFitToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isXYTable(content)) {
    return {
      ok: false,
      error:
        "Global fitting runs on an XY table (a shared X column plus two or more Y curves), and that table is not one. Pick an XY table with several Y columns.",
    };
  }
  const ys = yColumns(content);
  if (ys.length < 2) {
    return {
      ok: false,
      error:
        "Global fitting needs at least 2 Y datasets to share parameters across. That table has fewer than two Y columns.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "globalFit",
    params: { model: parsed.model, share: parsed.share },
    inputs: { columnIds: ys.map((c) => c.id) },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "globalFit") {
    return { ok: false, error: "The engine did not return a global fit." };
  }
  spec.resultCache = outcome;

  const result: Extract<GlobalFitToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    model: outcome.model,
    share: parsed.share,
    datasetNames: outcome.datasetNames,
    nDatasets: outcome.nDatasets,
    nTotal: outcome.nTotal,
    nParams: outcome.nParams,
    rSquared: outcome.rSquared,
    fit: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the step-review card, built from the args + cached
 *  content without running the fit. Mirrors the other analysis describers. */
export function describeGlobalFit(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseGlobalFitArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  return {
    summary: `globally fit ${parsed.model} across the curves${where} (sharing ${parsed.share})`,
  };
}

export const globalFitTool: AiTool = {
  name: "global_fit",
  // Previewable like the other instant analysis tools, so it shows a preview +
  // confirm in step-by-step review mode (it runs free in whole-plan mode). It
  // carries no `action` flag, the write is a reversible analysis.
  previewable: true,
  describeAction: describeGlobalFit,
  description:
    "Run a global (shared-parameter) curve fit across several dose-response curves on one XY table at once (Prism's \"global fitting\"), store the result, and take the user to it. Use this when the user wants to fit the SAME model shape to two or more Y curves together while sharing some parameters and keeping others per-curve (for example \"globally fit these dose-response curves sharing the Hill slope and plateaus\", \"shared-parameter fit with a common Top and Bottom\"). The table must be an XY table with TWO OR MORE Y columns (the engine fits every Y column against the shared X). Call list_datahub_tables first to get the XY table id. Pass the model (\"logistic4pl\" the default, or \"logistic5pl\") and the share preset: \"hill-top-bottom\" (the default and pharmacology standard, shares the Hill slope plus both plateaus and keeps EC50 per curve), \"hill\" (shares the Hill slope only), \"top-bottom\" (shares both plateaus only), or \"all-but-ec50\" (shares everything except EC50). The EC50 is never shared (it is the per-curve readout), and the 5PL asymmetry S is always shared. The engine fits all curves jointly and reports each shared parameter once (with its CI) plus each curve's own EC50 (with CI) and the pooled R-squared. You NEVER compute a fit, a shared parameter, an EC50, or an R-squared, the engine does, and it errors cleanly when there are fewer than 2 Y datasets. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the shared parameters and the per-curve EC50s with the pooled R-squared. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the XY Data Hub table (with 2+ Y columns) to globally fit, from a list_datahub_tables result.",
      },
      model: {
        type: "string",
        description:
          "The curve model to fit across all curves. \"logistic4pl\" (the default, symmetric) or \"logistic5pl\" (asymmetric; its S parameter is always shared).",
      },
      share: {
        type: "string",
        description:
          "Which parameters are shared across curves. \"hill-top-bottom\" (the default, shares Hill slope + Top + Bottom, EC50 stays per curve), \"hill\" (Hill slope only), \"top-bottom\" (both plateaus only), or \"all-but-ec50\" (everything except EC50). EC50 is never shared.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const parsed = parseGlobalFitArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the XY table id.",
      } satisfies GlobalFitToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies GlobalFitToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildGlobalFit(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies GlobalFitToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The global fit computed but could not be saved to the table. The result is not stored.",
      } satisfies GlobalFitToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies GlobalFitToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_dose_response (single-curve 4PL/5PL fit, maps to the doseResponse engine)
// ---------------------------------------------------------------------------

/** The curve model a single-curve dose-response fit uses. */
export type DoseResponseModel = "logistic4pl" | "logistic5pl";

/** The model-supplied args for run_dose_response. */
export type DoseResponseArgs = {
  tableId: string;
  model: DoseResponseModel;
  /** Which Y curve to fit, by name or id. Omit to use the first Y column. */
  yColumn?: string;
};

/** The compact, model-friendly result run_dose_response relays. The engine
 *  computed every number; the model only repeats them, never an EC50, a Hill
 *  slope, or an R-squared of its own. */
export type DoseResponseToolResult =
  | {
      ok: true;
      table: string;
      xName: string;
      yName: string;
      model: DoseResponseModel;
      modelLabel: string;
      n: number;
      /** EC50 / IC50 in linear-dose units, with its asymmetric 95% CI. */
      ec50: number;
      ec50CI95: [number, number];
      hillSlope: number;
      top: number;
      bottom: number;
      rSquared: number;
      /** The full normalized fit (every parameter with its SE + CI). */
      fit: Extract<RunOutcome, { kind: "doseResponse" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed DoseResponseArgs, defaulting to the 4PL. Pure. */
export function parseDoseResponseArgs(args: Record<string, unknown>): DoseResponseArgs {
  const model: DoseResponseModel =
    args.model === "logistic5pl" ? "logistic5pl" : "logistic4pl";
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    model,
    yColumn:
      typeof args.yColumn === "string" && args.yColumn.trim()
        ? args.yColumn.trim()
        : undefined,
  };
}

/**
 * Build a doseResponse spec for the request against live content and run it
 * through the SAME runAnalysis path the wizard uses, so BeakerBot never computes
 * an EC50, a Hill slope, or an R-squared. The engine owns the fit; this only maps
 * the model's words (a table, a model, which Y curve) onto the validated spec,
 * mirroring buildModelComparison exactly. Pure given the content. Returns the spec
 * to store plus the compact result, or an error.
 */
export function buildDoseResponse(
  content: DataHubDocContent,
  parsed: DoseResponseArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<DoseResponseToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isXYTable(content)) {
    return {
      ok: false,
      error:
        "A dose-response fit runs on an XY table (an X column of doses plus one or more Y response columns), and that table is not one. Pick an XY table, for example a dose-response curve.",
    };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  if (!yId) {
    return {
      ok: false,
      error: "That XY table has no Y column to fit. Add a Y column of responses first.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "doseResponse",
    params: { model: parsed.model },
    inputs: { columnIds: [yId] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "doseResponse") {
    return { ok: false, error: "The engine did not return a dose-response fit." };
  }
  spec.resultCache = outcome;

  const result: Extract<DoseResponseToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    xName: outcome.xName,
    yName: outcome.yName,
    model: outcome.model,
    modelLabel: outcome.modelLabel,
    n: outcome.n,
    ec50: outcome.ec50,
    ec50CI95: outcome.ec50CI95,
    hillSlope: outcome.hillSlope.value,
    top: outcome.top.value,
    bottom: outcome.bottom.value,
    rSquared: outcome.rSquared,
    fit: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/**
 * Build the one-line preview summary for the run_dose_response step, from the
 * args and the cached table content, WITHOUT running the fit. Pure, so the
 * step-mode gate can render the preview-and-confirm block synchronously. Names
 * the curve where the content is cached, and falls back to a generic line when
 * the table is not cached yet (the model called the tool without listing first),
 * so the gate always has something to show, mirroring the other describers.
 */
export function describeDoseResponse(args: Record<string, unknown>): {
  summary: string;
} {
  const parsed = parseDoseResponseArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return { summary: `fit a ${parsed.model} dose-response curve on a Data Hub table` };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  const yName =
    (yId && yColumns(content).find((c) => c.id === yId)?.name) || "the curve";
  return {
    summary: `fit a ${parsed.model} dose-response curve to ${yName} in ${content.meta.name}`,
  };
}

export const runDoseResponseTool: AiTool = {
  name: "run_dose_response",
  description:
    "Fit a single dose-response curve (a 4PL or 5PL logistic) to one XY table and read out the EC50 / IC50, store the result, and take the user to it. Use this when the user asks for a dose-response fit or its potency readout (for example \"fit a dose-response curve and give me the EC50\", \"what is the IC50 here\", \"4PL fit on this curve\"). Call list_datahub_tables first to get the XY table id. Pass the model (\"logistic4pl\" the default, symmetric, or \"logistic5pl\" the asymmetric variable-slope variant). Optionally pass yColumn (a Y-column name or id) to choose which curve to fit when the table has more than one Y column; omit to fit the first. To COMPARE two models instead of fitting one, use compare_models; to fit several curves jointly with shared parameters, use global_fit. The app's engine fits the curve and reports the EC50 / IC50 with its asymmetric 95% CI, the Hill slope, the Top and Bottom plateaus, and R-squared, you NEVER compute an EC50, a Hill slope, or an R-squared. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the fit into the table as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the EC50 / IC50 with its CI, the Hill slope, and R-squared. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the XY Data Hub table to fit, from a list_datahub_tables result.",
      },
      model: {
        type: "string",
        description:
          "The curve model. \"logistic4pl\" (the default, symmetric four-parameter logistic) or \"logistic5pl\" (the asymmetric five-parameter variant). Use 5PL only when the user asks for it or the curve is visibly asymmetric.",
      },
      yColumn: {
        type: "string",
        description:
          "Optional. Which Y column to fit, by name or id, when the XY table has more than one. Omit to fit the first Y column.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis / compare_models). Step
  // mode previews the fit; whole-plan mode runs it free, the write is a new,
  // reversible, version-controlled analysis and the user's request is the consent.
  previewable: true,
  describeAction: describeDoseResponse,
  execute: async (args) => {
    const parsed = parseDoseResponseArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the XY table id.",
      } satisfies DoseResponseToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies DoseResponseToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildDoseResponse(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies DoseResponseToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The dose-response fit computed but could not be saved to the table. The result is not stored.",
      } satisfies DoseResponseToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies DoseResponseToolResult;
  },
};

// ---------------------------------------------------------------------------
// list_datahub_analyses (READ-only)
// ---------------------------------------------------------------------------

/** The compact, model-friendly view of one stored AnalysisSpec. */
export type AnalysisBrief = {
  id: string;
  type: string;
  columns: string[];
  hasResult: boolean;
};

/**
 * Shape one AnalysisSpec into a compact brief for the model. Pure so the tool
 * and the unit tests share one path. The column names come from the live
 * groupColumns projection of the content so the model sees "Control" and "Drug"
 * rather than "cControl" and "cDrug".
 */
export function shapeAnalysisBrief(
  spec: AnalysisSpec,
  content: DataHubDocContent,
): AnalysisBrief {
  const groups = groupColumns(content);
  const byId = new Map(groups.map((c) => [c.id, c.name]));
  // inputs is typed Record<string,unknown> in the model; the analysis-writing
  // path always stores columnIds there as string[].
  const columnIds =
    Array.isArray((spec.inputs as { columnIds?: unknown }).columnIds)
      ? ((spec.inputs as { columnIds: string[] }).columnIds)
      : [];
  const columns = columnIds
    .map((id) => byId.get(id) ?? id)
    .filter(Boolean);
  return {
    id: spec.id,
    type: spec.type,
    columns,
    hasResult: spec.resultCache != null,
  };
}

export const listDataHubAnalysesTool: AiTool = {
  name: "list_datahub_analyses",
  description:
    "List the stored analyses on a Data Hub table, so you can find the one the user is asking about and pass its id to read_datahub_analysis. Returns each analysis's id, test type, column names, and whether it has a stored result. Call this when the user refers to a past analysis by table but you do not know which specific analysis they mean (for example \"the t-test on the qPCR table\" when several exist). Read-only.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the Data Hub table whose analyses to list. From list_datahub_tables or the context message.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const tableId = typeof args.tableId === "string" ? args.tableId : "";
    if (!tableId) {
      return { ok: false, error: "No tableId given." };
    }
    const content = await datahubAnalysisDeps.resolveContent(tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong.",
      };
    }
    cacheTableContent(tableId, content);
    const analyses = content.analyses.map((a) =>
      shapeAnalysisBrief(a, content),
    );
    return {
      ok: true,
      table: content.meta.name,
      analyses,
    };
  },
};

// ---------------------------------------------------------------------------
// read_datahub_analysis (READ-only)
// ---------------------------------------------------------------------------

/** The compact, model-friendly view of one stored analysis result. The engine
 *  computed every number; the tool only relays resultCache, never recomputes. */
export type StoredAnalysisResult =
  | {
      ok: true;
      table: string;
      analysisId: string;
      test: string;
      columns: string[];
      verdict: string;
      keyStatistic: string;
      pValue: number | null;
      nonparametric: boolean;
      effectSize: string | null;
      robustness: string | null;
    }
  | { ok: false; error: string };

/**
 * Shape one stored AnalysisSpec's resultCache into the compact model-friendly
 * object. Pure, given content and the analysisId, so it can be unit-tested
 * against a fixture content object with a known resultCache without any folder.
 * The engine built every number in resultCache; this function only relays them.
 * It deliberately reuses keyStatisticOf and plainLanguageSummary, the SAME
 * helpers run_datahub_analysis uses, so the model summarizes a stored result
 * identically to how it would describe a freshly-run one.
 */
export function shapeStoredAnalysis(
  content: DataHubDocContent,
  analysisId: string,
): StoredAnalysisResult {
  const spec = content.analyses.find((a) => a.id === analysisId);
  if (!spec) {
    return { ok: false, error: `Analysis ${analysisId} not found on that table.` };
  }
  // resultCache is typed as unknown in the model. Cast it to the RunOutcome
  // union so the shape checks and the helper calls below type-check. The
  // analysis-writing path always stores a RunOutcome there, so this is safe.
  const cached = spec.resultCache as RunOutcome | null;
  if (!cached || !cached.ok) {
    return {
      ok: false,
      error:
        "That analysis has no stored result yet. Re-run it, or open it in the Data Hub.",
    };
  }
  const outcome = cached;
  const groups = groupColumns(content);
  const byId = new Map(groups.map((c) => [c.id, c.name]));
  // inputs is typed Record<string,unknown>; the write path always stores
  // columnIds there as string[].
  const columnIds =
    Array.isArray((spec.inputs as { columnIds?: unknown }).columnIds)
      ? ((spec.inputs as { columnIds: string[] }).columnIds)
      : [];
  const columns = columnIds
    .map((id) => byId.get(id) ?? id)
    .filter(Boolean);
  const stat = keyStatisticOf(outcome);
  const eff = effectSizeOf(outcome);
  // The means family (ttest / anova) carries a model-readable test label.
  // Use it when it is there; fall back to the spec type for other kinds.
  const testLabel =
    outcome.kind === "ttest" || outcome.kind === "anova"
      ? outcome.test
      : spec.type;
  return {
    ok: true,
    table: content.meta.name,
    analysisId: spec.id,
    test: testLabel,
    columns,
    verdict: plainLanguageSummary(outcome),
    keyStatistic: stat.keyStatistic,
    pValue: stat.pValue,
    nonparametric: stat.nonparametric,
    effectSize: eff.effectSize,
    robustness: eff.robustness,
  };
}

export const readDataHubAnalysisTool: AiTool = {
  name: "read_datahub_analysis",
  description:
    "Read back the stored result of one Data Hub analysis by its id, so you can summarize or explain what a past test showed. Use this when the user asks about an analysis that already exists (for example \"what did the t-test show?\" or \"summarize that analysis\") and it is NOT one you just ran this turn. If you know the analysis id (from the context message or from list_datahub_analyses), call this with it. If you do not know which analysis they mean, call list_datahub_analyses for that table first, then ask_user with the real analysis labels so the user taps the one they mean. Never invent a statistic; only relay what this tool returns. Read-only, it never navigates and never changes any data.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the Data Hub table that owns the analysis. From list_datahub_tables, from list_datahub_analyses, or from the context message (the parent id when an analysis is selected).",
      },
      analysisId: {
        type: "string",
        description:
          "The id of the analysis to read. From list_datahub_analyses, from the context message, or from a prior run_datahub_analysis call.",
      },
    },
    required: ["tableId", "analysisId"],
    additionalProperties: false,
  },
  // Read tools never navigate. Reading is silent; if the user also wants to see
  // the result in the Data Hub, they will say so and the model can then call
  // go_to_page. Separating read from navigate keeps the tool predictable: calling
  // read_datahub_analysis never moves the user unexpectedly.
  execute: async (args) => {
    const tableId = typeof args.tableId === "string" ? args.tableId : "";
    const analysisId = typeof args.analysisId === "string" ? args.analysisId : "";
    if (!tableId || !analysisId) {
      return {
        ok: false,
        error: "Both tableId and analysisId are required.",
      } satisfies StoredAnalysisResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies StoredAnalysisResult;
    }
    cacheTableContent(tableId, content);
    return shapeStoredAnalysis(content, analysisId) satisfies StoredAnalysisResult;
  },
};

// ---------------------------------------------------------------------------
// get_analysis_code (READ-only): the reproducible show-the-code snippet
// ---------------------------------------------------------------------------

/** The reproducible analysis code for a stored result, or an error. */
export type AnalysisCodeResult =
  | {
      ok: true;
      table: string;
      analysisId: string;
      /** The analysis kind the code reproduces (e.g. "anova", "modelComparison"). */
      kind: string;
      language: "python";
      /** The runnable snippet, with the real values baked in, the SAME show-the-
       *  code the Data Hub renders. */
      code: string;
    }
  | { ok: false; error: string };

/**
 * Shape one stored analysis into its reproducible code snippet. Pure given the
 * content + id. The engine's showCode owns the snippet (it bakes the real group
 * names / values in), so the model never writes the analysis code itself, it
 * only relays what showCode returned. Reuses the same resultCache the read tool
 * relays, so the code always matches the on-screen numbers.
 */
export function shapeAnalysisCode(
  content: DataHubDocContent,
  analysisId: string,
): AnalysisCodeResult {
  const spec = content.analyses.find((a) => a.id === analysisId);
  if (!spec) {
    return { ok: false, error: `Analysis ${analysisId} not found on that table.` };
  }
  const cached = spec.resultCache as RunOutcome | null;
  if (!cached || !cached.ok) {
    return {
      ok: false,
      error:
        "That analysis has no stored result yet, so there is no code to show. Re-run it first.",
    };
  }
  return {
    ok: true,
    table: content.meta.name,
    analysisId: spec.id,
    kind: cached.kind,
    language: "python",
    code: showCode(cached),
  };
}

export const getAnalysisCodeTool: AiTool = {
  name: "get_analysis_code",
  description:
    "Get the reproducible analysis code (a runnable Python snippet, with the real group names and values baked in) for one stored Data Hub analysis, the SAME show-the-code the Data Hub renders. Use this when the user asks for the code, the script, or the methods behind a test, or when you are writing results into a note or methods section and want to include the exact analysis code alongside the verdict so the work is reproducible. Call it with the table id and the analysis id (from run_datahub_analysis, compare_models, list_datahub_analyses, or the context message). It returns { kind, language, code }; drop the code into a note as a fenced ```python block via write_note. The engine wrote the snippet, you NEVER write or invent analysis code yourself, only relay what this returns. Read-only, it never navigates and never changes any data.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the Data Hub table that owns the analysis.",
      },
      analysisId: {
        type: "string",
        description:
          "The id of the analysis whose code to fetch. From run_datahub_analysis, compare_models, list_datahub_analyses, or the context message.",
      },
    },
    required: ["tableId", "analysisId"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const tableId = typeof args.tableId === "string" ? args.tableId : "";
    const analysisId = typeof args.analysisId === "string" ? args.analysisId : "";
    if (!tableId || !analysisId) {
      return {
        ok: false,
        error: "Both tableId and analysisId are required.",
      } satisfies AnalysisCodeResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies AnalysisCodeResult;
    }
    cacheTableContent(tableId, content);
    return shapeAnalysisCode(content, analysisId) satisfies AnalysisCodeResult;
  },
};
