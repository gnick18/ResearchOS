// BeakerBot Data Hub analysis tools (ai datahub-analysis bot, 2026-06-11).
//
// BeakerBot's first DATA coworker pair. They let the assistant run a real
// statistical analysis on a Data Hub table from a natural-language request,
// through the SAME deterministic planner and reference-validated engine the
// guided wizard uses, and the SAME plan-approve flow the other action tools use.
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
//   - run_datahub_analysis (ACTION, action: true): plan the analysis with the
//     planner (the proposal the user approves), run it through the engine, store
//     the resulting AnalysisSpec in the table's Loro doc (version-controlled),
//     and return a compact engine-computed result the model summarizes.
//
// describeAction is SYNCHRONOUS and pure (the agent loop requires it), but a
// rich proposal needs the table content and the planner. We bridge that by
// caching each table's content the moment list_datahub_tables reads it (the
// model must call that first to learn a tableId), so describeAction can run the
// pure planAnalysis against the cached content with no async read. execute then
// re-reads the live doc so the stored result is always against current data.
//
// run_datahub_analysis is NOT destructive. Creating an analysis writes a new,
// reversible, version-controlled AnalysisSpec (the wizard's exact write path),
// it deletes nothing and sends nothing outward, so plan-approval covers it and
// it never triggers the destructive hard-stop.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { dataHubApi } from "@/lib/datahub/api";
import { openDataHubDoc, type DataHubDocHandle } from "@/lib/loro/datahub-store";
import {
  getDataHubContent,
  setAnalysis as setAnalysisInDoc,
} from "@/lib/loro/datahub-doc";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { groupColumns } from "@/lib/datahub/column-table";
import { planAnalysis, type AnalysisIntent } from "@/lib/datahub/planner";
import { runAnalysis, type AnalysisType } from "@/lib/datahub/run-analysis";
import { plainLanguageSummary, formatP } from "@/lib/datahub/plain-language";
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
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

export const runDataHubAnalysisTool: AiTool = {
  name: "run_datahub_analysis",
  description:
    "Run a statistical analysis on a Data Hub table and store the result, for when the user asks to run a test or compare groups (for example \"run a t-test on Control vs Drug\" or \"compare these groups\"). Call list_datahub_tables first to get the table id and the real column names, then call this with the table id and the columns to compare. You do not pick the test, the app's planner picks the right test for the data and checks its assumptions, then shows the user the proposed test as a plan to approve. After they approve, the engine computes the result, it is saved into that table as a version-controlled analysis, and this returns the verdict plus the key statistic for you to relay. Never invent a statistic, only repeat the numbers this returns. This is the plan you propose, so do not call propose_plan separately for it.",
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
  action: true,
  describeAction: (args) => describeRunAnalysis(args),
  // Creating an analysis is a reversible, version-controlled write (a new
  // AnalysisSpec), not a delete, send, share, or pay. Plan-approval covers it, so
  // it never triggers the destructive hard-stop.
  isDestructive: () => false,
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
    // refresh the cache for any later describeAction.
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
    return run.result satisfies RunAnalysisResult;
  },
};
