// Phylo figure -> RenderSpec adapter (phylo Phase 5).
//
// ONE mapping from a tree + a figure spec + a bound metadata table into the
// RenderSpec that lib/phylo/render.ts consumes. Both the Tree Studio (live UI
// state) and the note / chat embed renderer call this, so a figure renders the
// same in the canvas, the export, and an embedded card, with no second copy of
// the mapping to drift.
//
// The persisted forms (PhyloFigureSpec + PhyloMetadataBinding on the sidecar)
// are the inputs an embed has on hand; the Studio passes the same pieces from
// its working state. Pure data in, RenderSpec out, no React, no I/O.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { matchMetadataToTips } from "./layout";
import { matchAlignmentToTips, type Alignment } from "./msa";
import { leaves, type TreeNode } from "./parse";
import {
  buildCategoryColors,
  type FigureScales,
  type FigureTracks,
  type RenderSpec,
} from "./render";
import { projectTracksToPanels } from "./panels";
import { buildColorScale } from "./color-scale";
import type { AlignedPanel, PhyloLayout } from "./types";

/** The track defaults a fresh figure starts from. A persisted figure overrides
 *  only the keys it stored, so an older record (missing a newer track) still
 *  renders with a sensible default rather than undefined. */
export const DEFAULT_FIGURE_TRACKS: FigureTracks = {
  labels: true,
  labelsItalic: true,
  points: true,
  strip: true,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

/** The resolved figure inputs the adapter needs. The Studio passes its live UI
 *  state; the embed resolves these from the stored PhyloFigureSpec +
 *  PhyloMetadataBinding via figureInputsFromStored below. */
export interface FigureInputs {
  layout: PhyloLayout;
  phylogram: boolean;
  /** Show the phylogram scale bar (default on; absent = on). */
  scaleBar?: boolean;
  /** Draw a root edge stub (default off). */
  rootEdge?: boolean;
  /** Draw a full-width time axis (age before present) instead of the scale bar
   *  (default off). */
  timeAxis?: boolean;
  /** Per-figure gap (px) between overlay columns; absent = the default PANEL_GAP.
   *  The collision advisor's "increase column spacing" lever. */
  columnGap?: number;
  /** Legend placement: "right" (default) or "bottom". The advisor's "move the
   *  legend" fix. */
  legendPlacement?: "right" | "bottom";
  tracks: FigureTracks;
  categoryColumn?: string;
  barColumn?: string;
  heatColumns?: string[];
  /** The bound metadata rows, when a table is linked. */
  metaRows?: Record<string, string>[] | null;
  /** The metadata column whose values match tree tip labels. */
  tipColumn?: string;
  /**
   * Optional per-track sequential-palette overrides for numeric columns (Phase 0).
   * Absent means the per-kind defaults (Viridis numeric, brand categorical), so an
   * older figure with no scales renders exactly as before.
   */
  scales?: FigureScales;
  /** Draw legends for the colored tracks. Defaults ON when omitted. */
  legend?: boolean;
  /**
   * The ordered layer stack (phylo Phase 1). When the Studio passes its live
   * layer list, the render takes the consolidated panel path with exactly these
   * panels. When omitted, the adapter PROJECTS panels from the tracks + columns
   * above (the migration read path), so an old saved figure with no stored panels
   * still renders through the one panel system.
   */
  panels?: AlignedPanel[];
  /**
   * The imported sequence alignment (phylo Phase 3), parsed from an aligned FASTA.
   * The Studio passes its in-memory alignment; the adapter joins it to the tips
   * and bins it for the msa panel. Absent for any figure without an alignment, so
   * the msa panel simply draws nothing. Carried as live import-state, never on a
   * persisted panels[] field, so a saved figure is unchanged.
   */
  alignment?: Alignment | null;
  /** Color branches by this metadata column (ggtree aes(color=trait)). A branch
   *  is colored only where its whole descendant clade shares one value. */
  branchColorColumn?: string;
}

/**
 * Paint branch colors from a metadata column: a node's incoming branch is colored
 * only when its ENTIRE descendant clade shares one value (monophyletic), so a
 * transition branch stays the default ink. Honest discrete-trait painting, not
 * ancestral-state reconstruction. Returns a node-id -> color map, or undefined.
 */
function computeBranchColors(
  tree: TreeNode,
  matched: Map<number, Record<string, string>> | undefined,
  column: string | undefined,
): Record<number, string> | undefined {
  if (!column || !matched) return undefined;
  const scale = buildColorScale(tree, matched, column, {});
  const map: Record<number, string> = {};
  // Post-order: returns the shared value of the subtree, or null when mixed/empty.
  const visit = (n: TreeNode): string | null => {
    let shared: string | null;
    if (n.children.length === 0) {
      const v = matched.get(n.id)?.[column];
      shared = v && v.trim() !== "" ? v : null;
    } else {
      let acc: string | null = null;
      let started = false;
      let mixed = false;
      for (const c of n.children) {
        const cv = visit(c);
        if (cv === null) mixed = true;
        else if (!started) {
          acc = cv;
          started = true;
        } else if (cv !== acc) mixed = true;
      }
      shared = mixed || !started ? null : acc;
    }
    if (shared !== null) map[n.id] = scale.colorFor(shared);
    return shared;
  };
  visit(tree);
  return Object.keys(map).length > 0 ? map : undefined;
}

/** The deepest first clade with at least two tips, the default highlight target.
 *  Mirrors the Studio helper so the shared spec includes the same highlight. */
function firstCladeHighlight(
  tree: TreeNode,
): { nodeId: number; label: string; color: string } | null {
  const internal = tree.children.find((c) => c.children.length >= 2);
  if (!internal) return null;
  return {
    nodeId: internal.id,
    label: internal.name || `${leaves(internal).length} tips`,
    color: "#1AA0E6",
  };
}

/**
 * Build the RenderSpec for a tree from a figure + its bound metadata. This is the
 * single mapping the Studio and the embed both call, so what the canvas draws and
 * what an embedded card draws never diverge.
 */
export function figureToRenderSpec(
  tree: TreeNode,
  inputs: FigureInputs,
  size: { width: number; height: number },
): RenderSpec {
  const match =
    inputs.metaRows && inputs.tipColumn
      ? matchMetadataToTips(tree, inputs.metaRows, inputs.tipColumn)
      : null;
  const categoryColors = buildCategoryColors(
    tree,
    match?.matched,
    inputs.categoryColumn,
  );
  // The layer stack: the Studio's live panels when given, else projected from the
  // Phase 0 tracks + columns (the migration read path) so the one panel renderer
  // always draws the figure.
  const panels: AlignedPanel[] =
    inputs.panels ??
    projectTracksToPanels({
      tracks: inputs.tracks,
      category: inputs.categoryColumn || undefined,
      bar: inputs.barColumn || undefined,
      heat:
        inputs.heatColumns && inputs.heatColumns.length > 0
          ? inputs.heatColumns
          : undefined,
      scales: inputs.scales,
      legend: inputs.legend,
    });
  // The msa alignment track: join the imported alignment to the tips + bin it.
  // Resolved once here (the single mapping) so the canvas, export, and embed all
  // draw the same residue matrix. The note surfaces any column binning.
  const alnMatch =
    inputs.alignment && inputs.alignment.records.length > 0
      ? matchAlignmentToTips(tree, inputs.alignment)
      : null;
  const msaTrack = alnMatch
    ? {
        rows: alnMatch.matched,
        kind: alnMatch.binned.kind,
        note:
          alnMatch.binned.binSize > 1
            ? `${alnMatch.binned.sourceColumns} cols binned to ${alnMatch.binned.blocks} (x${alnMatch.binned.binSize})`
            : "",
      }
    : undefined;
  return {
    panels,
    msaTrack,
    layout: inputs.layout,
    phylogram: inputs.phylogram,
    scaleBar: inputs.scaleBar,
    rootEdge: inputs.rootEdge,
    timeAxis: inputs.timeAxis,
    columnGap: inputs.columnGap,
    legendPlacement: inputs.legendPlacement,
    // The radial layouts (circular / fan / inward-circular) get the "circle left,
    // callouts right" treatment: the renderer left-anchors the circle and pulls each
    // ring's name into the right gutter. Inert unless the canvas is widened (width >
    // height), which the Studio does for these layouts.
    circularGutter:
      inputs.layout === "circular" ||
      inputs.layout === "fan" ||
      inputs.layout === "inwardCircular",
    tracks: inputs.tracks,
    columns: {
      category: inputs.categoryColumn || undefined,
      bar: inputs.barColumn || undefined,
      heat:
        inputs.heatColumns && inputs.heatColumns.length > 0
          ? inputs.heatColumns
          : undefined,
    },
    width: size.width,
    height: size.height,
    metadata: match?.matched,
    categoryColors,
    cladeHighlight: inputs.tracks.clade ? firstCladeHighlight(tree) : null,
    branchColors: computeBranchColors(
      tree,
      match?.matched,
      inputs.branchColorColumn,
    ),
    branchColorColumn: inputs.branchColorColumn || undefined,
    scales: inputs.scales,
    legend: inputs.legend,
  };
}

/** The stored figure shape on the sidecar (PhyloFigureSpec), narrowed to what the
 *  adapter reads. Kept local so this module does not pull the heavier types
 *  barrel; the fields match PhyloMeta.figure / PhyloMeta.metadata exactly. */
interface StoredFigure {
  layout?: string;
  branchLengths?: boolean;
  /** Phylogram scale-bar toggle (optional, additive, defaults ON). */
  scaleBar?: boolean;
  /** Root-edge stub toggle (optional, additive, defaults off). */
  rootEdge?: boolean;
  /** Time-axis toggle (optional, additive, defaults off). */
  timeAxis?: boolean;
  /** Per-figure overlay-column gap in px (optional, additive, defaults PANEL_GAP). */
  columnGap?: number;
  /** Legend placement "right" | "bottom" (optional, additive, defaults right). */
  legendPlacement?: "right" | "bottom";
  tracks?: Record<string, boolean>;
  /** Per-track sequential-palette overrides (Phase 0, optional). */
  scales?: FigureScales;
  /** Legend toggle (Phase 0, optional, defaults ON). */
  legend?: boolean;
  /** The ordered layer stack (Phase 1, optional). Absent on a pre-Phase-1 record,
   *  which is why the adapter projects panels from tracks when this is missing. */
  panels?: AlignedPanel[];
  /** Color branches by this metadata column (optional, additive). */
  branchColorColumn?: string;
}
interface StoredMetadata {
  tipColumn?: string;
  rows?: Record<string, string>[];
  categoryColumn?: string;
  barColumn?: string;
  heatColumns?: string[];
}

/**
 * Resolve the FigureInputs from a stored sidecar figure + metadata binding (what
 * an embed reads from phyloApi.get). Mirrors the Studio's restoreSavedFigure so a
 * saved tree embeds looking exactly like its last save. An absent figure falls
 * back to the track defaults (a plain rectangular phylogram with labels).
 */
export function figureInputsFromStored(
  figure: StoredFigure | undefined,
  metadata: StoredMetadata | undefined,
): FigureInputs {
  const stored = figure?.layout;
  const layout: PhyloLayout =
    stored === "circular" ||
    stored === "slanted" ||
    stored === "unrooted" ||
    stored === "fan" ||
    stored === "inwardCircular"
      ? stored
      : "rectangular";
  const phylogram = figure?.branchLengths ?? true;
  const scaleBar = figure?.scaleBar;
  const rootEdge = figure?.rootEdge;
  const timeAxis = figure?.timeAxis;
  const columnGap = figure?.columnGap;
  const legendPlacement = figure?.legendPlacement;
  const tracks: FigureTracks = {
    ...DEFAULT_FIGURE_TRACKS,
    ...((figure?.tracks ?? {}) as Partial<FigureTracks>),
  };
  const scales = figure?.scales;
  const legend = figure?.legend;
  // Pass stored panels through when the record has them (Phase 1+); a pre-Phase-1
  // record has none, so figureToRenderSpec projects them from tracks.
  const panels = figure?.panels;
  const branchColorColumn = figure?.branchColorColumn;
  if (!metadata?.rows) {
    return {
      layout,
      phylogram,
      scaleBar,
      rootEdge,
      timeAxis,
      columnGap,
      legendPlacement,
      tracks,
      metaRows: null,
      scales,
      legend,
      panels,
      branchColorColumn,
    };
  }
  const cols = metadata.rows.length > 0 ? Object.keys(metadata.rows[0]) : [];
  return {
    layout,
    phylogram,
    scaleBar,
    rootEdge,
    timeAxis,
    columnGap,
    legendPlacement,
    tracks,
    metaRows: metadata.rows,
    tipColumn: metadata.tipColumn || cols[0] || "",
    categoryColumn: metadata.categoryColumn ?? cols[1] ?? "",
    barColumn: metadata.barColumn ?? "",
    heatColumns: metadata.heatColumns ?? [],
    scales,
    legend,
    panels,
    branchColorColumn,
  };
}
