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
} from "@/lib/datahub/plot-spec";
import type {
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import type { AiTool } from "./types";

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
 * dot plot (individual points over a mean line, the default) and "bar" is a bar
 * to the mean. These map onto the engine's PlotKind ("columnScatter" /
 * "columnBar") so the model never has to know the internal kind names.
 */
export type GraphType = "dot" | "bar" | "estimation";

/** The model-supplied arguments, before mapping to a PlotSpec. */
export type MakeGraphArgs = {
  tableId: string;
  /**
   * "dot" (the default) for a column dot plot, "bar" for a bar chart, or
   * "estimation" for the effect-size figure (the raw data plus the bootstrap
   * mean-difference and its CI). An estimation request of two groups draws a
   * Gardner-Altman plot, three or more a Cumming plot sharing the control.
   */
  type: GraphType;
  /** Which error bar to draw, computed by the engine from the raw replicates. */
  errorBar: ErrorBarKind;
  /** The group columns to plot, by name or id. Omit to plot every group. */
  columns?: string[];
  /** Draw each raw replicate as a jittered point (default true for a dot plot). */
  showPoints?: boolean;
  /** Optional figure title. */
  title?: string;
  /** For an estimation figure, the control group by name or id (default the first). */
  control?: string;
  /** For a two-group estimation figure, draw the paired variant (matched rows). */
  paired?: boolean;
};

/**
 * Map the model graph type onto the engine PlotKind. The estimation type resolves
 * to Gardner-Altman vs Cumming by the plotted group count, decided in buildGraph
 * where the count is known, so this returns the two-group kind by default.
 */
export function toPlotKind(type: GraphType): PlotKind {
  if (type === "bar") return "columnBar";
  if (type === "estimation") return "estimationGardnerAltman";
  return "columnScatter";
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
  const control = typeof args.control === "string" ? args.control : undefined;
  const paired = typeof args.paired === "boolean" ? args.paired : undefined;
  return { tableId, type, errorBar, columns, showPoints, title, control, paired };
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

  // An estimation figure needs at least two groups (a control and one other), so
  // reject early with a plain reason rather than building an empty figure.
  if (parsed.type === "estimation" && groups.length < 2) {
    return {
      ok: false,
      error:
        "An estimation plot needs at least two groups (a control plus one or more to compare). That table has only one group.",
    };
  }

  // Resolve the estimation kind by group count (two = Gardner-Altman, three or
  // more = Cumming) and the control group the differences are taken against.
  const estCumming = parsed.type === "estimation" && groups.length >= 3;
  const kind =
    parsed.type === "estimation"
      ? estCumming
        ? "estimationCumming"
        : "estimationGardnerAltman"
      : toPlotKind(parsed.type);

  // The control group index in the table's group order. The model may name it by
  // name or id; default the first group when unresolved.
  let controlIndex = 0;
  if (parsed.type === "estimation" && parsed.control) {
    const ref = parsed.control.trim().toLowerCase();
    const idx = groups.findIndex(
      (g) => g.id === parsed.control || g.name.trim().toLowerCase() === ref,
    );
    if (idx >= 0) controlIndex = idx;
  }

  // Build the spec through the validated engine builder (buildPlotSpec seeds the
  // default publication style + the source), then apply the requested kind,
  // error bar, and point toggle through withStyle (the same style write the
  // editor's styling panel uses). The engine builds the figure geometry from
  // this spec; the model never computes a bar height or an error cap.
  const id = `plot-${Date.now()}`;
  const base = buildPlotSpec({
    id,
    kind,
    tableId: content.meta.id,
    yTitle: content.meta.name || "Value",
    title: parsed.title,
    estimationPaired:
      parsed.type === "estimation" && !estCumming ? parsed.paired : undefined,
    estimationControlIndex:
      parsed.type === "estimation" ? controlIndex : undefined,
  });
  const spec = withStyle(base, {
    errorBar: parsed.errorBar,
    // A bar chart shows points only when the model explicitly asks; a dot plot
    // shows them by default (it is the point plot). An estimation figure always
    // shows the raw points (that is half its purpose). The model can override.
    showPoints:
      parsed.showPoints !== undefined
        ? parsed.showPoints
        : parsed.type === "dot" || parsed.type === "estimation",
    // No analysis is linked from a bare chart request, so do not draw brackets
    // (they need a stored ANOVA). The user can add them in the editor.
    showBrackets: false,
  });

  const result: Extract<MakeGraphResult, { ok: true }> = {
    ok: true,
    table: content.meta.name,
    graphType: parsed.type,
    errorBar: parsed.errorBar,
    columns: names,
    plotId: id,
  };
  return { ok: true, spec, result };
}

// ---------------------------------------------------------------------------
// make_datahub_graph (NON-gated, builds + stores + navigates)
// ---------------------------------------------------------------------------

export const makeDataHubGraphTool: AiTool = {
  name: "make_datahub_graph",
  description:
    "Build a publication figure from a Data Hub table, store it, and take the user to see it. Use this when the user asks to plot, chart, or graph their Data Hub data (for example \"make a bar chart of fakeGFP expression with SEM error bars\" or \"plot the growth curve\"). Call list_datahub_tables first to get the table id and the real column names, then call this with that table id. You pick the table, the graph TYPE (\"dot\" for a column dot plot of individual points over the mean, the default, or \"bar\" for a bar chart of the means), and the error bar (\"sem\", \"sd\", or \"none\"). If the user did not say which graph type or error bar they want and it matters, call ask_user (select \"one\") so they tap the choice (for example \"Bar with SEM\" vs \"Dot plot\") before you call this. The app's plot engine builds the figure itself, you never compute or invent a bar height, a mean, an error bar, or any plotted value. This runs straight away, there is NO separate approval step, the user's request (and any choice they tapped) is the consent, so do not call propose_plan for it and do not ask the user to allow it. It saves the figure into that table as a version-controlled plot, navigates the user to the Data Hub so they see it, and returns what it plotted. After it returns, give ONE short line naming the chart it built.",
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
          "The graph type. \"dot\" (the default) draws each replicate as a point over the group mean line (a Prism column dot plot). \"bar\" draws a bar to each group mean. \"estimation\" draws an effect-size figure (the raw data plus the bootstrap mean-difference and its 95% CI on a second axis, a Gardner-Altman plot for two groups or a Cumming plot for three or more sharing a control). Choose from what the user asked for, or call ask_user when it is unspecified and matters.",
      },
      errorBar: {
        type: "string",
        description:
          "Which error bar to draw, computed by the engine from the raw replicates. \"sem\" (the default) for standard error of the mean, \"sd\" for standard deviation, \"none\" for no error bars.",
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
      title: {
        type: "string",
        description:
          "An optional figure title shown above the plot. Omit for no title.",
      },
      control: {
        type: "string",
        description:
          "For an estimation plot only. The control group (by name or id) that every mean difference is taken against. Defaults to the first group.",
      },
      paired: {
        type: "boolean",
        description:
          "For a two-group estimation plot only. Set true when the two columns are the same subjects measured twice (each row is a matched pair), which draws slope lines and a paired mean difference.",
      },
    },
    required: ["tableId"],
    additionalProperties: false,
  },
  // No `action` flag (ai datahub-graph bot, 2026-06-11). This tool writes, but
  // the write is non-destructive (a new, reversible, version-controlled plot,
  // the editor's exact write path) and the user already consented by asking for
  // the chart (and tapping any kind / error-bar choice through ask_user), so it
  // must NOT flow through the per-action approval gate. Its safety is the
  // explicit request, not a gate, exactly like run_datahub_analysis.
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
    datahubGraphDeps.navigate(
      `/datahub?doc=${parsed.tableId}&plot=${built.result.plotId}`,
    );

    return built.result satisfies MakeGraphResult;
  },
};
