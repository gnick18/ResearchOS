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
import { parseTree } from "@/lib/phylo/parse";
import { renderTreeSvg } from "@/lib/phylo/render";
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
  type StyleOption,
} from "@/lib/figure/figure-source";

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
      const tree = parseTree(raw.tree);
      const base = figureInputsFromStored(raw.meta.figure, raw.meta.metadata);
      // Per-panel option overrides (composer Style inspector) layer on top of the
      // figure's stored inputs without mutating the saved tree. Absent options
      // keep the stored value, so an unstyled panel renders exactly as before.
      const o = opts.style?.options ?? {};
      const inputs = {
        ...base,
        scaleBar: typeof o.scaleBar === "boolean" ? o.scaleBar : base.scaleBar,
        legend: typeof o.legend === "boolean" ? o.legend : base.legend,
        rootEdge: typeof o.rootEdge === "boolean" ? o.rootEdge : base.rootEdge,
      };
      // renderTreeSvg sizes in px; the panel asks in real inches, so convert at
      // the requested dpi. The returned SVG carries a viewBox, so it scales to
      // the panel box when the composer nests it.
      const spec = figureToRenderSpec(tree, inputs, {
        width: Math.max(1, Math.round(opts.widthIn * opts.dpi)),
        height: Math.max(1, Math.round(opts.heightIn * opts.dpi)),
      });
      const svg = renderTreeSvg(tree, spec);
      return { svg, naturalAspect: treeAspect(raw.meta.figure?.layout) };
    } catch {
      return missingPanelSvg(opts.widthIn, opts.heightIn);
    }
  },

  styleSchema(): StyleOption[] {
    return [
      { kind: "toggle", key: "scaleBar", label: "Scale bar", default: true },
      { kind: "toggle", key: "legend", label: "Legend", default: true },
      { kind: "toggle", key: "rootEdge", label: "Root edge", default: false },
    ];
  },

  editHref(id) {
    return `/phylo?doc=${encodeURIComponent(id)}`;
  },
};

/** Register the phylo source. Called once from the app's source registration. */
export function registerPhyloFigureSource(): void {
  registerFigureSource(phyloFigureSource);
}
