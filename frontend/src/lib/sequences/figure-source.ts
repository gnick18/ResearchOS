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

import { sequencesApi } from "@/lib/local-api";
import { sequenceStore } from "@/lib/sequences/sequence-store";
import { genbankToDetail } from "@/lib/sequences/parse";
import { documentFromDetail, type SeqDocument } from "@/lib/sequences/edit-model";
import {
  renderSequenceMapSvg,
  buildLinearMapManifest,
  featureKey,
  type SequenceMapStyle,
} from "@/lib/sequences/map-render";
import { mergeMapStyle } from "@/lib/sequences/figure-style";
import { resolveFeatureColor } from "@/lib/sequences/feature-colors";
import {
  registerFigureSource,
  missingPanelSvg,
  type FigureSource,
  type FigureRef,
  type RenderedFigure,
  type StyleTarget,
  type StyleOption,
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

/** Load a sequence's parsed document + its saved canonical figure style. */
async function loadDoc(
  id: string,
): Promise<{ doc: SeqDocument; canonical: SequenceMapStyle | undefined } | null> {
  const raw = await sequenceStore.getRaw(Number(id));
  if (!raw) return null;
  const detail = genbankToDetail(raw.genbank, raw.meta);
  if (!detail) return null;
  return { doc: documentFromDetail(detail), canonical: raw.meta.figure };
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
      const loaded = await loadDoc(id);
      if (!loaded) return missingPanelSvg(opts.widthIn, opts.heightIn);
      // Canonical style (saved on the sequence) is the base; the panel's own
      // override layers on top.
      const style = mergeMapStyle(loaded.canonical, toMapStyle(opts.style));
      const svg = renderSequenceMapSvg(
        loaded.doc,
        {
          width: Math.max(1, Math.round(opts.widthIn * opts.dpi)),
          height: Math.max(1, Math.round(opts.heightIn * opts.dpi)),
        },
        style,
      );
      // Plasmid maps read square; linear maps read wide.
      return { svg, naturalAspect: loaded.doc.circular ? 1.0 : 1.8 };
    } catch {
      return missingPanelSvg(opts.widthIn, opts.heightIn);
    }
  },

  async styleTargets(id): Promise<StyleTarget[]> {
    const loaded = await loadDoc(id);
    if (!loaded) return [];
    return loaded.doc.features.map((f) => ({
      key: featureKey(f),
      label: f.name,
      // Seed the swatch from the canonical override if set, else the editor color.
      color: loaded.canonical?.perFeature?.[featureKey(f)]?.color ?? resolveFeatureColor(f),
    }));
  },

  styleSchema(): StyleOption[] {
    return [
      { kind: "range", key: "featureScale", label: "Thickness", min: 0.5, max: 2, step: 0.1, default: 1 },
      { kind: "toggle", key: "showTicks", label: "Coordinate ruler", default: true },
      { kind: "toggle", key: "showLabels", label: "Feature labels", default: true },
    ];
  },

  async saveDefaultStyle(id, style): Promise<void> {
    // Promote a panel's style to the sequence's canonical figure style (sidecar).
    await sequencesApi.update(Number(id), { figure: toMapStyle(style) });
  },

  // The collision-advisor seam. v1 covers the LINEAR map, whose features lane-pack
  // upward, so a busy plasmid stacks feature rows off the TOP of the canvas
  // (content-overflow). Circular maps self-de-collide their labels differently and
  // are not covered yet, so they return null (no advisor). Same id + opts + merged
  // style as render(), so the boxes are the exact numbers the SVG was drawn from.
  async getLayoutManifest(id, opts) {
    const loaded = await loadDoc(id);
    if (!loaded || loaded.doc.circular) return null;
    const style = mergeMapStyle(loaded.canonical, toMapStyle(opts.style));
    return buildLinearMapManifest(
      loaded.doc,
      {
        width: Math.max(1, Math.round(opts.widthIn * opts.dpi)),
        height: Math.max(1, Math.round(opts.heightIn * opts.dpi)),
      },
      style,
    );
  },

  // The panel-style override each fix maps to (composition-local, no source
  // mutation). The overflow fix "shrink the contents to fit" thins the feature
  // rows (smaller featureScale -> shorter rowH -> the same rows stack into less
  // height), which is the lever the sequence map actually has.
  styleForFix(fixId) {
    if (fixId === "shrink-label-font") return { options: { featureScale: 0.6 } };
    return null;
  },

  editHref(id) {
    return `/sequences?seq=${encodeURIComponent(id)}`;
  },
};

/** Register the sequence source. Called once from the app's source registration. */
export function registerSequenceFigureSource(): void {
  registerFigureSource(sequenceFigureSource);
}
