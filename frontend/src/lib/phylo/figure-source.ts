// The phylogenetics adapter to the universal figure composer. Registers a
// FigureSource (lib/figure/figure-source.ts) so every saved tree becomes a
// composable panel via the SAME renderTreeSvg the Tree Studio + embeds use, so a
// composed tree panel is identical to the figure in its own studio.
//
// The composer never imports phylo directly, it only calls this through the
// registry, keeping lib/figure surface-agnostic.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { phyloApi } from "@/lib/phylo/api";
import { parseTree, type TreeNode } from "@/lib/phylo/parse";
import { renderTreeSvg, renderTreeWithManifest, type RenderSpec } from "@/lib/phylo/render";
import {
  figureToRenderSpec,
  figureInputsFromStored,
} from "@/lib/phylo/figure-to-render";
import type { PhyloLayout } from "@/lib/phylo/types";
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

/** Circular-family layouts read best square; rectangular ones a touch wide. */
const SQUARE_LAYOUTS = new Set<PhyloLayout>([
  "circular",
  "fan",
  "unrooted",
  "inwardCircular",
]);

/** A short, human kind label for the picker, from the stored layout. */
function layoutKind(layout: PhyloLayout | undefined): string {
  return layout ? `${layout} tree` : "tree";
}

/** The panel's default aspect, so an added tree panel is sensibly proportioned. */
function treeAspect(layout: PhyloLayout | undefined): number {
  return layout && SQUARE_LAYOUTS.has(layout) ? 1.0 : 1.3;
}

type PhyloRaw = NonNullable<Awaited<ReturnType<typeof phyloApi.get>>>;

/** Build the parsed tree + render spec a render at `opts` uses. Shared by
 *  render() (draws the SVG) and getLayoutManifest() (measures the bboxes) so the
 *  advisor reasons about the exact geometry the panel draws. Per-panel option
 *  overrides (composer Style inspector) layer on the stored inputs without
 *  mutating the saved tree; absent options keep the stored value. */
function buildSpec(
  raw: PhyloRaw,
  opts: RenderOpts,
): { tree: TreeNode; spec: RenderSpec } {
  const tree = parseTree(raw.tree);
  const base = figureInputsFromStored(raw.meta.figure, raw.meta.metadata);
  const o = opts.style?.options ?? {};
  const inputs = {
    ...base,
    scaleBar: typeof o.scaleBar === "boolean" ? o.scaleBar : base.scaleBar,
    legend: typeof o.legend === "boolean" ? o.legend : base.legend,
    rootEdge: typeof o.rootEdge === "boolean" ? o.rootEdge : base.rootEdge,
    // The collision advisor's relocate-legend fix sets this override; absent keeps
    // the stored placement.
    legendPlacement:
      o.legendPlacement === "right" || o.legendPlacement === "bottom"
        ? o.legendPlacement
        : base.legendPlacement,
  };
  // renderTreeSvg sizes in px; the panel asks in real inches, so convert at the
  // requested dpi. The returned SVG carries a viewBox, so it scales to the panel
  // box when the composer nests it.
  const spec = figureToRenderSpec(tree, inputs, {
    width: Math.max(1, Math.round(opts.widthIn * opts.dpi)),
    height: Math.max(1, Math.round(opts.heightIn * opts.dpi)),
  });
  return { tree, spec };
}

export const phyloFigureSource: FigureSource = {
  type: "phylo",
  label: "Phylogenetic tree",

  async list(scope) {
    const trees = scope.collectionId
      ? await phyloApi.listByProject(scope.collectionId)
      : await phyloApi.list();
    return trees.map((meta) => ({
      id: meta.id,
      type: "phylo",
      name: meta.name,
      // Group by the stored layout family + tip count is too granular; the
      // source label is the group fallback, so leave group unset for now.
      kind: layoutKind(meta.figure?.layout),
    }));
  },

  async render(id, opts): Promise<RenderedFigure> {
    const raw = await phyloApi.get(id);
    if (!raw) return missingPanelSvg(opts.widthIn, opts.heightIn);
    try {
      const { tree, spec } = buildSpec(raw, opts);
      const svg = renderTreeSvg(tree, spec);
      return { svg, naturalAspect: treeAspect(raw.meta.figure?.layout) };
    } catch {
      return missingPanelSvg(opts.widthIn, opts.heightIn);
    }
  },

  async getLayoutManifest(id, opts): Promise<LayoutManifest | null> {
    const raw = await phyloApi.get(id);
    if (!raw) return null;
    try {
      const { tree, spec } = buildSpec(raw, opts);
      // renderTreeWithManifest emits the exact bboxes the SVG was drawn from, so
      // the advisor measures the same geometry render() produced.
      return renderTreeWithManifest(tree, spec).manifest;
    } catch {
      return null;
    }
  },

  styleSchema(): StyleOption[] {
    return [
      { kind: "toggle", key: "scaleBar", label: "Scale bar", default: true },
      { kind: "toggle", key: "legend", label: "Legend", default: true },
      { kind: "toggle", key: "rootEdge", label: "Root edge", default: false },
      {
        // The manual lever for the legend, so a composed tree panel can move the
        // legend below the figure (and the advisor's relocate-legend is never a
        // one-way trap once its banner self-hides).
        kind: "select",
        key: "legendPlacement",
        label: "Legend",
        default: "right",
        choices: [
          { value: "right", label: "Right" },
          { value: "bottom", label: "Below" },
        ],
      },
    ];
  },

  styleForFix(fixId: FixId): PanelStyle | null {
    // The phylo composer lever: move the legend below the figure (the same target
    // the Tree Studio advisor's relocate-legend uses). The other fixes (tilt /
    // column gap / drop overlay) are not composer-panel overrides, so omit them.
    if (fixId === "relocate-legend") {
      return { options: { legendPlacement: "bottom" } };
    }
    return null;
  },

  editHref(id) {
    return `/phylo?doc=${encodeURIComponent(id)}`;
  },
};

/** Register the phylo source. Called once from the app's source registration. */
export function registerPhyloFigureSource(): void {
  registerFigureSource(phyloFigureSource);
}
