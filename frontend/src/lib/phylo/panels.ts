// Phylo Tree Studio, the layer-stack model + the Phase 0 projection (Phase 1).
//
// ONE place that turns the persisted figure into the ordered AlignedPanel[] the
// renderer + the ggtree exporter both walk, and that resolves each panel's bound
// metadata into the PanelValues / PanelScales the panel renderer consumes. The
// migration rule (spec section 5) lives here: a saved figure with no `panels` is
// PROJECTED from its Phase 0 `tracks` + column bindings into a default layer set,
// so nothing saved breaks and an old figure opens looking exactly like its last
// save. The Studio writes `panels` going forward.
//
// Pure data, no DOM, no React. render.ts and figure-to-render.ts import this.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { leaves, type TreeNode } from "./parse";
import { buildColorScale, classifyColumn, type ColorScale } from "./color-scale";
import type { PanelScales, PanelValues } from "./panel-render";
import type { AlignedPanel } from "./types";

/** What render.ts / figure-to-render.ts pass for the legacy projection. */
export interface ProjectionInputs {
  tracks: {
    labels: boolean;
    labelsItalic: boolean;
    points: boolean;
    strip: boolean;
    bars: boolean;
    heat: boolean;
    clade: boolean;
    support: boolean;
  };
  category?: string;
  bar?: string;
  heat?: string[];
  /** Per-track sequential-palette overrides (Phase 0 scales). */
  scales?: { category?: string; bar?: string; heat?: Record<string, string> };
  legend?: boolean;
}

let projCounter = 0;
function pid(kind: string): string {
  return `${kind}-${projCounter++}`;
}

/**
 * Project a Phase 0 figure (track booleans + column bindings) into the ordered
 * layer stack. The order matches the Phase 0 draw order, inner to outer: the
 * tip-attached decorations first (clade behind, then support, points, labels are
 * positioned by the renderer), then the aligned columns strip -> heat -> bars.
 * This is the back-compat read path: an old saved figure with no `panels` gets
 * this exact stack and renders unchanged.
 */
export function projectTracksToPanels(input: ProjectionInputs): AlignedPanel[] {
  const t = input.tracks;
  const legend = input.legend !== false;
  const out: AlignedPanel[] = [];

  // Highlights + decorations attached to the tree (drawn by render.ts itself).
  if (t.clade) out.push({ id: pid("clade"), kind: "clade", visible: true });
  if (t.support) out.push({ id: pid("support"), kind: "support", visible: true });
  if (t.points && input.category) {
    out.push({
      id: pid("points"),
      kind: "points",
      visible: true,
      column: input.category,
      legend,
    });
  }

  // Aligned columns (drawn through renderPanel), inner to outer.
  if (t.strip && input.category) {
    out.push({
      id: pid("strip"),
      kind: "strip",
      visible: true,
      column: input.category,
      scale: input.scales?.category
        ? { kind: "continuous", paletteId: input.scales.category }
        : undefined,
      legend,
    });
  }
  if (t.heat && input.heat && input.heat.length > 0) {
    out.push({
      id: pid("heat"),
      kind: "heat",
      visible: true,
      columns: input.heat,
      legend,
    });
  }
  if (t.bars && input.bar) {
    out.push({
      id: pid("bars"),
      kind: "bars",
      visible: true,
      column: input.bar,
      scale: input.scales?.bar
        ? { kind: "continuous", paletteId: input.scales.bar }
        : undefined,
      legend,
    });
  }

  // Labels are the outermost layer (drawn past every aligned panel).
  if (t.labels) {
    out.push({
      id: pid("labels"),
      kind: "labels",
      visible: true,
      options: { italic: t.labelsItalic },
    });
  }
  return out;
}

/**
 * Resolve the per-tip data a panel draws from the bound metadata. A single-column
 * panel (strip / bars / dots / single heat) fills `single`; a multi-column heat
 * fills `matrix`; a box fills `replicates` (parsed numbers from its columns).
 */
export function extractPanelValues(
  panel: AlignedPanel,
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
): PanelValues {
  const tips = leaves(root);
  if (panel.kind === "box") {
    const cols = panel.columns ?? (panel.column ? [panel.column] : []);
    const replicates = new Map<number, number[]>();
    for (const tip of tips) {
      const row = metadata?.get(tip.id);
      const vals: number[] = [];
      for (const c of cols) {
        const n = Number(row?.[c]);
        if (Number.isFinite(n)) vals.push(n);
      }
      if (vals.length > 0) replicates.set(tip.id, vals);
    }
    return { replicates };
  }
  if (panel.kind === "heat" && panel.columns && panel.columns.length > 0) {
    const matrix = new Map<number, string[]>();
    for (const tip of tips) {
      const row = metadata?.get(tip.id);
      matrix.set(tip.id, panel.columns.map((c) => row?.[c] ?? ""));
    }
    return { matrix };
  }
  // Single-column.
  const col = panel.column ?? panel.columns?.[0];
  const single = new Map<number, string>();
  if (col) {
    for (const tip of tips) {
      single.set(tip.id, metadata?.get(tip.id)?.[col] ?? "");
    }
  }
  return { single };
}

/**
 * Resolve a panel's color scale(s) + numeric domain. A single colored panel gets
 * one ColorScale (numeric -> the chosen / default sequential ramp, categorical ->
 * the brand palette); a heat matrix gets one scale per column. Bars / dots also
 * carry a numeric `domain` for length encoding. `categoryColors` pins the primary
 * category hues so points + strip + legend stay identical to the existing map.
 */
export function buildPanelScales(
  panel: AlignedPanel,
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  categoryColors?: Record<string, string>,
): PanelScales {
  if (!metadata) return {};
  const paletteId = panel.scale?.paletteId;

  if (panel.kind === "heat" && panel.columns && panel.columns.length > 0) {
    const multi = panel.columns.map((c) =>
      buildColorScale(root, metadata, c, { paletteId }),
    );
    return { multi };
  }

  const col = panel.column ?? panel.columns?.[0];
  if (!col) return {};

  // Color scale, pinning the primary category hues for the points/strip layer.
  const scale: ColorScale = buildColorScale(root, metadata, col, {
    paletteId,
    categoryColors:
      (panel.kind === "points" || panel.kind === "strip") && categoryColors
        ? categoryColors
        : undefined,
  });

  // Bars / dots also need a numeric domain for length, anchored at 0 for bars.
  let domain: { min: number; max: number } | undefined;
  if (panel.kind === "bars" || panel.kind === "dots") {
    const vals: number[] = [];
    for (const tip of leaves(root)) {
      const n = Number(metadata.get(tip.id)?.[col]);
      if (Number.isFinite(n)) vals.push(n);
    }
    if (vals.length > 0) {
      domain =
        panel.kind === "bars"
          ? { min: Math.min(0, ...vals), max: Math.max(...vals) }
          : { min: Math.min(...vals), max: Math.max(...vals) };
    } else {
      domain = { min: 0, max: 1 };
    }
  }
  return { scale, domain };
}

/** Whether a column reads numeric (continuous) given the bound metadata. Thin
 *  re-export so callers do not import color-scale directly for one helper. */
export function panelColumnIsNumeric(
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  column: string | undefined,
): boolean {
  return classifyColumn(root, metadata, column) === "numeric";
}
