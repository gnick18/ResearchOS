// The chemistry adapter to the universal figure composer. Registers a
// "chemistry" FigureSource (lib/figure/figure-source.ts) so every saved molecule
// becomes a composable panel, depicted via the SAME RDKit renderSvg the molecule
// thumbnails + workbench use, so a composed panel matches the structure exactly.
//
// The composer never imports chemistry directly, it only calls this through the
// registry, keeping lib/figure surface-agnostic.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { moleculesApi } from "@/lib/chemistry/api";
import { renderSvg } from "@/lib/chemistry/rdkit";
import {
  registerFigureSource,
  missingPanelSvg,
  type FigureSource,
  type FigureRef,
  type RenderedFigure,
} from "@/lib/figure/figure-source";

export const chemistryFigureSource: FigureSource = {
  type: "chemistry",
  label: "Molecule structure",

  async list(scope) {
    const molecules = scope.collectionId
      ? await moleculesApi.listByProject(scope.collectionId)
      : await moleculesApi.list();
    return molecules.map((meta) => ({
      id: meta.id,
      type: "chemistry",
      name: meta.name,
      kind: "molecule",
    }));
  },

  async render(id, opts): Promise<RenderedFigure> {
    const raw = await moleculesApi.get(id);
    // Prefer the stored molfile (2D coords preserved), fall back to SMILES.
    const structure = raw?.molfile || raw?.meta.smiles || "";
    if (!structure) return missingPanelSvg(opts.widthIn, opts.heightIn);
    try {
      // renderSvg sizes in px; the panel asks in real inches, so convert at the
      // requested dpi. RDKit returns a self-contained viewBox SVG, so it scales
      // to the panel box when the composer nests it.
      const svg = await renderSvg(
        structure,
        Math.max(1, Math.round(opts.widthIn * opts.dpi)),
        Math.max(1, Math.round(opts.heightIn * opts.dpi)),
      );
      return { svg, naturalAspect: 1.0 };
    } catch {
      return missingPanelSvg(opts.widthIn, opts.heightIn);
    }
  },

  editHref(id) {
    return `/chemistry?molecule=${encodeURIComponent(id)}`;
  },
};

/** Register the chemistry source. Called once from the app's source registration. */
export function registerChemistryFigureSource(): void {
  registerFigureSource(chemistryFigureSource);
}
