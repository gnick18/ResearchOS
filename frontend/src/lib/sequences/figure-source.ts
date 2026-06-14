// The sequence adapter to the universal figure composer. Registers a "sequence"
// FigureSource (lib/figure/figure-source.ts) so every saved sequence map becomes
// a composable panel. Unlike phylo/chem there is no shared editor renderer to
// reuse (SeqViz is React + DOM-bound), so the panel is drawn by the headless
// renderSequenceMapSvg, which depicts the SAME features + colors as the editor.
//
// The composer never imports sequences directly, it only calls this through the
// registry, keeping lib/figure surface-agnostic.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { sequenceStore } from "@/lib/sequences/sequence-store";
import { genbankToDetail } from "@/lib/sequences/parse";
import { documentFromDetail } from "@/lib/sequences/edit-model";
import { renderSequenceMapSvg, featureKey, type SequenceMapStyle } from "@/lib/sequences/map-render";
import { resolveFeatureColor } from "@/lib/sequences/feature-colors";
import {
  registerFigureSource,
  missingPanelSvg,
  type FigureSource,
  type FigureRef,
  type RenderedFigure,
  type StyleTarget,
  type PanelStyle,
} from "@/lib/figure/figure-source";

/** Translate the composer's generic PanelStyle into a SequenceMapStyle. */
function toMapStyle(style: PanelStyle | undefined): SequenceMapStyle {
  return {
    perFeature: style?.targets,
    featureScale: style?.options?.featureScale as number | undefined,
    showTicks: style?.options?.showTicks as boolean | undefined,
    showLabels: style?.options?.showLabels as boolean | undefined,
  };
}

/** Load + parse a sequence into its editable document, or null if unavailable. */
async function loadDoc(id: string) {
  const raw = await sequenceStore.getRaw(Number(id));
  if (!raw) return null;
  const detail = genbankToDetail(raw.genbank, raw.meta);
  return detail ? documentFromDetail(detail) : null;
}

export const sequenceFigureSource: FigureSource = {
  type: "sequence",
  label: "Sequence map",

  async list(scope) {
    const metas = await sequenceStore.listMeta();
    const visible = scope.collectionId
      ? metas.filter((m) => m.project_ids.includes(scope.collectionId as string))
      : metas;
    return visible.map((m) => ({
      id: String(m.id),
      type: "sequence",
      name: m.display_name,
      kind: "sequence map",
    }));
  },

  async render(id, opts): Promise<RenderedFigure> {
    try {
      const doc = await loadDoc(id);
      if (!doc) return missingPanelSvg(opts.widthIn, opts.heightIn);
      const svg = renderSequenceMapSvg(
        doc,
        {
          width: Math.max(1, Math.round(opts.widthIn * opts.dpi)),
          height: Math.max(1, Math.round(opts.heightIn * opts.dpi)),
        },
        toMapStyle(opts.style),
      );
      // Plasmid maps read square; linear maps read wide.
      return { svg, naturalAspect: doc.circular ? 1.0 : 1.8 };
    } catch {
      return missingPanelSvg(opts.widthIn, opts.heightIn);
    }
  },

  async styleTargets(id): Promise<StyleTarget[]> {
    const doc = await loadDoc(id);
    if (!doc) return [];
    return doc.features.map((f) => ({
      key: featureKey(f),
      label: f.name,
      color: resolveFeatureColor(f),
    }));
  },

  editHref(id) {
    return `/sequences?seq=${encodeURIComponent(id)}`;
  },
};

/** Register the sequence source. Called once from the app's source registration. */
export function registerSequenceFigureSource(): void {
  registerFigureSource(sequenceFigureSource);
}
