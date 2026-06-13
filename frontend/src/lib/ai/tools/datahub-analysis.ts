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
import { survivalGroups, hasSurvivalData } from "@/lib/datahub/survival-table";
import { hasContingencyData, isContingencyTable } from "@/lib/datahub/contingency-table";
import { hasNestedData, isNestedTable } from "@/lib/datahub/nested-table";
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
import type { AiTool, StepApprovalRequest } from "./types";

// Build a `kind:"step"` rich-block approval from a previewable analysis / model
// tool's already-resolved parts (the human header, the input pills, and the
// readout-preview lines). One block per call, the same block UI the transform
// card renders. Keeps each describe function to a single literal.
function stepPayloadFor(opts: {
  toolName: string;
  iconName: string;
  title: string;
  subtitle?: string;
  name: string;
  blurb: string;
  params: { label: string; value: string }[];
  previewLines?: string[];
}): StepApprovalRequest {
  return {
    kind: "step",
    toolName: opts.toolName,
    iconName: opts.iconName,
    title: opts.title,
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    steps: [
      {
        kind: opts.toolName,
        name: opts.name,
        blurb: opts.blurb,
        params: opts.params,
        ...(opts.previewLines && opts.previewLines.length > 0
          ? { previewLines: opts.previewLines }
          : {}),
      },
    ],
  };
}

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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseRunAnalysisArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  // Emit a step block even when the table is not cached or the intent cannot be
  // resolved yet, so step-by-step mode always shows the rich preview-and-confirm
  // card rather than the generic Allow / Skip confirm. The pills are degraded
  // (no resolved test or group names) but the step is still reviewable.
  if (!content) {
    return {
      summary:
        "run a statistical analysis on a Data Hub table (I will check the test assumptions before running it)",
      stepPayload: stepPayloadFor({
        toolName: "run_datahub_analysis",
        iconName: "chart",
        title: "Run a statistical analysis",
        name: "Statistical analysis",
        blurb: "I check the test assumptions, then run the right test.",
        params: [],
      }),
    };
  }
  const built = buildIntent(content, parsed);
  if ("error" in built) {
    return {
      summary: `run a statistical analysis on ${content.meta.name}`,
      stepPayload: stepPayloadFor({
        toolName: "run_datahub_analysis",
        iconName: "chart",
        title: "Run a statistical analysis",
        subtitle: `on ${content.meta.name}`,
        name: "Statistical analysis",
        blurb: "I check the test assumptions, then run the right test.",
        params: [{ label: "Table", value: content.meta.name }],
      }),
    };
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
  const params: { label: string; value: string }[] = [
    { label: "Test", value: plan.recommendation },
    { label: names.length === 2 ? "Groups" : "Columns", value: colPhrase },
    { label: "Table", value: content.meta.name },
  ];
  return {
    summary: `${plan.recommendation} on ${colPhrase} in ${content.meta.name}.${notePhrase}`,
    stepPayload: stepPayloadFor({
      toolName: "run_datahub_analysis",
      iconName: "chart",
      title: `Run ${plan.recommendation}`,
      subtitle: `on ${colPhrase} in ${content.meta.name}`,
      name: plan.recommendation,
      blurb: `Statistical test of ${colPhrase}.`,
      params,
      previewLines: note ? [`Assumptions, ${note}.`] : undefined,
    }),
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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseCompareModelsArgs(args);
  const nestedPhrase = parsed.nested ? " (nested)" : "";
  if (!parsed.modelA || !parsed.modelB) {
    return { summary: "compare two curve-fit models on a Data Hub table" };
  }
  const content = getCachedTableContent(parsed.tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  const summary = `fit ${parsed.modelA} vs ${parsed.modelB}${nestedPhrase}${where}`;
  if (!content) {
    return {
      summary,
      stepPayload: stepPayloadFor({
        toolName: "compare_models",
        iconName: "lineage",
        title: `Compare ${parsed.modelA} vs ${parsed.modelB}`,
        name: `Model comparison${nestedPhrase}`,
        blurb: "Decide which model the curve data supports.",
        params: [
          { label: "Model A", value: parsed.modelA },
          { label: "Model B", value: parsed.modelB },
          { label: "Nested", value: parsed.nested ? "yes" : "no" },
        ],
      }),
    };
  }
  return {
    summary,
    stepPayload: stepPayloadFor({
      toolName: "compare_models",
      iconName: "lineage",
      title: `Compare ${parsed.modelA} vs ${parsed.modelB}`,
      subtitle: `on ${content.meta.name}`,
      name: `Model comparison${nestedPhrase}`,
      blurb: `Decide which model the curve data supports.`,
      params: [
        { label: "Model A", value: parsed.modelA },
        { label: "Model B", value: parsed.modelB },
        { label: "Nested", value: parsed.nested ? "yes" : "no" },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: [
        parsed.nested
          ? "Reports the extra-sum-of-squares F test and AICc."
          : "Non-nested, reports AICc only.",
      ],
    }),
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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseMultipleRegressionArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content || !parsed.yColumn || parsed.predictors.length === 0) {
    return {
      summary: "run a multiple regression on a Data Hub table",
      stepPayload: stepPayloadFor({
        toolName: "run_multiple_regression",
        iconName: "chart",
        title: "Run a multiple regression",
        name: "Multiple regression (OLS)",
        blurb: "Model one outcome from several predictor columns.",
        params: [],
      }),
    };
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
    stepPayload: stepPayloadFor({
      toolName: "run_multiple_regression",
      iconName: "chart",
      title: `Multiple regression of ${yName}`,
      subtitle: `on ${predictorNames} in ${content.meta.name}`,
      name: "Multiple regression (OLS)",
      blurb: `Model ${yName} from ${parsed.predictors.length} predictors.`,
      params: [
        { label: "Outcome", value: yName },
        { label: "Predictors", value: predictorNames },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports each coefficient with CI, R-squared, the overall F, and VIF."],
    }),
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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseLogisticRegressionArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return {
      summary: "run a logistic regression on a Data Hub table",
      stepPayload: stepPayloadFor({
        toolName: "run_logistic_regression",
        iconName: "chart",
        title: "Run a logistic regression",
        name: "Binary logistic regression",
        blurb: "Model a 0/1 outcome against the table's X column.",
        params: [],
      }),
    };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  const yName =
    (yId && yColumns(content).find((c) => c.id === yId)?.name) || "the outcome";
  return {
    summary: `logistic regression of ${yName} on the X column in ${content.meta.name}`,
    stepPayload: stepPayloadFor({
      toolName: "run_logistic_regression",
      iconName: "chart",
      title: `Logistic regression of ${yName}`,
      subtitle: `on the X column in ${content.meta.name}`,
      name: "Binary logistic regression",
      blurb: `Model the 0/1 outcome ${yName} against the table's X.`,
      params: [
        { label: "Outcome", value: yName },
        { label: "Predictor", value: "the table's X column" },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports the odds ratio with CI, McFadden R-squared, and AUC."],
    }),
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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseGlobalFitArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  const summary = `globally fit ${parsed.model} across the curves${where} (sharing ${parsed.share})`;
  if (!content) {
    return {
      summary,
      stepPayload: stepPayloadFor({
        toolName: "global_fit",
        iconName: "lineage",
        title: `Global fit, ${parsed.model}`,
        name: "Global (shared-parameter) fit",
        blurb: "Fit one model shape to every Y curve at once.",
        params: [
          { label: "Model", value: parsed.model },
          { label: "Share", value: parsed.share },
        ],
      }),
    };
  }
  return {
    summary,
    stepPayload: stepPayloadFor({
      toolName: "global_fit",
      iconName: "lineage",
      title: `Global fit, ${parsed.model}`,
      subtitle: `across the curves in ${content.meta.name}`,
      name: "Global (shared-parameter) fit",
      blurb: `Fit one ${parsed.model} shape to every Y curve at once.`,
      params: [
        { label: "Model", value: parsed.model },
        { label: "Share", value: parsed.share },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports each shared parameter once plus a per-curve EC50 and the pooled R-squared."],
    }),
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
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseDoseResponseArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return {
      summary: `fit a ${parsed.model} dose-response curve on a Data Hub table`,
      stepPayload: stepPayloadFor({
        toolName: "run_dose_response",
        iconName: "growth",
        title: `Fit a ${parsed.model} dose-response curve`,
        name: "Dose-response fit",
        blurb: "Fit the curve and read out the EC50/IC50.",
        params: [{ label: "Model", value: parsed.model }],
      }),
    };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  const yName =
    (yId && yColumns(content).find((c) => c.id === yId)?.name) || "the curve";
  return {
    summary: `fit a ${parsed.model} dose-response curve to ${yName} in ${content.meta.name}`,
    stepPayload: stepPayloadFor({
      toolName: "run_dose_response",
      iconName: "growth",
      title: `Fit a ${parsed.model} dose-response curve`,
      subtitle: `to ${yName} in ${content.meta.name}`,
      name: "Dose-response fit",
      blurb: `Fit ${yName} and read out the EC50/IC50.`,
      params: [
        { label: "Model", value: parsed.model },
        { label: "Curve", value: yName },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports the EC50/IC50 with CI, the Hill slope, the plateaus, and R-squared."],
    }),
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

// ===========================================================================
// Data Hub Themes 3 + 4 analysis tools (ai beakerai bot, 2026-06-12).
//
// Five more read-only Data Hub coworkers, each mirroring run_dose_response end
// to end: parse args, resolve the table from the content cache, build the
// SAME AnalysisSpec the wizard writes, run it through runAnalysis, store +
// navigate, and relay ONLY the numbers the engine returned. BeakerBot never
// computes a hazard ratio, an F, a variance component, an outlier flag, or an
// AUC, the engine owns every statistic.
//
//   - run_cox_regression (coxRegression): a Survival table, reference arm param.
//   - run_roc_curve (rocCurve): an XY table, the binary-outcome shape.
//   - run_repeated_measures_anova (repeatedMeasuresAnova): a row-paired Column
//     table of 3+ condition columns.
//   - run_mixed_model (linearMixedModel): the same row-paired Column table.
//   - run_grubbs_outliers (grubbsOutlier): a Column table, alpha + iterative.
// ===========================================================================

// ---------------------------------------------------------------------------
// run_cox_regression (Survival table, maps to the coxRegression engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_cox_regression. */
export type CoxRegressionArgs = {
  tableId: string;
  /** Which arm is coded 0 (the reference the hazard ratio is measured against),
   *  by its Group label. Omit to use the first arm in the table. */
  referenceGroup?: string;
};

/** The compact result run_cox_regression relays. The engine computed every
 *  number here; the model only repeats them, never a hazard ratio or a p of
 *  its own. */
export type CoxRegressionToolResult =
  | {
      ok: true;
      table: string;
      n: number;
      events: number;
      /** The full normalized Cox result (per-covariate HR + CI, LR test, concordance). */
      cox: Extract<RunOutcome, { kind: "coxRegression" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed CoxRegressionArgs. Pure. */
export function parseCoxRegressionArgs(
  args: Record<string, unknown>,
): CoxRegressionArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    referenceGroup:
      typeof args.referenceGroup === "string" && args.referenceGroup.trim()
        ? args.referenceGroup.trim()
        : undefined,
  };
}

/**
 * Build a coxRegression spec for the request against live content and run it
 * through the SAME runAnalysis path the wizard uses. Cox reads a Survival table
 * directly (the engine's survivalGroups projects Time + Event + Group into arms),
 * so there are no input column ids to resolve; the only knob is which arm is the
 * reference (coded 0), passed through the referenceGroup param exactly as the
 * engine reads it. The engine fits the proportional-hazards model; the model only
 * names the reference arm. Pure given the content.
 */
export function buildCoxRegression(
  content: DataHubDocContent,
  parsed: CoxRegressionArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<CoxRegressionToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!hasSurvivalData(content)) {
    return {
      ok: false,
      error:
        "Cox regression runs on a Survival table (a Time column, an Event column of 1/0, and a Group column for the arms), and that table has no survival data. Pick a Survival table and enter a Time and an Event for each subject.",
    };
  }
  if (survivalGroups(content).filter((g) => g.observations.length > 0).length < 2) {
    return {
      ok: false,
      error:
        "Cox regression needs two arms to compare (a reference and a comparison). That Survival table has only one arm. Label the subjects into two groups first.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "coxRegression",
    // The engine reads spec.params.referenceGroup as the arm name to code 0; an
    // absent / unknown name keeps the first-arm default, so omit it when unset.
    params: parsed.referenceGroup ? { referenceGroup: parsed.referenceGroup } : {},
    inputs: { columnIds: [] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "coxRegression") {
    return { ok: false, error: "The engine did not return a Cox regression." };
  }
  spec.resultCache = outcome;

  const result: Extract<CoxRegressionToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    n: outcome.n,
    events: outcome.events,
    cox: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the step-review card, built from the args + cached
 *  content without running the fit. Mirrors the other analysis describers, and
 *  emits a stepPayload even with no cached content. */
export function describeCoxRegression(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseCoxRegressionArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  const refPhrase = parsed.referenceGroup
    ? ` (reference ${parsed.referenceGroup})`
    : "";
  if (!content) {
    return {
      summary: `run a Cox proportional-hazards regression on a Data Hub table${refPhrase}`,
      stepPayload: stepPayloadFor({
        toolName: "run_cox_regression",
        iconName: "lineage",
        title: "Run a Cox regression",
        name: "Cox proportional hazards",
        blurb: "Estimate the hazard ratio between the survival arms.",
        params: parsed.referenceGroup
          ? [{ label: "Reference", value: parsed.referenceGroup }]
          : [],
      }),
    };
  }
  return {
    summary: `Cox regression on ${content.meta.name}${refPhrase}`,
    stepPayload: stepPayloadFor({
      toolName: "run_cox_regression",
      iconName: "lineage",
      title: "Run a Cox regression",
      subtitle: `on ${content.meta.name}`,
      name: "Cox proportional hazards",
      blurb: "Estimate the hazard ratio between the survival arms.",
      params: [
        ...(parsed.referenceGroup
          ? [{ label: "Reference", value: parsed.referenceGroup }]
          : []),
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports the hazard ratio with CI, the likelihood-ratio test, and concordance."],
    }),
  };
}

export const runCoxRegressionTool: AiTool = {
  name: "run_cox_regression",
  description:
    "Fit a Cox proportional-hazards regression on a Survival table (the hazard of an event over time for one arm versus a reference arm), store the result, and take the user to it. Use this when the user wants the hazard ratio between two survival arms (for example \"Cox regression of the treated vs control arm\", \"what is the hazard ratio for the drug group\"). The table must be a Survival table (a Time column, an Event column of 1 = event / 0 = censored, and a Group column for the arms) with two or more arms. Call list_datahub_tables first to get the table id. Optionally pass referenceGroup (a Group label) to choose which arm is coded 0 (the baseline the hazard ratio is measured against); omit to use the first arm. The engine fits the model by partial-likelihood and reports each covariate's hazard ratio with its 95% CI, the z and p, the overall likelihood-ratio test (chi-square, df, p), and Harrell's concordance. You NEVER compute a coefficient, a hazard ratio, a p-value, or a concordance, the engine does, and it errors cleanly when there are fewer than two arms; relay that message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the hazard ratio with its CI, the likelihood-ratio test p, and the concordance. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Survival Data Hub table to fit, from a list_datahub_tables result.",
      },
      referenceGroup: {
        type: "string",
        description:
          "Optional. The Group label of the arm to code 0 (the reference the hazard ratio is measured against). Omit to use the first arm in the table.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // fit; plan mode runs it free, the write is a reversible, version-controlled
  // analysis and the user's request is the consent.
  previewable: true,
  describeAction: describeCoxRegression,
  execute: async (args) => {
    const parsed = parseCoxRegressionArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the Survival table id.",
      } satisfies CoxRegressionToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies CoxRegressionToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildCoxRegression(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies CoxRegressionToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The Cox regression computed but could not be saved to the table. The result is not stored.",
      } satisfies CoxRegressionToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies CoxRegressionToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_contingency (Contingency table, maps to the contingency engine type)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_contingency. */
export type ContingencyArgs = {
  tableId: string;
  /** The Yates continuity correction, only meaningful for a 2x2 table. The
   *  engine reads spec.params.yates as the string "on" / "off" (default "on"),
   *  matching every Data Hub string-valued param. */
  yates?: "on" | "off";
};

/** The compact result run_contingency relays. The engine computed every number
 *  here; the model only repeats them, never a chi-square, a p, or an odds ratio
 *  of its own. */
export type ContingencyToolResult =
  | {
      ok: true;
      table: string;
      n: number;
      /** The full normalized contingency result (chi-square + p, df, and for a
       *  2x2 the Yates + Fisher p and the RR / OR with CI, plus min expected). */
      contingency: Extract<RunOutcome, { kind: "contingency" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed ContingencyArgs. Pure. */
export function parseContingencyArgs(args: Record<string, unknown>): ContingencyArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    yates: args.yates === "off" ? "off" : args.yates === "on" ? "on" : undefined,
  };
}

/**
 * Build a contingency spec and run it through the SAME runAnalysis path the
 * wizard uses. Contingency reads a Contingency table (an R x C count matrix)
 * directly, so there are no input column ids to resolve; the only knob is the
 * Yates continuity correction (2x2 only), passed as the string param the engine
 * reads. Pure given the content.
 */
export function buildContingency(
  content: DataHubDocContent,
  parsed: ContingencyArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<ContingencyToolResult, { ok: true }> }
  | { ok: false; error: string } {
  // Guard on BOTH the table type and the presence of counts. hasContingencyData
  // alone only checks for positive counts, which any numeric Column table would
  // also pass, so require the table to actually be a Contingency table first.
  if (!isContingencyTable(content) || !hasContingencyData(content)) {
    return {
      ok: false,
      error:
        "A contingency analysis runs on a Contingency table (a row factor, a column factor, and a count in each cell), and that table has no contingency data. Pick a Contingency table with counts in its cells.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "contingency",
    // The engine reads spec.params.yates as "on" / "off" (default "on", 2x2
    // only). Omit when "on" to keep the default; set it only to turn it off.
    params: parsed.yates === "off" ? { yates: "off" } : {},
    inputs: { columnIds: [] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "contingency") {
    return { ok: false, error: "The engine did not return a contingency analysis." };
  }
  spec.resultCache = outcome;

  const result: Extract<ContingencyToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    n: outcome.n,
    contingency: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the step-review card, built from the args + cached
 *  content without running the test. Mirrors the other analysis describers, and
 *  emits a stepPayload even with no cached content. */
export function describeContingency(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseContingencyArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  const yatesPhrase = parsed.yates === "off" ? " (no Yates correction)" : "";
  if (!content) {
    return {
      summary: `run a contingency (chi-square) analysis on a Data Hub table${yatesPhrase}`,
      stepPayload: stepPayloadFor({
        toolName: "run_contingency",
        iconName: "chart",
        title: "Run a contingency analysis",
        name: "Chi-square test of association",
        blurb: "Test whether the row and column factors are independent.",
        params: parsed.yates === "off" ? [{ label: "Yates", value: "off" }] : [],
      }),
    };
  }
  return {
    summary: `contingency analysis on ${content.meta.name}${yatesPhrase}`,
    stepPayload: stepPayloadFor({
      toolName: "run_contingency",
      iconName: "chart",
      title: "Run a contingency analysis",
      subtitle: `on ${content.meta.name}`,
      name: "Chi-square test of association",
      blurb: "Test whether the row and column factors are independent.",
      params: [
        ...(parsed.yates === "off" ? [{ label: "Yates", value: "off" }] : []),
        { label: "Table", value: content.meta.name },
      ],
      previewLines: [
        "Reports the chi-square, df, and p; for a 2x2 also the Yates and Fisher exact p and the odds ratio.",
      ],
    }),
  };
}

export const runContingencyTool: AiTool = {
  name: "run_contingency",
  description:
    "Run a contingency-table association test (Pearson chi-square, with Fisher's exact test and the odds ratio for a 2x2) on a Contingency table, store the result, and take the user to it. Use this when the user wants to test whether two categorical factors are associated or independent (for example \"is treatment associated with response\", \"chi-square test on this 2x2\", \"are these proportions different\"). The table must be a Contingency table (a row factor, a column factor, and a count in each cell). Call list_datahub_tables first to get the table id. Optionally pass yates (\"on\" the default, or \"off\") to control the Yates continuity correction, which only applies to a 2x2 table; omit to keep it on. The engine computes the chi-square, df, and p under independence, and for a 2x2 also the Yates-corrected chi-square + p, Fisher's exact two-sided p, and the relative risk and odds ratio with 95% CIs; it also reports the smallest expected count so you can flag the chi-square caveat when any expected count is below 5. You NEVER compute a chi-square, a p-value, an odds ratio, or an expected count, the engine does. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the result. After it returns, give ONE short line, the chi-square with df and p (and for a 2x2 the odds ratio with its CI and Fisher's p), and warn if the smallest expected count is below 5. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Contingency Data Hub table to test, from a list_datahub_tables result.",
      },
      yates: {
        type: "string",
        description:
          "Optional. The Yates continuity correction for a 2x2 table, \"on\" (the default) or \"off\". Ignored for larger tables. Omit to keep it on.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // test; plan mode runs it free, the write is a reversible, version-controlled
  // analysis and the user's request is the consent.
  previewable: true,
  describeAction: describeContingency,
  execute: async (args) => {
    const parsed = parseContingencyArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the Contingency table id.",
      } satisfies ContingencyToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies ContingencyToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildContingency(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies ContingencyToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The contingency analysis computed but could not be saved to the table. The result is not stored.",
      } satisfies ContingencyToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies ContingencyToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_nested_ttest + run_nested_anova (Nested table, read whole, no params)
// ---------------------------------------------------------------------------

/** The model-supplied args for the nested tools. A Nested table is read whole
 *  (groups of subgroups of replicates), so there is nothing to pick but the
 *  table. */
export type NestedArgs = { tableId: string };

export function parseNestedArgs(args: Record<string, unknown>): NestedArgs {
  return { tableId: typeof args.tableId === "string" ? args.tableId : "" };
}

/** The compact result run_nested_ttest relays. The engine computed every number;
 *  the model only repeats them. */
export type NestedTTestToolResult =
  | {
      ok: true;
      table: string;
      observations: number;
      subgroups: number;
      nested: Extract<RunOutcome, { kind: "nestedTTest" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** The compact result run_nested_anova relays. */
export type NestedAnovaToolResult =
  | {
      ok: true;
      table: string;
      observations: number;
      subgroups: number;
      nested: Extract<RunOutcome, { kind: "nestedOneWayAnova" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

const NESTED_NOT_NESTED_ERROR =
  "A nested analysis runs on a Nested table (top-level groups, each holding subgroups, each holding replicate values), and that table is not a nested table with data. Pick a Nested table.";

/** Build a nestedTTest spec and run it. A Nested table is read whole, so there
 *  are no input columns and no params. Pure given the content. */
export function buildNestedTTest(
  content: DataHubDocContent,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<NestedTTestToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isNestedTable(content) || !hasNestedData(content)) {
    return { ok: false, error: NESTED_NOT_NESTED_ERROR };
  }
  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "nestedTTest",
    params: {},
    inputs: { columnIds: [] },
    resultCache: null,
    resultStale: false,
  };
  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "nestedTTest") {
    return { ok: false, error: "The engine did not return a nested t-test." };
  }
  spec.resultCache = outcome;
  return {
    ok: true,
    spec,
    result: {
      ok: true,
      table: content.meta.name,
      observations: outcome.observations,
      subgroups: outcome.subgroups,
      nested: outcome,
      analysisId: spec.id,
    },
  };
}

/** Build a nestedOneWayAnova spec and run it. Read whole, no params. */
export function buildNestedAnova(
  content: DataHubDocContent,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<NestedAnovaToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isNestedTable(content) || !hasNestedData(content)) {
    return { ok: false, error: NESTED_NOT_NESTED_ERROR };
  }
  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "nestedOneWayAnova",
    params: {},
    inputs: { columnIds: [] },
    resultCache: null,
    resultStale: false,
  };
  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "nestedOneWayAnova") {
    return { ok: false, error: "The engine did not return a nested ANOVA." };
  }
  spec.resultCache = outcome;
  return {
    ok: true,
    spec,
    result: {
      ok: true,
      table: content.meta.name,
      observations: outcome.observations,
      subgroups: outcome.subgroups,
      nested: outcome,
      analysisId: spec.id,
    },
  };
}

export function describeNestedTTest(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const content = getCachedTableContent(parseNestedArgs(args).tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  return {
    summary: `run a nested t-test${where}`,
    stepPayload: stepPayloadFor({
      toolName: "run_nested_ttest",
      iconName: "chart",
      title: "Run a nested t-test",
      ...(content ? { subtitle: `on ${content.meta.name}` } : {}),
      name: "Nested t-test",
      blurb: "Compare two groups while accounting for subgroup clustering.",
      params: content ? [{ label: "Table", value: content.meta.name }] : [],
      previewLines: ["Reports the difference with CI, the variance components, and the test that respects the nesting."],
    }),
  };
}

export function describeNestedAnova(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const content = getCachedTableContent(parseNestedArgs(args).tableId);
  const where = content ? ` on ${content.meta.name}` : "";
  return {
    summary: `run a nested one-way ANOVA${where}`,
    stepPayload: stepPayloadFor({
      toolName: "run_nested_anova",
      iconName: "chart",
      title: "Run a nested one-way ANOVA",
      ...(content ? { subtitle: `on ${content.meta.name}` } : {}),
      name: "Nested one-way ANOVA",
      blurb: "Compare three or more groups against their subgroup-level variation.",
      params: content ? [{ label: "Table", value: content.meta.name }] : [],
      previewLines: ["Reports the omnibus F with its df and p, the variance components, and whether the design is balanced."],
    }),
  };
}

export const runNestedTTestTool: AiTool = {
  name: "run_nested_ttest",
  description:
    "Run a nested (hierarchical) t-test on a Nested table, store the result, and take the user to it. Use this when the user compares TWO groups whose measurements are clustered in subgroups (technical replicates within biological replicates, cells within animals, wells within plates), so the replicates are not independent and a plain t-test would pseudo-replicate. The table must be a Nested table (top-level groups, each holding subgroups, each holding replicate values) with exactly two top-level groups. Call list_datahub_tables first to get the table id. The table is read whole, there is nothing to pick but the table id. The engine fits a random-intercept model by REML and reports the group difference with its 95% CI, the z and p that respect the nesting, the between-subgroup and within-subgroup variance components, and the subgroup and observation counts. You NEVER compute a difference, a p-value, or a variance component, the engine does. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the difference with its CI and the p, and note the variance is split into a subgroup and a residual component. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Nested Data Hub table to test, from a list_datahub_tables result.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  previewable: true,
  describeAction: describeNestedTTest,
  execute: async (args) => {
    const parsed = parseNestedArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the Nested table id.",
      } satisfies NestedTTestToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies NestedTTestToolResult;
    }
    cacheTableContent(parsed.tableId, content);
    const built = buildNestedTTest(content);
    if (!built.ok) return { ok: false, error: built.error } satisfies NestedTTestToolResult;
    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The nested t-test computed but could not be saved to the table. The result is not stored.",
      } satisfies NestedTTestToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies NestedTTestToolResult;
  },
};

export const runNestedAnovaTool: AiTool = {
  name: "run_nested_anova",
  description:
    "Run a nested (hierarchical) one-way ANOVA on a Nested table, store the result, and take the user to it. Use this when the user compares THREE OR MORE groups whose measurements are clustered in subgroups (technical replicates within biological replicates, cells within animals), so the omnibus must test the group effect against the subgroup-level variation rather than pseudo-replicating. The table must be a Nested table (top-level groups, each holding subgroups, each holding replicate values) with three or more top-level groups. Call list_datahub_tables first to get the table id. The table is read whole, there is nothing to pick but the table id. A balanced design uses the exact classic random-effects F (group mean square over the subgroup-within-group mean square); an unbalanced design falls back to a REML mixed-model omnibus, and the engine reports which route it used. It returns the omnibus F with its two df and p, the classic nested-ANOVA table, the between-subgroup and within-subgroup variance components, and the subgroup and observation counts. You NEVER compute an F, a p-value, or a variance component, the engine does. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, the F with its df and p and whether the design was balanced (the classic-F or mixed-model route), and that the variance is split into a subgroup and a residual component. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Nested Data Hub table to test, from a list_datahub_tables result.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  previewable: true,
  describeAction: describeNestedAnova,
  execute: async (args) => {
    const parsed = parseNestedArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the Nested table id.",
      } satisfies NestedAnovaToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies NestedAnovaToolResult;
    }
    cacheTableContent(parsed.tableId, content);
    const built = buildNestedAnova(content);
    if (!built.ok) return { ok: false, error: built.error } satisfies NestedAnovaToolResult;
    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The nested ANOVA computed but could not be saved to the table. The result is not stored.",
      } satisfies NestedAnovaToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies NestedAnovaToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_roc_curve (XY table with a binary outcome, maps to the rocCurve engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_roc_curve. The arg shape mirrors
 *  run_logistic_regression exactly (the engine reads the SAME XY shape). */
export type RocCurveArgs = {
  tableId: string;
  /** The binary (0/1) outcome column, by name or id. The score is the X column. */
  yColumn?: string;
};

/** The compact result run_roc_curve relays. The engine computed every number
 *  here; the model only repeats them, never an AUC or a threshold of its own. */
export type RocCurveToolResult =
  | {
      ok: true;
      table: string;
      xName: string;
      yName: string;
      n: number;
      nPositive: number;
      nNegative: number;
      auc: number;
      aucCiLow: number;
      aucCiHigh: number;
      youdenThreshold: number;
      youdenSensitivity: number;
      youdenSpecificity: number;
      /** The full normalized ROC result (AUC + CI, Youden cut point, the curve). */
      roc: Extract<RunOutcome, { kind: "rocCurve" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed RocCurveArgs. Pure. Mirrors
 *  parseLogisticRegressionArgs (the ROC reads the same XY shape). */
export function parseRocCurveArgs(args: Record<string, unknown>): RocCurveArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    yColumn:
      typeof args.yColumn === "string" && args.yColumn.trim() ? args.yColumn.trim() : undefined,
  };
}

/**
 * Build a rocCurve spec for the request against live content and run it through
 * the SAME runAnalysis path the wizard uses. ROC reads the binary-outcome XY
 * shape exactly like simple logistic regression (a continuous score X plus a 0/1
 * outcome Y), so this mirrors buildLogisticRegression, inputs.columnIds = [yId]
 * (the binary outcome) and the score is the table's X column. The engine sweeps
 * the thresholds and computes the AUC; the model only picks which Y is the
 * outcome. Pure given the content.
 */
export function buildRocCurve(
  content: DataHubDocContent,
  parsed: RocCurveArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<RocCurveToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (!isXYTable(content)) {
    return {
      ok: false,
      error:
        "An ROC curve runs on an XY table (a continuous score X plus a binary 0/1 outcome Y), and that table is not one. Pick an XY table.",
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
    type: "rocCurve",
    params: {},
    inputs: { columnIds: [yId] },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "rocCurve") {
    return { ok: false, error: "The engine did not return an ROC curve." };
  }
  spec.resultCache = outcome;

  const result: Extract<RocCurveToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    xName: outcome.xName,
    yName: outcome.yName,
    n: outcome.n,
    nPositive: outcome.nPositive,
    nNegative: outcome.nNegative,
    auc: outcome.auc,
    aucCiLow: outcome.aucCiLow,
    aucCiHigh: outcome.aucCiHigh,
    youdenThreshold: outcome.youdenThreshold,
    youdenSensitivity: outcome.youdenSensitivity,
    youdenSpecificity: outcome.youdenSpecificity,
    roc: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the step-review card, built from the args + cached
 *  content without running the curve. Mirrors describeLogisticRegression and
 *  emits a stepPayload even with no cached content. */
export function describeRocCurve(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseRocCurveArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    return {
      summary: "trace an ROC curve and AUC on a Data Hub table",
      stepPayload: stepPayloadFor({
        toolName: "run_roc_curve",
        iconName: "growth",
        title: "Trace an ROC curve",
        name: "ROC curve and AUC",
        blurb: "Sweep the score thresholds and read out the AUC.",
        params: [],
      }),
    };
  }
  const yId = resolveYColumnId(content, parsed.yColumn);
  const yName =
    (yId && yColumns(content).find((c) => c.id === yId)?.name) || "the outcome";
  return {
    summary: `ROC curve of ${yName} against the X column in ${content.meta.name}`,
    stepPayload: stepPayloadFor({
      toolName: "run_roc_curve",
      iconName: "growth",
      title: `ROC curve of ${yName}`,
      subtitle: `against the X column in ${content.meta.name}`,
      name: "ROC curve and AUC",
      blurb: `Sweep the score thresholds for the 0/1 outcome ${yName}.`,
      params: [
        { label: "Outcome", value: yName },
        { label: "Score", value: "the table's X column" },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports the AUC with CI and the Youden cut point with its sensitivity and specificity."],
    }),
  };
}

export const runRocCurveTool: AiTool = {
  name: "run_roc_curve",
  description:
    "Trace an ROC curve and its AUC on an XY table (how well a continuous score separates a binary 0/1 outcome), store the result, and take the user to it. Use this when the user wants to judge a score, marker, or test as a classifier (for example \"ROC curve of the biomarker for disease\", \"what is the AUC of this score\", \"find the best cutoff\"). Call list_datahub_tables first to get the XY table id, then pass the binary Y column to use as the outcome (the score is the table's X column). Omit yColumn to use the first Y column. The Y column must hold a binary 0/1 outcome. The engine sweeps every score threshold and reports the AUC with its Hanley-McNeil 95% CI, the counts of positives and negatives, and the optimal cut point by Youden's J with its sensitivity and specificity. You NEVER compute an AUC, a threshold, a sensitivity, or a specificity, the engine does, and it drops any row whose outcome is not exactly 0 or 1; relay any error message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the curve. After it returns, give ONE short line, the AUC with its CI and the Youden threshold with its sensitivity and specificity. If the returned n is much smaller than the table (rows whose outcome was not 0/1 were dropped), say so. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the XY Data Hub table to score, from a list_datahub_tables result.",
      },
      yColumn: {
        type: "string",
        description:
          "The binary (0/1) outcome column, by name or id. Omit to use the first Y column. The score (predictor) is the table's X column.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_logistic_regression). Step mode previews
  // the curve; plan mode runs it free.
  previewable: true,
  describeAction: describeRocCurve,
  execute: async (args) => {
    const parsed = parseRocCurveArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the XY table id.",
      } satisfies RocCurveToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies RocCurveToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildRocCurve(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies RocCurveToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The ROC curve computed but could not be saved to the table. The result is not stored.",
      } satisfies RocCurveToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies RocCurveToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_repeated_measures_anova (row-paired Column table, repeatedMeasuresAnova)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_repeated_measures_anova. */
export type RmAnovaArgs = {
  tableId: string;
  /** The within-subject condition columns, by name or id (three or more). Each
   *  row is the same subject measured under every condition. Omit for every
   *  group column. */
  conditions?: string[];
};

/** The compact result run_repeated_measures_anova relays. The engine computed
 *  every number; the model only repeats them. */
export type RmAnovaToolResult =
  | {
      ok: true;
      table: string;
      conditionNames: string[];
      subjects: number;
      conditions: number;
      fStatistic: number;
      pValue: number;
      dfConditions: number;
      dfError: number;
      partialEtaSquared: number;
      greenhouseGeisserEpsilon: number;
      pGreenhouseGeisser: number;
      huynhFeldtEpsilon: number;
      pHuynhFeldt: number;
      /** The full normalized result (per-condition means + the ANOVA table). */
      rmAnova: Extract<RunOutcome, { kind: "rmAnova" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed RmAnovaArgs. Pure. */
export function parseRmAnovaArgs(args: Record<string, unknown>): RmAnovaArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    conditions: Array.isArray(args.conditions)
      ? args.conditions.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

/**
 * Build a repeatedMeasuresAnova spec for the request against live content and run
 * it through the SAME runAnalysis path the wizard uses. The engine reads the
 * selected condition columns ALIGNED BY ROW (each row a subject), so the spec
 * carries the condition column ids in inputs.columnIds in order, resolved the same
 * way the means family resolves group columns. No params. The engine runs the
 * within-subject F and the sphericity corrections; the model only picks which
 * columns are the conditions. Pure given the content.
 */
export function buildRmAnova(
  content: DataHubDocContent,
  parsed: RmAnovaArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<RmAnovaToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (groupColumns(content).length === 0) {
    return {
      ok: false,
      error:
        "Repeated-measures ANOVA runs on a Column table whose columns are within-subject conditions, and that table has no measurement columns. Pick a Column table.",
    };
  }
  const columnIds = resolveColumnIds(content, parsed.conditions);
  if (columnIds.length < 3) {
    return {
      ok: false,
      error:
        "Repeated-measures ANOVA needs at least 3 condition columns measured on the same subjects. Name three or more condition columns, or check the table has that many groups.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "repeatedMeasuresAnova",
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "rmAnova") {
    return { ok: false, error: "The engine did not return a repeated-measures ANOVA." };
  }
  spec.resultCache = outcome;

  const result: Extract<RmAnovaToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    conditionNames: outcome.groups.map((g) => g.name),
    subjects: outcome.subjects,
    conditions: outcome.conditions,
    fStatistic: outcome.statistic,
    pValue: outcome.pValue,
    dfConditions: outcome.dfConditions,
    dfError: outcome.dfError,
    partialEtaSquared: outcome.partialEtaSquared,
    greenhouseGeisserEpsilon: outcome.greenhouseGeisserEpsilon,
    pGreenhouseGeisser: outcome.pGreenhouseGeisser,
    huynhFeldtEpsilon: outcome.huynhFeldtEpsilon,
    pHuynhFeldt: outcome.pHuynhFeldt,
    rmAnova: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** A shared describer body for the two within-subject tools (rm-ANOVA + mixed
 *  model), which read the SAME row-paired Column table of condition columns.
 *  Resolves the condition names where the content is cached, and falls back to a
 *  generic line otherwise, always emitting a stepPayload. */
function describeWithinSubject(
  toolName: "run_repeated_measures_anova" | "run_mixed_model",
  title: string,
  name: string,
  blurb: string,
  previewLine: string,
  args: Record<string, unknown>,
): { summary: string; stepPayload?: StepApprovalRequest } {
  const tableId = typeof args.tableId === "string" ? args.tableId : "";
  const conditions = Array.isArray(args.conditions)
    ? args.conditions.filter((c): c is string => typeof c === "string")
    : undefined;
  const content = getCachedTableContent(tableId);
  if (!content) {
    return {
      summary: `${blurb} on a Data Hub table`,
      stepPayload: stepPayloadFor({
        toolName,
        iconName: "chart",
        title,
        name,
        blurb,
        params: [],
      }),
    };
  }
  const ids = resolveColumnIds(content, conditions);
  const byId = new Map(groupColumns(content).map((c) => [c.id, c.name]));
  const condNames = ids.map((id) => byId.get(id) ?? id).join(", ");
  const where = ` in ${content.meta.name}`;
  return {
    summary: condNames
      ? `${blurb} across ${condNames}${where}`
      : `${blurb}${where}`,
    stepPayload: stepPayloadFor({
      toolName,
      iconName: "chart",
      title,
      subtitle: `across ${condNames || "the conditions"}${where}`,
      name,
      blurb,
      params: [
        ...(condNames ? [{ label: "Conditions", value: condNames }] : []),
        { label: "Table", value: content.meta.name },
      ],
      previewLines: [previewLine],
    }),
  };
}

/** Sync one-line preview for the run_repeated_measures_anova step. */
export function describeRmAnova(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  return describeWithinSubject(
    "run_repeated_measures_anova",
    "Repeated-measures ANOVA",
    "One-way repeated-measures ANOVA",
    "compare the same subjects across conditions",
    "Reports the within-subject F and p, the Greenhouse-Geisser corrected p, and partial eta-squared.",
    args,
  );
}

export const runRepeatedMeasuresAnovaTool: AiTool = {
  name: "run_repeated_measures_anova",
  description:
    "Run a one-way repeated-measures ANOVA on a Column table whose columns are within-subject conditions (the same subjects measured under three or more conditions, one subject per row), store the result, and take the user to it. Use this when the same subjects are measured repeatedly and the user wants to compare the condition means (for example \"compare the baseline, week 4, and week 8 measurements on the same mice\", \"repeated-measures ANOVA across the three timepoints\"). Call list_datahub_tables first to get the table id and the real column names, then pass three or more condition columns; omit conditions to use every group column. Each ROW must be one subject measured under every condition (the engine aligns the columns by row and keeps complete cases only). The engine runs the within-subject F test and both sphericity corrections; it reports the uncorrected F with its df and p, partial eta-squared, and the Greenhouse-Geisser and Huynh-Feldt epsilons with their corrected p-values. You NEVER compute an F, a p, an epsilon, or an eta-squared, the engine does, and it errors cleanly with fewer than 3 conditions or too few complete subjects; relay that message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the result. After it returns, give ONE short line, the F and p, the Greenhouse-Geisser corrected p (use it when sphericity is in doubt), and partial eta-squared. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Column Data Hub table whose columns are within-subject conditions, from a list_datahub_tables result.",
      },
      conditions: {
        type: "array",
        items: { type: "string" },
        description:
          "The within-subject condition columns, by name or id, in order (three or more). Each row must be the same subject measured under every condition. Omit to use every group column in the table.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // run; plan mode runs it free.
  previewable: true,
  describeAction: describeRmAnova,
  execute: async (args) => {
    const parsed = parseRmAnovaArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the table id.",
      } satisfies RmAnovaToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies RmAnovaToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildRmAnova(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies RmAnovaToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The repeated-measures ANOVA computed but could not be saved to the table. The result is not stored.",
      } satisfies RmAnovaToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies RmAnovaToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_mixed_model (row-paired Column table, maps to the linearMixedModel engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_mixed_model. Same row-paired Column shape as
 *  the repeated-measures ANOVA. */
export type MixedModelArgs = {
  tableId: string;
  /** The within-subject condition columns, by name or id (two or more). Omit for
   *  every group column. */
  conditions?: string[];
};

/** The compact result run_mixed_model relays. The engine computed every number;
 *  the model only repeats them. */
export type MixedModelToolResult =
  | {
      ok: true;
      table: string;
      conditionNames: string[];
      subjects: number;
      observations: number;
      groupVariance: number;
      residualVariance: number;
      remlLogLikelihood: number;
      /** The full normalized result (each fixed effect with CI + p, variances). */
      mixedModel: Extract<RunOutcome, { kind: "mixedModel" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed MixedModelArgs. Pure. */
export function parseMixedModelArgs(args: Record<string, unknown>): MixedModelArgs {
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    conditions: Array.isArray(args.conditions)
      ? args.conditions.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

/**
 * Build a linearMixedModel spec for the request against live content and run it
 * through the SAME runAnalysis path the wizard uses. The engine reads the same
 * row-paired Column table the repeated-measures ANOVA reads (each row a subject,
 * each selected column a within-subject condition), reshapes it to long form, and
 * fits a random-intercept REML model. So the spec carries the condition column
 * ids in inputs.columnIds, resolved the same way, with no params. The engine fits
 * the model; the model only picks which columns are the conditions. Pure given
 * the content.
 */
export function buildMixedModel(
  content: DataHubDocContent,
  parsed: MixedModelArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<MixedModelToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (groupColumns(content).length === 0) {
    return {
      ok: false,
      error:
        "A linear mixed model runs on a Column table whose columns are within-subject conditions, and that table has no measurement columns. Pick a Column table.",
    };
  }
  const columnIds = resolveColumnIds(content, parsed.conditions);
  if (columnIds.length < 2) {
    return {
      ok: false,
      error:
        "A linear mixed model needs at least 2 condition columns measured on the same subjects. Name two or more condition columns, or check the table has that many groups.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "linearMixedModel",
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "mixedModel") {
    return { ok: false, error: "The engine did not return a linear mixed model." };
  }
  spec.resultCache = outcome;

  const result: Extract<MixedModelToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    conditionNames: outcome.groups.map((g) => g.name),
    subjects: outcome.subjects,
    observations: outcome.observations,
    groupVariance: outcome.groupVariance,
    residualVariance: outcome.residualVariance,
    remlLogLikelihood: outcome.remlLogLikelihood,
    mixedModel: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the run_mixed_model step. */
export function describeMixedModel(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  return describeWithinSubject(
    "run_mixed_model",
    "Linear mixed model",
    "Random-intercept linear mixed model",
    "model the same subjects across conditions",
    "Reports each fixed effect with its CI and p, plus the group and residual variance components.",
    args,
  );
}

export const runMixedModelTool: AiTool = {
  name: "run_mixed_model",
  description:
    "Fit a random-intercept linear mixed model on a Column table whose columns are within-subject conditions (the same subjects measured under two or more conditions, one subject per row), store the result, and take the user to it. Use this when the same subjects are measured repeatedly and the user wants the condition effects with a per-subject random intercept (for example \"mixed model of the response across the three doses, random intercept per animal\", \"linear mixed model with subject as a random effect\"). It is the model-based companion to repeated-measures ANOVA, and it handles unbalanced or missing cells more gracefully. Call list_datahub_tables first to get the table id and the real column names, then pass two or more condition columns; omit conditions to use every group column. Each ROW must be one subject measured under every condition (the engine reshapes the columns to long form, with the first condition as the reference). The engine fits the model by REML and reports the intercept (the reference-condition mean) and one fixed effect per non-reference condition (its difference from the reference), each with a Wald SE, z, two-sided p, and 95% CI, plus the random-intercept group variance, the residual variance, and the REML log-likelihood. You NEVER compute a coefficient, a p-value, or a variance component, the engine does, and it errors cleanly with fewer than 2 conditions or too few complete subjects; relay that message. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the fit. After it returns, give ONE short line, each fixed-effect estimate with its CI and p, and the group and residual variance components. Never invent a number, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Column Data Hub table whose columns are within-subject conditions, from a list_datahub_tables result.",
      },
      conditions: {
        type: "array",
        items: { type: "string" },
        description:
          "The within-subject condition columns, by name or id, in order (two or more, the first is the reference). Each row must be the same subject measured under every condition. Omit to use every group column in the table.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // fit; plan mode runs it free.
  previewable: true,
  describeAction: describeMixedModel,
  execute: async (args) => {
    const parsed = parseMixedModelArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the table id.",
      } satisfies MixedModelToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies MixedModelToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildMixedModel(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies MixedModelToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The mixed model computed but could not be saved to the table. The result is not stored.",
      } satisfies MixedModelToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies MixedModelToolResult;
  },
};

// ---------------------------------------------------------------------------
// run_grubbs_outliers (Column table, maps to the grubbsOutlier engine)
// ---------------------------------------------------------------------------

/** The model-supplied args for run_grubbs_outliers. */
export type GrubbsOutliersArgs = {
  tableId: string;
  /** The columns to screen, by name or id. Omit to screen every group column. */
  columns?: string[];
  /** The significance level, 0.05 (default) or 0.01. */
  alpha: 0.05 | 0.01;
  /** True (the default) to sweep iteratively, false for a single pass. */
  iterative: boolean;
};

/** The compact result run_grubbs_outliers relays. The engine computed every
 *  flag; the model only repeats them. */
export type GrubbsOutliersToolResult =
  | {
      ok: true;
      table: string;
      alpha: number;
      iterative: boolean;
      totalOutliers: number;
      /** A per-column summary the model relays (name + the flagged values). */
      columns: { name: string; n: number; cleanedN: number; outlierValues: number[] }[];
      /** The full normalized result (every column's steps + cleaned n). */
      grubbs: Extract<RunOutcome, { kind: "grubbsOutlier" }>;
      analysisId: string;
    }
  | { ok: false; error: string };

/** Parse the loose args into typed GrubbsOutliersArgs, defaulting to the standard
 *  Grubbs sweep (alpha 0.05, iterative). Pure. */
export function parseGrubbsOutliersArgs(args: Record<string, unknown>): GrubbsOutliersArgs {
  // The engine reads alpha as the STRING "0.01" (anything else is 0.05) and an
  // iterative sweep unless params.mode === "single". We accept a number or a
  // string from the model and normalize here.
  const rawAlpha = args.alpha;
  const alpha: 0.05 | 0.01 =
    rawAlpha === 0.01 || rawAlpha === "0.01" ? 0.01 : 0.05;
  return {
    tableId: typeof args.tableId === "string" ? args.tableId : "",
    columns: Array.isArray(args.columns)
      ? args.columns.filter((c): c is string => typeof c === "string")
      : undefined,
    alpha,
    // Default iterative true; only an explicit false turns the sweep off.
    iterative: args.iterative !== false,
  };
}

/**
 * Build a grubbsOutlier spec for the request against live content and run it
 * through the SAME runAnalysis path the wizard uses. The engine screens each
 * selected column on its own (each is a separate sample), so the spec carries the
 * column ids in inputs.columnIds. The two knobs live in the params bag the way the
 * engine reads them, alpha as the string "0.01" or "0.05" and mode "single" for a
 * single pass (omitted for the default iterative sweep). The engine flags the
 * outliers; the model only picks the columns and the settings. Pure given the
 * content.
 */
export function buildGrubbsOutliers(
  content: DataHubDocContent,
  parsed: GrubbsOutliersArgs,
):
  | { ok: true; spec: AnalysisSpec; result: Extract<GrubbsOutliersToolResult, { ok: true }> }
  | { ok: false; error: string } {
  if (groupColumns(content).length === 0) {
    return {
      ok: false,
      error:
        "Grubbs outlier detection runs on a Column table of measurement columns, and that table has none. Pick a Column table.",
    };
  }
  const columnIds = resolveColumnIds(content, parsed.columns);
  if (columnIds.length < 1) {
    return {
      ok: false,
      error:
        "I need at least one column to screen for outliers. Name a column, or check the table has a measurement column.",
    };
  }

  const spec: AnalysisSpec = {
    id: `analysis-${Date.now()}`,
    type: "grubbsOutlier",
    // The engine reads alpha as the string "0.01" (else 0.05) and runs the
    // iterative sweep unless mode is "single", so encode exactly that.
    params: {
      alpha: parsed.alpha === 0.01 ? "0.01" : "0.05",
      ...(parsed.iterative ? {} : { mode: "single" }),
    },
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };

  const outcome = runAnalysis(spec, content);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.kind !== "grubbsOutlier") {
    return { ok: false, error: "The engine did not return a Grubbs outlier screen." };
  }
  spec.resultCache = outcome;

  const result: Extract<GrubbsOutliersToolResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    alpha: outcome.alpha,
    iterative: outcome.iterative,
    totalOutliers: outcome.totalOutliers,
    columns: outcome.columns.map((c) => ({
      name: c.name,
      n: c.result.n,
      cleanedN: c.result.cleanedN,
      outlierValues: c.result.outlierValues,
    })),
    grubbs: outcome,
    analysisId: spec.id,
  };
  return { ok: true, spec, result };
}

/** Sync one-line preview for the run_grubbs_outliers step, built from the args +
 *  cached content without running the screen. Mirrors the other describers, and
 *  emits a stepPayload even with no cached content. */
export function describeGrubbsOutliers(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseGrubbsOutliersArgs(args);
  const content = getCachedTableContent(parsed.tableId);
  const alphaPhrase = `alpha ${parsed.alpha}`;
  const passPhrase = parsed.iterative ? "iterative" : "single-pass";
  if (!content) {
    return {
      summary: `screen a Data Hub table for outliers (Grubbs, ${alphaPhrase}, ${passPhrase})`,
      stepPayload: stepPayloadFor({
        toolName: "run_grubbs_outliers",
        iconName: "chart",
        title: "Screen for outliers",
        name: "Grubbs outlier test",
        blurb: "Flag the statistical outliers in each column.",
        params: [
          { label: "Alpha", value: String(parsed.alpha) },
          { label: "Sweep", value: passPhrase },
        ],
      }),
    };
  }
  const ids = resolveColumnIds(content, parsed.columns);
  const byId = new Map(groupColumns(content).map((c) => [c.id, c.name]));
  const colNames = ids.map((id) => byId.get(id) ?? id).join(", ");
  return {
    summary: `screen ${colNames || "the columns"} in ${content.meta.name} for outliers (Grubbs, ${alphaPhrase}, ${passPhrase})`,
    stepPayload: stepPayloadFor({
      toolName: "run_grubbs_outliers",
      iconName: "chart",
      title: "Screen for outliers",
      subtitle: `${colNames || "the columns"} in ${content.meta.name}`,
      name: "Grubbs outlier test",
      blurb: "Flag the statistical outliers in each column.",
      params: [
        ...(colNames ? [{ label: "Columns", value: colNames }] : []),
        { label: "Alpha", value: String(parsed.alpha) },
        { label: "Sweep", value: passPhrase },
        { label: "Table", value: content.meta.name },
      ],
      previewLines: ["Reports how many outliers were flagged and which values, per column."],
    }),
  };
}

export const runGrubbsOutliersTool: AiTool = {
  name: "run_grubbs_outliers",
  description:
    "Screen a Column table for statistical outliers with Grubbs' test, store the result, and take the user to it. Use this when the user wants to find or flag outliers in their data (for example \"are there any outliers in the control column\", \"run Grubbs on these replicates\", \"clean the outliers out of this measurement\"). Call list_datahub_tables first to get the table id and the real column names, then pass the columns to screen; omit columns to screen every group column. Each column is screened on its own (each is a separate sample). Pass alpha (0.05 the default, or 0.01 for a stricter screen) and iterative (true the default, sweeps repeatedly removing the most extreme point until none is flagged; false for a single pass that flags at most one point). The engine computes the Grubbs G statistic and the critical value at each step and flags the outliers; it reports how many outliers were flagged in total and, per column, the original n, the flagged outlier values, and the cleaned n. You NEVER decide an outlier yourself or compute a G statistic, the engine does, and it errors cleanly when a column has too few values to screen; relay that message naming the column. This runs straight away, there is NO separate approval step, so do not call propose_plan for it. It saves the result as a version-controlled analysis, navigates the user to the Data Hub so they see it, and returns the screen. After it returns, give ONE short line, how many outliers were flagged and which columns and values; if none were flagged, say so plainly. Removing the flagged points is the user's call, not yours. Never invent a value, only repeat what this returns.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description: "The id of the Column Data Hub table to screen, from a list_datahub_tables result.",
      },
      columns: {
        type: "array",
        items: { type: "string" },
        description:
          "The columns to screen for outliers, by name or id. Each is screened on its own. Omit to screen every group column in the table.",
      },
      alpha: {
        type: "number",
        description:
          "The significance level for the test, 0.05 (the default) or 0.01 (a stricter screen). Only these two values are supported.",
      },
      iterative: {
        type: "boolean",
        description:
          "True (the default) to sweep iteratively, removing the most extreme point and re-testing until none is flagged. False for a single pass that flags at most one point.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // Previewable, not an action (see run_datahub_analysis). Step mode previews the
  // screen; plan mode runs it free.
  previewable: true,
  describeAction: describeGrubbsOutliers,
  execute: async (args) => {
    const parsed = parseGrubbsOutliersArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error: "No table was given. Call list_datahub_tables first and pass the table id.",
      } satisfies GrubbsOutliersToolResult;
    }
    const content = await datahubAnalysisDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error: "I could not open that table. It may have been deleted, or the id is wrong.",
      } satisfies GrubbsOutliersToolResult;
    }
    cacheTableContent(parsed.tableId, content);

    const built = buildGrubbsOutliers(content, parsed);
    if (!built.ok) return { ok: false, error: built.error } satisfies GrubbsOutliersToolResult;

    const stored = await datahubAnalysisDeps.persistAnalysis(parsed.tableId, built.spec);
    if (!stored) {
      return {
        ok: false,
        error: "The outlier screen computed but could not be saved to the table. The result is not stored.",
      } satisfies GrubbsOutliersToolResult;
    }
    datahubAnalysisDeps.navigate(`/datahub?doc=${parsed.tableId}&analysis=${built.result.analysisId}`);
    return built.result satisfies GrubbsOutliersToolResult;
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
