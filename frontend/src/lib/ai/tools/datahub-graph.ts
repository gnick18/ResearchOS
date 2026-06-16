// BeakerBot Data Hub graph tool (ai datahub-graph bot, 2026-06-11).
//
// The plot analog of run_datahub_analysis. It turns a natural-language request
// ("make a bar chart of fakeGFP expression with SEM error bars", "plot the
// growth curve") into a real Data Hub publication figure, through the SAME
// validated plot-spec engine the Graphs editor uses, then lands the user on the
// figure.
//
// The division of labor is the whole point, same as the analysis tool. The LLM
// ORCHESTRATES, it maps the user's words onto a real table, a real graph kind,
// and the error-bar choice. The ENGINE BUILDS THE FIGURE, every bar height,
// mean line, error-bar cap, jittered point, and axis tick comes from
// lib/datahub/plot-spec (buildPlotSpec + the geometry layout), never from the
// model. The model never computes or invents a plotted value.
//
// One tool, make_datahub_graph (NON-gated). It builds a PlotSpec through
// buildPlotSpec + withStyle, stores it in the table's Loro doc (a new,
// reversible, version-controlled plot, the editor's exact write path), and
// navigates the user to that stored figure in the Data Hub. It carries no
// `action` flag for the same reason run_datahub_analysis does not, the write is
// non-destructive and the user already consented by asking for the chart in
// words (and picking the kind / error bar through ask_user when it mattered). A
// second "Allow it?" on top of that is redundant friction.
//
// The table lister is REUSED (list_datahub_tables from datahub-analysis.ts), so
// the model picks the table and the columns from the same compact briefs it
// already uses for analyses, no second catalog tool.
//
// After storing, execute navigates the user to
// /datahub?doc=<tableId>&plot=<plotId> so they land ON the figure (the Graphs
// view of that plot), not the raw data grid. The navigation is hard-wired here
// through the injectable navigate seam (default requestNavigation), not left to
// the model, so it is reliable.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { requestNavigation } from "@/components/ai/navigation-bridge";
import { analysisResultInChat } from "./analysis-presentation";
import { openDataHubDoc, type DataHubDocHandle } from "@/lib/loro/datahub-store";
import {
  getDataHubContent,
  setPlot as setPlotInDoc,
} from "@/lib/loro/datahub-doc";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { groupColumns } from "@/lib/datahub/column-table";
import {
  buildPlotSpec,
  withStyle,
  type ErrorBarKind,
  type PlotKind,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import type { AiTool, StepApprovalRequest } from "./types";
// Reuse the analysis tools' content cache (filled by list_datahub_tables) so the
// sync graph preview can read the table's columns without an await.
import { getCachedTableContent } from "./datahub-analysis";

// ---------------------------------------------------------------------------
// Injectable seam (so the tool unit-tests with no folder and no Loro).
// ---------------------------------------------------------------------------

/**
 * The data-layer reads make_datahub_graph depends on, injected so a test can
 * stub the doc reads and the write without a real folder. Production wires the
 * real store. resolveContent opens the doc and projects its content;
 * persistPlot opens the doc, writes the plot, and flushes, mirroring the
 * page.tsx handleNewGraph write path exactly (open -> setPlot -> commit).
 */
export type DataHubGraphDeps = {
  /** Project a table's live content by id (null when it cannot be opened). */
  resolveContent: (id: string) => Promise<DataHubDocContent | null>;
  /** Open the doc, write the spec, flush. Returns true on success. */
  persistPlot: (id: string, spec: PlotSpec) => Promise<boolean>;
  /** Take the user to a stored figure by soft-navigating to an internal path.
   *  Defaults to the navigation bridge so the build lands the user on the Data
   *  Hub figure. Injected so a test asserts the navigation without a router. */
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

async function defaultPersistPlot(
  id: string,
  spec: PlotSpec,
): Promise<boolean> {
  try {
    const owner = await getCurrentUserCached();
    const handle: DataHubDocHandle = await openDataHubDoc(owner, id);
    setPlotInDoc(handle.doc, spec);
    // Flush rather than the debounced commit so the write lands before the tool
    // returns (we immediately navigate the user to the stored figure).
    await handle.flush();
    return true;
  } catch {
    return false;
  }
}

export const datahubGraphDeps: DataHubGraphDeps = {
  resolveContent: defaultResolveContent,
  persistPlot: defaultPersistPlot,
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Argument parsing + the model-facing graph type
// ---------------------------------------------------------------------------

/**
 * The model-facing graph type, kept small and plain. "dot" is the Prism column
 * dot plot (individual points over a mean line, the default), "bar" is a bar to
 * the mean, and "estimation" is the modern effect-size figure (the bootstrap
 * mean-difference with its confidence interval, the alternative to the bar with
 * significance stars). "dot" and "bar" map onto the engine's column PlotKind;
 * "estimation" resolves by GROUP COUNT to one of the two estimation kinds
 * (Gardner-Altman for two groups, Cumming for three or more), so the model never
 * has to know the internal kind names.
 */
export type GraphType = "dot" | "bar" | "estimation";

/** The bootstrap CI method an estimation figure can ask for (the engine default
 *  is "bca", DABEST's default; "percentile" is the simpler alternative). Drawn
 *  from the engine's own PlotStyle so the option set never drifts. */
export type BootstrapMethodOption = NonNullable<PlotStyle["estimationBootMethod"]>;

/** The model-supplied arguments, before mapping to a PlotSpec. */
export type MakeGraphArgs = {
  tableId: string;
  /** "dot" (the default) for a column dot plot, "bar" for a bar chart, or
   *  "estimation" for an effect-size-with-CI figure. */
  type: GraphType;
  /** Which error bar to draw, computed by the engine from the raw replicates. */
  errorBar: ErrorBarKind;
  /** The group columns to plot, by name or id. Omit to plot every group. */
  columns?: string[];
  /** Draw each raw replicate as a jittered point (default true for a dot plot). */
  showPoints?: boolean;
  /** Optional figure title. */
  title?: string;
  /**
   * Dot / bar only. Draw significance brackets (stars) over the bars from a
   * stored one-way ANOVA's Tukey comparisons, exactly the NewGraphDialog
   * "use brackets" toggle. The brackets need a one-way ANOVA already saved on
   * the SAME table (run run_datahub_analysis first); the build links that stored
   * analysis by id so the engine, not the model, draws the stars. Ignored for an
   * estimation figure (which carries its own effect-size CI instead).
   */
  significanceBrackets?: boolean;
  /**
   * Estimation-only. The control group (by name or id) the differences are taken
   * against. Resolved to its index in the plotted column order; omit to use the
   * first plotted group.
   */
  control?: string;
  /**
   * Estimation-only. Draw the paired variant (matched slope lines + a paired
   * bootstrap) instead of the unpaired one. Only valid for a two-group
   * (Gardner-Altman) figure; ignored for three or more groups.
   */
  paired?: boolean;
  /** Estimation-only. The CI level the bootstrap reports (0 to 1, default 0.95). */
  ci?: number;
  /** Estimation-only. The bootstrap resample count (default 5000). */
  bootstrapSamples?: number;
  /** Estimation-only. The PRNG seed so the figure redraws bit-for-bit. */
  seed?: number;
  /** Estimation-only. The CI method ("bca" the default, or "percentile"). */
  bootstrapMethod?: BootstrapMethodOption;
};

/**
 * Map the column model graph types onto the engine PlotKind. "estimation" is NOT
 * mapped here because it resolves by group count (see estimationKindForGroups);
 * an "estimation" argument falls back to the column dot plot kind, which the
 * estimation build path overrides before storing.
 */
export function toPlotKind(type: GraphType): PlotKind {
  return type === "bar" ? "columnBar" : "columnScatter";
}

/**
 * Resolve the estimation PlotKind from the plotted group count. Two groups draw a
 * Gardner-Altman figure (one difference panel); three or more draw a Cumming
 * figure (one panel per non-control group sharing the control). This is the only
 * thing that picks between the two estimation kinds, exactly the engine contract.
 */
export function estimationKindForGroups(groupCount: number): PlotKind {
  return groupCount >= 3 ? "estimationCumming" : "estimationGardnerAltman";
}

/** Parse the loose tool args into a typed MakeGraphArgs, defaulting safely. */
export function parseMakeGraphArgs(
  args: Record<string, unknown>,
): MakeGraphArgs {
  const tableId = typeof args.tableId === "string" ? args.tableId : "";
  const type: GraphType =
    args.type === "bar"
      ? "bar"
      : args.type === "estimation"
        ? "estimation"
        : "dot";
  const errorBar: ErrorBarKind =
    args.errorBar === "sd" || args.errorBar === "none"
      ? (args.errorBar as ErrorBarKind)
      : "sem";
  const columns = Array.isArray(args.columns)
    ? args.columns.filter((c): c is string => typeof c === "string")
    : undefined;
  const showPoints =
    typeof args.showPoints === "boolean" ? args.showPoints : undefined;
  const title = typeof args.title === "string" ? args.title : undefined;
  // Estimation-only args. Each is left undefined when absent so the engine's own
  // default applies (the build path only writes a field the model actually set).
  const control = typeof args.control === "string" ? args.control : undefined;
  const paired = typeof args.paired === "boolean" ? args.paired : undefined;
  const ci =
    typeof args.ci === "number" && args.ci > 0 && args.ci < 1
      ? args.ci
      : undefined;
  const bootstrapSamples =
    typeof args.bootstrapSamples === "number" &&
    Number.isFinite(args.bootstrapSamples) &&
    args.bootstrapSamples >= 100
      ? Math.round(args.bootstrapSamples)
      : undefined;
  const seed =
    typeof args.seed === "number" && Number.isFinite(args.seed)
      ? Math.round(args.seed)
      : undefined;
  const bootstrapMethod =
    args.bootstrapMethod === "bca" || args.bootstrapMethod === "percentile"
      ? (args.bootstrapMethod as BootstrapMethodOption)
      : undefined;
  const significanceBrackets = args.significanceBrackets === true;
  return {
    tableId,
    type,
    errorBar,
    columns,
    showPoints,
    title,
    significanceBrackets,
    control,
    paired,
    ci,
    bootstrapSamples,
    seed,
    bootstrapMethod,
  };
}

/**
 * Resolve the model's column references (names OR ids, case-insensitive on name)
 * to real group-column ids in the table's declared order. Unknown references are
 * dropped. When the model passes none we keep every group column (the figure
 * plots the whole table, the same default the editor uses).
 */
export function resolveGraphColumns(
  content: DataHubDocContent,
  columns: string[] | undefined,
): string[] {
  const groups = groupColumns(content);
  if (!columns || columns.length === 0) return groups.map((c) => c.id);
  const byId = new Map(groups.map((c) => [c.id, c.id]));
  const byName = new Map(groups.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const out: string[] = [];
  for (const ref of columns) {
    const id = byId.get(ref) ?? byName.get(ref.trim().toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Find a stored one-way ANOVA on the table, the analysis whose Tukey
 * comparisons feed significance brackets (the same `oneWayAnova` lookup
 * NewGraphDialog uses for its "use brackets" toggle). Returns the first match,
 * or null when the table has no saved one-way ANOVA. BeakerBot only LINKS this
 * stored analysis, it never recomputes the comparisons; the user (or a prior
 * run_datahub_analysis call) is what put the validated ANOVA on the table.
 */
export function findStoredAnova(
  content: DataHubDocContent,
): AnalysisSpec | null {
  return content.analyses.find((a) => a.type === "oneWayAnova") ?? null;
}

/**
 * Resolve the model's control reference (a group name OR id, case-insensitive on
 * name) to its index within the PLOTTED column order, which is the index the
 * engine reads as style.estimationControlIndex (it aligns the difference axis to
 * that group's mean and takes every other group's difference against it). An
 * unknown reference, or none, falls back to 0 (the first plotted group), the
 * engine's own default. `columnIds` is the resolved, ordered list of plotted
 * group ids; `content` supplies the group names for a by-name match.
 */
export function resolveControlIndex(
  content: DataHubDocContent,
  columnIds: string[],
  control: string | undefined,
): number {
  if (!control) return 0;
  const groups = groupColumns(content);
  const nameById = new Map(groups.map((c) => [c.id, c.name.trim().toLowerCase()]));
  const ref = control.trim().toLowerCase();
  const idx = columnIds.findIndex(
    (id) => id === control || nameById.get(id) === ref,
  );
  return idx >= 0 ? idx : 0;
}

// ---------------------------------------------------------------------------
// Build the figure (the model -> plot-spec engine bridge)
// ---------------------------------------------------------------------------

/** The compact, model-friendly result the model relays after a build. */
export type MakeGraphResult =
  | {
      ok: true;
      table: string;
      graphType: GraphType;
      errorBar: ErrorBarKind;
      columns: string[];
      plotId: string;
      /** The resolved engine PlotKind, present for an estimation figure so the
       *  model can name the variant it built ("estimationGardnerAltman" for two
       *  groups, "estimationCumming" for three or more). Absent for dot / bar. */
      plotKind?: PlotKind;
      /** The control group name an estimation figure took its differences against. */
      control?: string;
      /** True when an estimation figure drew the paired (matched) variant. */
      paired?: boolean;
      /** True when a dot / bar figure drew significance brackets from a linked
       *  one-way ANOVA. Absent / false when none were drawn. */
      bracketsDrawn?: boolean;
    }
  | { ok: false; error: string };

/**
 * Build a PlotSpec for the request against live content. Pure given the content,
 * so a test asserts the stored spec's kind / style against a known table with no
 * folder. This is where the model's words become an engine figure, the kind and
 * the error-bar choice map onto a real PlotKind + PlotStyle through buildPlotSpec
 * + withStyle (the validated editor write path), and the engine layout (NOT the
 * model) computes every coordinate when the figure renders.
 *
 * The figure is wired to plot ONLY the chosen group columns. A Column figure
 * draws every group column of the table, so when the model names a subset we
 * fall back to the whole table only if no named column matched (so a typo never
 * yields an empty figure), otherwise we keep the named subset by titling the
 * figure for those groups. Column kinds do not carry a per-column source filter
 * this slice, so the spec always plots the table's group columns, and the
 * subset acts as the model's intent record for the confirmation line.
 */
export function buildGraph(
  content: DataHubDocContent,
  parsed: MakeGraphArgs,
):
  | { ok: true; spec: PlotSpec; result: Extract<MakeGraphResult, { ok: true }> }
  | { ok: false; error: string } {
  const groups = groupColumns(content);
  if (groups.length === 0) {
    return {
      ok: false,
      error:
        "That table has no group columns to plot. It may not be a Column table of group measurements.",
    };
  }

  const columnIds = resolveGraphColumns(content, parsed.columns);
  if (columnIds.length === 0) {
    return {
      ok: false,
      error:
        "None of the columns you named match a group in that table. List the table again to see its real column names, then pick from those.",
    };
  }

  const names = groups
    .filter((c) => columnIds.includes(c.id))
    .map((c) => c.name);

  const id = `plot-${Date.now()}`;

  // Estimation figure: the modern effect-size-with-CI plot. The kind resolves by
  // group count (Gardner-Altman for two, Cumming for three or more), the control
  // resolves to its index in the plotted column order, and the bootstrap settings
  // (paired / CI / B / seed / method) are handed to the engine, which runs the
  // validated E4 bootstrap and lays out the figure. The model never computes a
  // mean difference, a CI, or a density value.
  if (parsed.type === "estimation") {
    const kind = estimationKindForGroups(columnIds.length);
    const controlIndex = resolveControlIndex(content, columnIds, parsed.control);
    // Paired is only valid for the two-group Gardner-Altman variant (one
    // non-control group pairs against the control). For three or more groups the
    // engine ignores it, so we do not write it onto a Cumming figure.
    const paired =
      kind === "estimationGardnerAltman" && parsed.paired === true;

    const base = buildPlotSpec({
      id,
      kind,
      tableId: content.meta.id,
      yTitle: content.meta.name || "Value",
      title: parsed.title,
      estimationControlIndex: controlIndex,
      estimationPaired: paired,
    });
    // Apply the estimation style the engine reads. Only the fields the model set
    // are written; the rest keep buildPlotSpec's defaults so the figure is
    // reproducible (the engine reads estimationControlIndex, estimationPaired,
    // estimationCi, estimationB, estimationSeed, estimationBootMethod).
    const patch: Partial<PlotStyle> = {
      kind,
      estimationControlIndex: controlIndex,
      estimationPaired: paired,
    };
    if (parsed.ci !== undefined) patch.estimationCi = parsed.ci;
    if (parsed.bootstrapSamples !== undefined)
      patch.estimationB = parsed.bootstrapSamples;
    if (parsed.seed !== undefined) patch.estimationSeed = parsed.seed;
    if (parsed.bootstrapMethod !== undefined)
      patch.estimationBootMethod = parsed.bootstrapMethod;
    const spec = withStyle(base, patch);

    const result: Extract<MakeGraphResult, { ok: true }> = {
      ok: true,
      table: content.meta.name,
      graphType: parsed.type,
      errorBar: parsed.errorBar,
      columns: names,
      plotId: id,
      plotKind: kind,
      control: names[controlIndex] ?? names[0],
      paired,
    };
    return { ok: true, spec, result };
  }

  const kind = toPlotKind(parsed.type);

  // Significance brackets (stars) need a stored one-way ANOVA on this table, the
  // engine reads its Tukey comparisons and draws a bracket over each significant
  // pair. When the model asks for brackets we LINK that stored analysis by id
  // (the NewGraphDialog "use brackets" path); the engine, not the model, draws
  // the stars. When the model asks for brackets but no ANOVA is saved yet, fail
  // with a clear next step so the model runs run_datahub_analysis first rather
  // than storing a figure with empty brackets.
  let anovaId: string | null = null;
  if (parsed.significanceBrackets) {
    const anova = findStoredAnova(content);
    if (!anova) {
      return {
        ok: false,
        error:
          "Significance brackets need a one-way ANOVA saved on this table first, the brackets come from its Tukey pairwise comparisons. Run run_datahub_analysis with a one-way ANOVA on these groups, then call make_datahub_graph again with significanceBrackets set.",
      };
    }
    anovaId = anova.id;
  }

  // Build the spec through the validated engine builder (buildPlotSpec seeds the
  // default publication style + the source), then apply the requested kind,
  // error bar, and point toggle through withStyle (the same style write the
  // editor's styling panel uses). The engine builds the figure geometry from
  // this spec; the model never computes a bar height or an error cap.
  const base = buildPlotSpec({
    id,
    kind,
    tableId: content.meta.id,
    analysisId: anovaId,
    yTitle: content.meta.name || "Value",
    title: parsed.title,
  });
  const spec = withStyle(base, {
    errorBar: parsed.errorBar,
    // A bar chart shows points only when the model explicitly asks; a dot plot
    // shows them by default (it is the point plot). The model can override.
    showPoints:
      parsed.showPoints !== undefined
        ? parsed.showPoints
        : parsed.type === "dot",
    // Draw brackets only when the model asked AND a stored ANOVA was linked
    // above (anovaId set). A bare chart leaves them off; the user can still add
    // them in the editor later.
    showBrackets: anovaId !== null,
  });

  const result: Extract<MakeGraphResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    graphType: parsed.type,
    errorBar: parsed.errorBar,
    columns: names,
    plotId: id,
    bracketsDrawn: anovaId !== null,
  };
  return { ok: true, spec, result };
}

// ---------------------------------------------------------------------------
// make_datahub_graph (previewable, builds + stores + navigates)
// ---------------------------------------------------------------------------

/**
 * Build the one-line preview summary for the make_datahub_graph step, from the
 * args and the cached table content (the SAME cache list_datahub_tables fills),
 * WITHOUT building the figure. Pure, so the step-mode gate can render the
 * preview-and-confirm block synchronously. Names the plotted columns where the
 * content is cached, and falls back to a generic line otherwise.
 */
export function describeMakeGraph(args: Record<string, unknown>): {
  summary: string;
  stepPayload?: StepApprovalRequest;
} {
  const parsed = parseMakeGraphArgs(args);
  const kindPhrase =
    parsed.type === "bar"
      ? "bar chart"
      : parsed.type === "estimation"
        ? "estimation plot"
        : "dot plot";
  const errorBarPhrase = parsed.type === "estimation" ? "95% CI" : parsed.errorBar;
  const content = getCachedTableContent(parsed.tableId);
  if (!content) {
    // Content is not cached yet (the model did not list this table first). Still
    // emit a step block so step-by-step mode always shows the rich preview-and-
    // confirm card, just with the args we know (kind, error bar) and no resolved
    // column names, never the generic Allow / Skip confirm.
    return {
      summary: `plot a ${kindPhrase} of a Data Hub table`,
      stepPayload: {
        kind: "step",
        toolName: "make_datahub_graph",
        iconName: "growth",
        title: `Plot a ${kindPhrase}`,
        steps: [
          {
            kind: "make_datahub_graph",
            name: kindPhrase,
            blurb: "Build a publication figure from the selected Data Hub table.",
            params: [
              { label: "Kind", value: kindPhrase },
              { label: "Error", value: errorBarPhrase },
            ],
            ...(parsed.significanceBrackets
              ? { previewLines: ["With significance brackets from the saved one-way ANOVA."] }
              : {}),
          },
        ],
      },
    };
  }
  const colIds = resolveGraphColumns(content, parsed.columns);
  const names = groupColumns(content)
    .filter((c) => colIds.includes(c.id))
    .map((c) => c.name);
  const colPhrase = names.length > 0 ? `${names.join(", ")} from ` : "";
  const params: { label: string; value: string }[] = [
    { label: "Kind", value: kindPhrase },
    ...(names.length > 0 ? [{ label: "Columns", value: names.join(", ") }] : []),
    { label: "Error", value: errorBarPhrase },
    { label: "Table", value: content.meta.name },
  ];
  return {
    summary: `plot a ${kindPhrase} of ${colPhrase}${content.meta.name}`,
    stepPayload: {
      kind: "step",
      toolName: "make_datahub_graph",
      iconName: "growth",
      title: `Plot a ${kindPhrase}`,
      subtitle: `of ${colPhrase}${content.meta.name}`,
      steps: [
        {
          kind: "make_datahub_graph",
          name: `${kindPhrase}`,
          blurb: `Build a publication figure from ${content.meta.name}.`,
          params,
          ...(parsed.significanceBrackets
            ? { previewLines: ["With significance brackets from the saved one-way ANOVA."] }
            : {}),
        },
      ],
    },
  };
}

export const makeDataHubGraphTool: AiTool = {
  name: "make_datahub_graph",
  description:
    "Build a publication figure from a Data Hub table, store it, and take the user to see it. Use this when the user asks to plot, chart, or graph their Data Hub data (for example \"make a bar chart of fakeGFP expression with SEM error bars\" or \"plot the growth curve\"). Call list_datahub_tables first to get the table id and the real column names, then call this with that table id. You pick the table, the graph TYPE (\"dot\" for a column dot plot of individual points over the mean, the default, \"bar\" for a bar chart of the means, or \"estimation\" for an effect-size plot, see below), and the error bar (\"sem\", \"sd\", or \"none\"). The \"estimation\" type draws the modern effect-size-with-confidence-interval figure (an estimation plot, also called a Gardner-Altman or Cumming plot, the DABEST-style alternative to a bar chart with significance stars): it shows every group's raw data plus the bootstrap distribution of the mean difference and its CI, so a reader sees the SIZE of the effect rather than only a yes / no star. Ask for it when the user wants an estimation plot, a Gardner-Altman plot, a Cumming plot, an effect-size plot, or a mean-difference / difference-with-CI figure. For an estimation plot you may also pass \"control\" (the group name or id every difference is taken against, default the first plotted group) and \"paired\" (true for matched / repeated-measures data, valid only when exactly two groups are plotted). The two-groups-vs-three-or-more choice (Gardner-Altman vs Cumming) is made for you from the group count, you do not pick it. If the user did not say which graph type or error bar they want and it matters, call ask_user (select \"one\") so they tap the choice (for example \"Bar with SEM\" vs \"Dot plot\" vs \"Estimation plot\") before you call this. The app's plot engine builds the figure itself, you never compute or invent a bar height, a mean, an error bar, a mean difference, a confidence interval, or any plotted value. This runs straight away, there is NO separate approval step, the user's request (and any choice they tapped) is the consent, so do not call propose_plan for it and do not ask the user to allow it. For a dot or bar chart you may also pass \"significanceBrackets\" true to draw significance stars over the groups from a one-way ANOVA's Tukey comparisons, but that needs a one-way ANOVA already saved on the table, so run run_datahub_analysis (one-way ANOVA) first, then make the chart with significanceBrackets set (the call fails with a clear next step if no ANOVA is saved). It saves the figure into that table as a version-controlled plot, navigates the user to the Data Hub so they see it, and returns what it plotted. After it returns, give ONE short line naming the chart it built.",
  parameters: {
    type: "object",
    properties: {
      tableId: {
        type: "string",
        description:
          "The id of the Data Hub table to plot, from a list_datahub_tables result.",
      },
      type: {
        type: "string",
        description:
          "The graph type. \"dot\" (the default) draws each replicate as a point over the group mean line (a Prism column dot plot). \"bar\" draws a bar to each group mean. \"estimation\" draws the effect-size figure (a Gardner-Altman plot for two groups, a Cumming plot for three or more) showing the bootstrap mean difference and its confidence interval. Choose from what the user asked for, or call ask_user when it is unspecified and matters.",
      },
      errorBar: {
        type: "string",
        description:
          "Which error bar to draw, computed by the engine from the raw replicates. \"sem\" (the default) for standard error of the mean, \"sd\" for standard deviation, \"none\" for no error bars. Not used by an estimation plot, which draws a confidence interval instead.",
      },
      control: {
        type: "string",
        description:
          "Estimation plots only. The control group (by name or id) every mean difference is taken against, and the group the difference axis is aligned to. Omit to use the first plotted group.",
      },
      paired: {
        type: "boolean",
        description:
          "Estimation plots only. Set true for matched / repeated-measures data so the figure draws the paired variant (slope lines between the matched points and a paired bootstrap). Valid only when exactly two groups are plotted (a Gardner-Altman figure); ignored for three or more groups.",
      },
      columns: {
        type: "array",
        items: { type: "string" },
        description:
          "The group columns to plot, by their names (or ids) from list_datahub_tables. Omit to plot every group column in the table.",
      },
      showPoints: {
        type: "boolean",
        description:
          "Draw each raw replicate as a jittered point. Defaults to true for a dot plot and false for a bar chart. Set true to overlay points on a bar chart.",
      },
      significanceBrackets: {
        type: "boolean",
        description:
          "Dot or bar charts only. Set true to draw significance brackets (stars) over the groups from a one-way ANOVA's Tukey pairwise comparisons. This needs a one-way ANOVA ALREADY SAVED on the same table, so run run_datahub_analysis with a one-way ANOVA on these groups FIRST, then call this with significanceBrackets true. The engine reads the stored comparisons and brackets only the significant pairs (p < 0.05); you never compute or place a star. If no ANOVA is saved yet the call fails and tells you to run one first. Ignored for an estimation plot.",
      },
      title: {
        type: "string",
        description:
          "An optional figure title shown above the plot. Omit for no title.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // No `action` flag, but `previewable: true` (ai review-mode bot, 2026-06-12).
  // The write is non-destructive (a new, reversible, version-controlled plot, the
  // editor's exact write path). In whole-plan mode it runs free (today's behavior,
  // the explicit request is the consent). In step-by-step mode the previewable
  // flag makes it show a preview-and-confirm block first, using describeMakeGraph
  // to render the figure kind and columns WITHOUT building it.
  previewable: true,
  describeAction: describeMakeGraph,
  execute: async (args) => {
    const parsed = parseMakeGraphArgs(args);
    if (!parsed.tableId) {
      return {
        ok: false,
        error:
          "No table was given. Call list_datahub_tables first and pass the id of the table to plot.",
      } satisfies MakeGraphResult;
    }
    // Always read the LIVE doc so the figure plots current data.
    const content = await datahubGraphDeps.resolveContent(parsed.tableId);
    if (!content) {
      return {
        ok: false,
        error:
          "I could not open that table. It may have been deleted, or the id is wrong. List the tables again and try one of those.",
      } satisfies MakeGraphResult;
    }

    const built = buildGraph(content, parsed);
    if (!built.ok) {
      return { ok: false, error: built.error } satisfies MakeGraphResult;
    }

    const stored = await datahubGraphDeps.persistPlot(
      parsed.tableId,
      built.spec,
    );
    if (!stored) {
      return {
        ok: false,
        error:
          "The figure was built but could not be saved to the table. It is not stored.",
      } satisfies MakeGraphResult;
    }

    // Take the user to the stored figure. The Data Hub page reads the
    // ?doc=<id>&plot=<plotId> deep link, selects that table, and then selects
    // the just-stored plot so the Graphs view of the figure (not the raw data
    // grid) is what the user lands on, so they SEE the chart rather than only
    // reading the chat line. Hard-wired here, not left to the model.
    // Skip the navigation when the run was initiated by the inline picker, so a
    // picker-driven plot stays in chat (Grant's locked nuance); a typed plot
    // request still navigates to the stored figure.
    if (!analysisResultInChat()) {
      datahubGraphDeps.navigate(
        `/datahub?doc=${parsed.tableId}&plot=${built.result.plotId}`,
      );
    }

    return built.result satisfies MakeGraphResult;
  },
};
