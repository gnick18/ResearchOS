// The Data Hub adapter to the universal figure composer. Registers a FigureSource
// (lib/figure/figure-source.ts) so every saved Data Hub plot becomes a composable
// panel. The composer never imports Data Hub directly, it only calls this through
// the registry, keeping lib/figure surface-agnostic.
//
// A figure id is "<docId>:<plotId>" so a panel resolves to its exact plot AND the
// table content it renders from. render() sizes the plot to the panel's real-inch
// box and calls the SAME renderPlot the editor uses, so a composed panel is
// numbers-identical to the figure in its own editor.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { dataHubApi } from "@/lib/datahub/api";
import {
  renderPlot,
  readPlotStyle,
  readPlotSource,
  withStyle,
} from "@/lib/datahub/plot-spec";
import { plotLayoutManifest } from "@/lib/datahub/plot-manifest";
import { PALETTES } from "@/lib/datahub/palettes";
import {
  registerFigureSource,
  missingPanelSvg,
  type FigureSource,
  type FigureRef,
  type RenderedFigure,
  type RenderOpts,
  type StyleOption,
  type PanelStyle,
} from "@/lib/figure/figure-source";
import type { LayoutManifest } from "@/lib/figure/layout-manifest";
import type { FixId } from "@/lib/figure/layout-collision";

type DataHubContent = NonNullable<Awaited<ReturnType<typeof dataHubApi.getContent>>>;
type DataHubPlot = NonNullable<DataHubContent["plots"]>[number];

const DEFAULT_ASPECT = 430 / 340; // the Data Hub FIG default (w / h)

/** Split a "<docId>:<plotId>" figure id. The plotId may itself contain no colon. */
export function splitFigureId(id: string): { docId: string; plotId: string } {
  const i = id.indexOf(":");
  if (i < 0) return { docId: id, plotId: "" };
  return { docId: id.slice(0, i), plotId: id.slice(i + 1) };
}

/** The intrinsic aspect of a plot, from its stored size or the FIG default. */
export function plotNaturalAspect(spec: Parameters<typeof readPlotStyle>[0]): number {
  const s = readPlotStyle(spec);
  if (s.width && s.height && s.width > 0 && s.height > 0) return s.width / s.height;
  return DEFAULT_ASPECT;
}

/** A short, human label for a plot kind, for the add-figure picker. */
function kindLabel(spec: Parameters<typeof readPlotStyle>[0]): string {
  const k = readPlotStyle(spec).kind;
  const map: Record<string, string> = {
    columnScatter: "column scatter",
    columnBar: "bar",
    groupedBar: "grouped bar",
    xyScatter: "XY",
    survivalCurve: "survival",
    estimationGardnerAltman: "estimation",
    estimationCumming: "estimation",
    pie: "pie",
    donut: "donut",
    stackedBar: "stacked bar",
  };
  return map[k] ?? k;
}

/**
 * Size a plot to the panel's real-inch box and resolve its table content +
 * analysis, exactly as render() does, so render() (draws the SVG) and
 * getLayoutManifest() (measures the bboxes) feed renderPlot the identical inputs
 * and the advisor reasons about the geometry the panel actually draws.
 */
function sizePlot(
  content: DataHubContent,
  plot: DataHubPlot,
  opts: RenderOpts,
): { sized: DataHubPlot; analysis: Parameters<typeof renderPlot>[2] } {
  const palette = opts.style?.options?.palette;
  // A composed panel can override the legend placement (the collision advisor's
  // relocate-legend fix applies it here, without mutating the saved plot).
  const legendPlacement = opts.style?.options?.legendPlacement;
  const sized = withStyle(plot, {
    width: opts.widthIn,
    height: opts.heightIn,
    sizeUnit: "in",
    // A composed panel hides the plot's own title by default (the figure's panel
    // letter + caption carry it); an empty title hides it in renderPlot.
    ...(opts.overrides?.hideTitle ? { title: "" } : {}),
    ...(typeof palette === "string" && palette ? { palette } : {}),
    ...(legendPlacement === "right" ? { legendPlacement: "right" as const } : {}),
  }) as DataHubPlot;
  const source = readPlotSource(sized);
  const analysis = source.analysisId
    ? content.analyses?.find((a) => a.id === source.analysisId) ?? null
    : null;
  return { sized, analysis };
}

export const dataHubFigureSource: FigureSource = {
  type: "datahub",
  label: "Data Hub plot",

  async list(scope) {
    const docs = scope.collectionId
      ? await dataHubApi.listByProject(scope.collectionId)
      : await dataHubApi.list();
    const refs: FigureRef[] = [];
    for (const doc of docs) {
      const content = await dataHubApi.getContent(doc.id);
      if (!content) continue;
      for (const plot of content.plots ?? []) {
        const kind = kindLabel(plot);
        const title = readPlotStyle(plot).title?.trim();
        refs.push({
          id: `${doc.id}:${plot.id}`,
          type: "datahub",
          // The plot's own title when it has one, else the table name + kind.
          name: title || `${doc.name} (${kind})`,
          // The table / document the plot lives in, for "Group by table".
          group: doc.name,
          // The plot style, for the filter chips + "Group by type".
          kind,
        });
      }
    }
    return refs;
  },

  async render(id, opts): Promise<RenderedFigure> {
    const { docId, plotId } = splitFigureId(id);
    const content = await dataHubApi.getContent(docId);
    const plot = content?.plots?.find((p) => p.id === plotId);
    if (!content || !plot) return missingPanelSvg(opts.widthIn, opts.heightIn);

    const aspect = plotNaturalAspect(plot);
    // Size the figure to the panel's real-inch box, then render with the SAME
    // path the editor uses (so the panel matches the figure exactly).
    const { sized, analysis } = sizePlot(content, plot, opts);
    const { svg } = renderPlot(sized, content, analysis);
    return { svg, naturalAspect: aspect };
  },

  async getLayoutManifest(id, opts): Promise<LayoutManifest | null> {
    const { docId, plotId } = splitFigureId(id);
    const content = await dataHubApi.getContent(docId);
    const plot = content?.plots?.find((p) => p.id === plotId);
    if (!content || !plot) return null;
    // Same sizing + renderPlot inputs as render(), so the manifest measures the
    // exact geometry the panel draws. plotLayoutManifest turns the laid-out
    // geometry into the shared collision-advisor manifest.
    const { sized, analysis } = sizePlot(content, plot, opts);
    const { geometry, style } = renderPlot(sized, content, analysis);
    return plotLayoutManifest(geometry, style);
  },

  styleSchema(): StyleOption[] {
    return [
      {
        kind: "select",
        key: "palette",
        label: "Color palette",
        // Empty default = "keep the plot's stored palette" (no override).
        default: "",
        choices: [
          { value: "", label: "Plot default" },
          ...PALETTES.map((p) => ({ value: p.id, label: p.name })),
        ],
      },
      {
        // The manual lever for the legend, so a composed panel can move the legend
        // out of the bars (and the collision advisor's relocate-legend is never a
        // one-way trap once its banner self-hides). Grouped bar only; ignored
        // elsewhere. Default "overlay" matches the plot's own default.
        kind: "select",
        key: "legendPlacement",
        label: "Legend",
        default: "overlay",
        choices: [
          { value: "overlay", label: "Overlay" },
          { value: "right", label: "Right of plot" },
        ],
      },
    ];
  },

  styleForFix(fixId: FixId): PanelStyle | null {
    // The only Data Hub lever today: move the legend out of the bars.
    if (fixId === "relocate-legend") {
      return { options: { legendPlacement: "right" } };
    }
    return null;
  },

  editHref(id) {
    const { docId } = splitFigureId(id);
    return `/datahub?doc=${docId}`;
  },
};

/** Register the Data Hub source. Called once from the app's source registration. */
export function registerDataHubFigureSource(): void {
  registerFigureSource(dataHubFigureSource);
}
