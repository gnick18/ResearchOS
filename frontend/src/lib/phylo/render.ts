// Phylo Tree Studio, the native SVG figure renderer (Phase 2 + 3).
//
// THIS IS THE SINGLE FILE that emits raw SVG markup for the Studio. It is the
// data-figure twin of the Data Hub plot renderer (lib/datahub/diagnostic-plot.ts
// etc.), so the icon-guard baseline gets ONE small, reviewable entry rather than
// inline figure SVG scattered across components. Everything upstream (parse,
// layout, editing) is pure data; everything downstream (PhyloStudio.tsx) injects
// this string and never writes its own figure SVG.
//
// The renderer takes a laid-out tree (layout.ts) plus a figure spec + bound
// metadata and returns a complete SVG document string. The output feeds both the
// live canvas (dangerouslySetInnerHTML) and the SVG / PNG export path reused from
// Data Hub (downloadSvg / svgToPngBlob), so what you see is exactly what you
// export, one source.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  layoutCircular,
  layoutRectangular,
  layoutUnrooted,
  type CircularLayout,
  type LayoutOptions,
  type RectLayout,
} from "./layout";
import { leaves, type TreeNode } from "./parse";
import {
  buildColorScale,
  EMPTY_FILL,
  type ColorScale,
} from "./color-scale";
import { CATEGORY_PALETTE } from "./render-palette";
import {
  rectTipAxis,
  circularTipAxis,
  mrca,
  collapseClade,
  type TipAxis,
} from "./layout";
import {
  renderPanel,
  renderPanelLegend,
  renderMsaLegend,
  renderValueScaleLegend,
  distributionDomain,
  panelBandThickness,
  type PanelScales,
  type PanelValues,
} from "./panel-render";
import type { AlignmentKind } from "./msa";
import type { LayoutManifest, PlacedBox } from "./layout-manifest";
import {
  projectTracksToPanels,
  extractPanelValues,
  buildPanelScales,
} from "./panels";
import type {
  AlignedPanel,
  CladeAnnotation,
  NodePie,
  PhyloLayout,
  TaxaLink,
  TaxaStrip,
} from "./types";
import {
  renderPlot,
  type AlignedAxis,
  type GroupedLegendItem,
  type AlignedGroupedBarGeometry,
} from "@/lib/datahub/plot-spec";
import type {
  PlotSpec,
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { tipAxisToAlignedAxis } from "./datahub-panel";

export { CATEGORY_PALETTE } from "./render-palette";

/** Which annotation tracks are on, and which metadata column drives each. */
export interface FigureTracks {
  labels: boolean;
  /** Italicize tip labels (species convention). */
  labelsItalic: boolean;
  points: boolean;
  strip: boolean;
  bars: boolean;
  heat: boolean;
  clade: boolean;
  support: boolean;
}

export interface FigureColumns {
  /** Categorical column for tip points + color strip. */
  category?: string;
  /** Numeric column for the aligned bar chart. */
  bar?: string;
  /** Columns rendered as a presence / value heatmap panel. */
  heat?: string[];
}

/**
 * Optional per-track color-scale palette overrides (phylo Phase 0). All optional
 * so an older saved spec renders unchanged: a numeric column defaults to Viridis,
 * a categorical column to the brand palette, exactly as before any override.
 */
export interface FigureScales {
  /** Sequential palette id for a numeric category / strip / points column. */
  category?: string;
  /** Sequential palette id for a numeric bar column. */
  bar?: string;
  /** Sequential palette id, per heat column name, for numeric heat columns. */
  heat?: Record<string, string>;
}

export interface RenderSpec {
  layout: PhyloLayout;
  phylogram: boolean;
  /** Show the branch-length scale bar on a phylogram (geom_treescale). Default
   *  on; absent = on (back-compat). Only meaningful for a rectangular phylogram. */
  scaleBar?: boolean;
  /** Draw a short stub branch below the root (ggtree geom_rootedge). Default off. */
  rootEdge?: boolean;
  /** Draw a full-width time axis (age before present) under a rectangular
   *  phylogram, with the tips at age 0 (ggtree theme_tree2). Default off.
   *  Replaces the compact scale bar when on. */
  timeAxis?: boolean;
  /** Per-figure gap (px) between overlay columns; absent = PANEL_GAP. The
   *  collision advisor's "increase column spacing" lever. */
  columnGap?: number;
  /** Where the legends sit: "right" (default, reserved right column) or "bottom"
   *  (a horizontal strip below the figure, freeing the right edge). The advisor's
   *  "move the legend" fix. */
  legendPlacement?: "right" | "bottom";
  /**
   * Circular only: left-anchor the circle and open a right gutter for per-track
   * callouts (each ring's name pulled out to the side at the fan's open gap, with
   * a thin leader) + the legend — the "circle left, annotations right" published
   * look. The Studio sets this for the rooted "circular" layout and widens the
   * canvas to match; it is inert for any caller that does not widen the canvas
   * (it only engages when width > height). */
  circularGutter?: boolean;
  tracks: FigureTracks;
  columns: FigureColumns;
  width: number;
  height: number;
  /** tip id -> metadata row, from matchMetadataToTips. */
  metadata?: Map<number, Record<string, string>>;
  /** Stable category-value -> color, so the strip + points + legend agree. */
  categoryColors?: Record<string, string>;
  /** A clade highlight, by the highlighted clade's root node id + a label. */
  cladeHighlight?: { nodeId: number; label: string; color: string } | null;
  /** Branch color overrides, node id -> color. */
  branchColors?: Record<number, string>;
  /** The metadata column branches are colored by, so the legend can draw its key
   *  (the adapter populates branchColors from it). Absent = no branch coloring. */
  branchColorColumn?: string;
  /**
   * Per-track sequential-palette overrides for numeric columns (Phase 0). Absent
   * means the per-kind defaults (Viridis for numeric, brand for categorical), so
   * an older saved figure with no scales renders exactly as it did before.
   */
  scales?: FigureScales;
  /**
   * Draw a legend for each active colored track. Defaults to ON when omitted so a
   * fresh figure is self-describing; an older saved spec is unaffected (it has no
   * continuous tracks to legend and categorical legends are an additive gain).
   */
  legend?: boolean;
  /**
   * The ordered LAYER stack (phylo Phase 1). When present, the aligned data panels
   * (strip / heat / bars / dots / box) and the tip decorations are driven by THIS
   * array through the shared panel renderer (renderPanel), the geom_fruit
   * consolidation, and the legacy `tracks` / `columns` path is bypassed. When
   * absent, the Phase 0 track path runs unchanged (strict back-compat for a
   * hand-built spec). figure-to-render.ts always supplies panels (projecting from
   * tracks when a saved figure predates the layer stack), so the live Studio and
   * embeds always take the consolidated path.
   */
  panels?: AlignedPanel[];
  /**
   * The imported sequence alignment, joined to tips, that the msa panel draws
   * (phylo Phase 3). Resolved by the Studio / embed from the imported aligned
   * FASTA via lib/phylo/msa.ts matchAlignmentToTips, so the renderer only places
   * + colors residues. Carried on the render spec (NOT on a persisted panels[]
   * field) the same way `metadata` is: a saved figure stores no alignment, so an
   * msa panel with no track here simply draws nothing (no breaking change). When
   * an msa panel is visible AND a track is present, the matrix + its residue
   * legend draw.
   */
  msaTrack?: {
    /** tip id -> the per-tip binned residue row (one char per drawn block). */
    rows: Map<number, string>;
    /** Residue alphabet for the palette (nucleotide vs amino-acid). */
    kind: AlignmentKind;
    /** A short downsample note when the alignment was binned, else empty. */
    note: string;
  };
  /**
   * Resolved Data Hub render inputs for each `datahubPlot` panel, keyed by panel
   * id (phylo Phase 4 tip-aligned plots). Carried on the render spec the same way
   * `msaTrack` + `metadata` are: the Studio / embed loads the table + plot from the
   * Data Hub store and supplies them here, and render.ts hands the tree's
   * alignedAxis to the Data Hub renderPlot (the shared seam). A datahubPlot panel
   * with no entry here draws nothing, so a saved figure that stored only the
   * reference is not a breaking change.
   */
  datahubPanels?: Record<
    string,
    {
      plotSpec: PlotSpec;
      content: DataHubDocContent;
      analysis: AnalysisSpec | null;
    }
  >;
}

const FG = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#1AA0E6"; // brand-sky
const PANEL_BG = "#ffffff";
const BORDER = "#e2e8f0";

/** Width reserved on the right edge for the legend column, when any legend draws. */
const LEGEND_WIDTH = 132;
/** Width of one legend sub-column (the panel path columnizes into these when the
 *  stacked legends would overflow the canvas height). */
const LEGEND_COL_WIDTH = LEGEND_WIDTH;
/** Most legend sub-columns we ever reserve (keeps the figure from collapsing). */
const LEGEND_MAX_COLS = 3;

/** Wrap a figure body + legend in the SVG document shell. The ONE place the
 *  opening svg tag is written, so both render paths share it (and the icon-guard
 *  baseline tracks a single inline svg for this module). */
function svgDocument(
  width: number,
  height: number,
  body: string,
  legend: string,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${PANEL_BG}"/>`,
    body,
    legend,
    `</svg>`,
  ].join("");
}

/** Escape text bound for an SVG text node (labels are user data). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Assign a stable color to each distinct value of a categorical column.
 *  Kept for the existing primary-category path: it builds the SAME stable
 *  value -> hue map the strip + points + legend share. Continuous columns are
 *  handled by buildColorScale; this stays categorical-only by design. */
export function buildCategoryColors(
  root: TreeNode,
  metadata: Map<number, Record<string, string>> | undefined,
  column: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata || !column) return out;
  const seen: string[] = [];
  for (const tip of leaves(root)) {
    const v = metadata.get(tip.id)?.[column];
    if (v && !seen.includes(v)) seen.push(v);
  }
  seen.forEach((v, i) => (out[v] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]));
  return out;
}

/**
 * The resolved per-track scales for a figure, built once per render and shared by
 * the cells (strip / points / bars / heat) and the legend so they never diverge.
 */
interface ResolvedScales {
  /** The category column scale (drives strip + points), null when no column. */
  category: ColorScale | null;
  /** The bar column scale, null when no column. */
  bar: ColorScale | null;
  /** One scale per active heat column, in column order. */
  heat: ColorScale[];
}

/** Resolve every active colored track to its ColorScale (Phase 0). */
function resolveScales(root: TreeNode, spec: RenderSpec): ResolvedScales {
  const meta = spec.metadata;
  const cat = spec.columns.category;
  const bar = spec.columns.bar;
  const heatCols = spec.columns.heat ?? [];
  return {
    category:
      cat && meta
        ? buildColorScale(root, meta, cat, {
            paletteId: spec.scales?.category,
            // Keep the primary-category categorical hues byte-identical to the
            // existing buildCategoryColors map the rest of the app shares.
            categoryColors: spec.categoryColors,
          })
        : null,
    bar:
      bar && meta
        ? buildColorScale(root, meta, bar, { paletteId: spec.scales?.bar })
        : null,
    heat: heatCols
      .filter(() => !!meta)
      .map((col) =>
        buildColorScale(root, meta!, col, {
          paletteId: spec.scales?.heat?.[col],
        }),
      ),
  };
}

/** Build a complete SVG string for the current figure. */
export function renderTreeSvg(
  root: TreeNode,
  spec: RenderSpec,
  outManifest?: PlacedBox[],
): string {
  // The unrooted (equal-angle) layout has no tip line/circle, so it bypasses the
  // panel + aligned-track machinery and draws its own self-contained figure.
  if (spec.layout === "unrooted") return renderUnrooted(root, spec);
  if (spec.panels) return renderFromPanels(root, spec, spec.panels, outManifest);
  return renderFromTracks(root, spec);
}

/**
 * Render AND emit the layout manifest (the bboxes the draw just used) for the
 * collision-aware layout advisor. The manifest is exact (same numbers as the SVG),
 * not a re-derivation. v1 populates the rectangular panel path; other layouts
 * return an empty box list for now. See layout-manifest.ts.
 */
export function renderTreeWithManifest(
  root: TreeNode,
  spec: RenderSpec,
): { svg: string; manifest: LayoutManifest } {
  const boxes: PlacedBox[] = [];
  const svg = renderTreeSvg(root, spec, boxes);
  // plotRight = the right edge of the tree+panels+labels region; the legend column
  // sits past it. Derived from the boxes (the rightmost non-legend element), or the
  // full width when nothing was placed.
  const nonLegend = boxes.filter((b) => b.kind !== "legend");
  const plotRight =
    nonLegend.length > 0
      ? Math.max(...nonLegend.map((b) => b.x + b.w))
      : spec.width;
  return {
    svg,
    manifest: { width: spec.width, height: spec.height, plotRight, boxes },
  };
}

/**
 * Render the unrooted (equal-angle) tree: straight edges through the laid-out
 * point cloud, a small dot at each tip, and a rotated tip label (when a labels
 * layer is on) angled outward along the tip's direction. No aligned panels or
 * scale bar apply to an unrooted tree.
 */
function renderUnrooted(root: TreeNode, spec: RenderSpec): string {
  const labelsOn =
    spec.panels?.some((pp) => pp.visible && pp.kind === "labels") ??
    !!spec.tracks?.labels;
  // Reserve room for the tip labels: they extend radially OUTWARD past each tip,
  // so the node cloud must be inset by roughly the longest label's length, or a
  // tip near the edge gets its label clipped at the canvas. ~5.4px per char at
  // font-size 9, plus the label offset and a margin.
  const longestName = labelsOn
    ? Math.max(0, ...leaves(root).map((t) => t.name.length))
    : 0;
  const labelRoom = labelsOn ? longestName * 5.4 + 16 : 24;
  const layout = layoutUnrooted(root, {
    width: spec.width,
    height: spec.height,
    padding: Math.max(24, labelRoom),
    phylogram: spec.phylogram,
  });
  const parts: string[] = [];
  for (const p of layout.nodes) {
    if (p.parentX === null || p.parentY === null) continue;
    parts.push(
      `<path d="M${p.parentX.toFixed(1)} ${p.parentY.toFixed(1)} L${p.x.toFixed(1)} ${p.y.toFixed(1)}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.4"/>`,
    );
  }
  for (const p of layout.nodes) {
    if (p.node.children.length > 0) continue;
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.6" fill="${FG}"/>`,
    );
    if (labelsOn && p.node.name) {
      const deg = (p.angle * 180) / Math.PI;
      const flip = Math.cos(p.angle) < 0;
      const lx = p.x + Math.cos(p.angle) * 4;
      const ly = p.y + Math.sin(p.angle) * 4;
      const rot = flip ? deg + 180 : deg;
      const anchor = flip ? "end" : "start";
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" fill="${FG}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="${anchor}">${esc(p.node.name)}</text>`,
      );
    }
  }
  return svgDocument(spec.width, spec.height, parts.join(""), "");
}

/** True for the circular family (circular, fan, inward-circular). All three share
 *  the polar layout, the ring panels, and drawCircularTree; only the fan sweep
 *  angle and the tip-label orientation differ. */
function isCircular(layout: PhyloLayout): boolean {
  return (
    layout === "circular" || layout === "fan" || layout === "inwardCircular"
  );
}

/** The fan sweep (degrees) for a layout: an open fan for "fan", else the near-full
 *  circle the rooted circular tree uses. Ignored by the rectangular layout. */
function sweepFor(layout: PhyloLayout): number {
  return layout === "fan" ? 180 : 330;
}

/** Whether the circular tip labels face inward (toward the center). */
function labelsInward(layout: PhyloLayout): boolean {
  return layout === "inwardCircular";
}

/** The Phase 0 track-driven render path (kept for a hand-built spec with no
 *  panels). figure-to-render always supplies panels, so the live app + embeds
 *  take renderFromPanels; this path serves only legacy / test specs. */
function renderFromTracks(root: TreeNode, spec: RenderSpec): string {
  const scales = resolveScales(root, spec);
  const legendOn = spec.legend !== false;
  const legendItems = legendOn ? collectLegends(spec, scales) : [];
  const legendW = legendItems.length > 0 ? LEGEND_WIDTH : 0;
  const plotWidth = Math.max(120, spec.width - legendW);

  const opts: LayoutOptions = {
    width: plotWidth,
    height: spec.height,
    rightInset: rightInsetFor(root, spec),
    padding: 16,
    phylogram: spec.phylogram,
    circularRingRoom: isCircular(spec.layout) ? circularRingRoom(spec) : 0,
    sweepDegrees: sweepFor(spec.layout),
  };
  const body = isCircular(spec.layout)
    ? renderCircular(root, layoutCircular(root, opts), spec, scales)
    : renderRectangular(root, layoutRectangular(root, opts), spec, scales);
  const legend =
    legendItems.length > 0
      ? renderLegends(legendItems, plotWidth, spec.height)
      : "";
  return svgDocument(spec.width, spec.height, body, legend);
}

// ---------------------------------------------------------------------------
// Phase 1: the layer-stack render path. The aligned data panels are drawn
// through the shared panel renderer (one system), the tip decorations on the
// tree, and the legends composited in a right-edge column.
// ---------------------------------------------------------------------------

/** The geoms drawn as aligned columns / rings (through renderPanel). */
const ALIGNED_KINDS = new Set([
  "strip",
  "heat",
  "bars",
  "dots",
  "box",
  "violin",
  "point",
  "scatter",
  "msa",
  "datahubPlot",
]);

/** Default thickness an msa panel occupies when it does not pin its own width
 *  (kept in sync with renderMsa's fallback so room reservation matches the draw). */
const MSA_DEFAULT_THICKNESS = 120;

/** Sum the radial / horizontal room every visible aligned panel needs. The gap
 *  between stacked panels is generous enough that adjacent rings / columns read
 *  as separate bands rather than visually merging (the multi-panel spacing). */
function alignedRoom(panels: AlignedPanel[], gap: number = PANEL_GAP): number {
  let room = 6; // initial gap from the tips
  for (const p of panels) {
    if (!p.visible || !ALIGNED_KINDS.has(p.kind)) continue;
    if (p.kind === "heat") {
      const ncol = p.columns?.length ?? 1;
      room += ncol * (panelBandThickness(p) + 1) + gap;
    } else if (p.kind === "msa") {
      room += (p.width && p.width > 0 ? p.width : MSA_DEFAULT_THICKNESS) + gap;
    } else {
      room += panelBandThickness(p) + gap;
    }
  }
  return room;
}

/** Inter-panel spacing (px) reserved so stacked rings / columns stay distinct. */
const PANEL_GAP = 8;

/** Clamp a tip-label tilt to a sane range; beyond +/-80 deg the text reads as
 *  vertical and the layout math degenerates. */
function clampTilt(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-80, Math.min(80, deg));
}

/**
 * Draw one tip-aligned Data Hub plot panel (phylo Phase 4). Resolves the panel's
 * pre-loaded { plotSpec, content, analysis } off the render spec and hands the
 * tree's alignedAxis to the shared Data Hub renderPlot seam, then translates the
 * returned panel-local fragment to the panel's start cursor. Returns the fragment,
 * its thickness, and its series legend (the tree owns the legend column). v1 is
 * rectangular only (the adapter throws on a circular axis), so a circular layout
 * skips it. LAYOUT ONLY: every figure number is the Data Hub engine's; this just
 * decides WHERE the panel draws.
 */
function renderDatahubPanel(
  panel: AlignedPanel,
  axis: TipAxis,
  spec: RenderSpec,
): { svg: string; thickness: number; legend: GroupedLegendItem[] } | null {
  if (isCircular(spec.layout)) return null; // circular rings: polar fast-follow
  const resolved = spec.datahubPanels?.[panel.id];
  if (!resolved) return null;
  const thickness = panelBandThickness(panel);
  let alignedAxis: ReturnType<typeof tipAxisToAlignedAxis>;
  try {
    alignedAxis = tipAxisToAlignedAxis(axis, thickness);
  } catch {
    return null;
  }
  const r = renderPlot(resolved.plotSpec, resolved.content, resolved.analysis, {
    alignedAxis,
  });
  const geom = r.geometry as AlignedGroupedBarGeometry;
  // renderPlot returns a panel-local <g> fragment: X runs 0..length, Y is already
  // in tree space via the alignedAxis positions, so only X needs the start shift.
  const svg = `<g transform="translate(${axis.panelStartX}, 0)">${r.svg}</g>`;
  return { svg, thickness, legend: geom.legend ?? [] };
}

/**
 * Read a datahubPlot panel's series legend (the renderPlot column groups). The
 * series are content-driven, NOT position-driven, so this renders against a
 * synthetic axis (tip ids in order, dummy positions) only to read geometry.legend
 * before the real layout exists. Lets the legend column be sized to include the
 * Data Hub series before the tree is laid out. Rectangular only (the adapter
 * throws on circular); empty when unresolved.
 */
function datahubPanelLegend(
  panel: AlignedPanel,
  spec: RenderSpec,
  root: TreeNode,
): GroupedLegendItem[] {
  if (isCircular(spec.layout)) return [];
  const resolved = spec.datahubPanels?.[panel.id];
  if (!resolved) return [];
  const tips = leaves(root);
  if (tips.length === 0) return [];
  const probe: AlignedAxis = {
    order: tips.map((t) => String(t.id)),
    positions: tips.map((_, i) => i),
    band: 1,
    orientation: "rows",
  };
  try {
    const r = renderPlot(resolved.plotSpec, resolved.content, resolved.analysis, {
      alignedAxis: probe,
    });
    return (r.geometry as AlignedGroupedBarGeometry).legend ?? [];
  } catch {
    return [];
  }
}

function renderFromPanels(
  rootRaw: TreeNode,
  spec: RenderSpec,
  panels: AlignedPanel[],
  outManifest?: PlacedBox[],
): string {
  const meta = spec.metadata;
  // Collapse any clade marked collapsed to a single leaf before layout; the rest
  // of the render then treats the collapsed tree as the tree, and the draw fns
  // paint a triangle where each collapsed clade was.
  const { root, collapsed } = applyCollapses(rootRaw, panels);
  const aligned = panels.filter(
    (p) => p.visible && ALIGNED_KINDS.has(p.kind),
  );
  const labelsPanel =
    panels.find((p) => p.visible && p.kind === "labels") ?? null;
  const hasLabels = !!labelsPanel;

  // Right-gutter callouts: a radial layout (circular / fan / inward-circular), given
  // a wider-than-tall canvas (the Studio widens it), left-anchors the circle and
  // pulls each ring's name out to the right through the open gap (all three have a
  // clear right side: the rooted fan's 3 o'clock gap, the open fan's empty right
  // half) with a thin leader, so the rings self-identify without bouncing to the
  // legend (Grant's "circle left, callouts right" look). Inert unless widened.
  const gutter =
    !!spec.circularGutter &&
    isCircular(spec.layout) &&
    spec.width > spec.height;

  // Legends, one per colored aligned panel (and colored tip decoration) that asks
  // for one. Tip points are a decoration drawn on the tree, not an aligned panel,
  // but they color by a column too, so their legend is collected alongside.
  const legendOn = spec.legend !== false;
  const coloredPoints = panels.filter(
    (p) => p.visible && p.kind === "points" && !!p.column,
  );
  const legendItems = legendOn
    ? collectPanelLegends(root, spec, [...aligned, ...coloredPoints])
    : [];
  // Branch coloring is a tree decoration, not an aligned panel, so its color key
  // is collected separately (only when a column is bound and a table is linked).
  if (legendOn && spec.branchColorColumn && spec.metadata) {
    legendItems.push({
      title: spec.branchColorColumn,
      scale: buildColorScale(root, spec.metadata, spec.branchColorColumn, {
        categoryColors: spec.categoryColors,
      }),
    });
  }
  // Legend placement (the advisor's "move the legend" fix). Default "right"
  // reserves a right-edge column (unchanged); "bottom" frees the right edge by
  // laying the legends in a horizontal strip below the figure, reducing the tree
  // height. Bottom is the cure when the right column overran the labels.
  const legendBottom =
    spec.legendPlacement === "bottom" && legendItems.length > 0;
  // Reserve one legend sub-column normally; when the stacked legends would run
  // past the canvas height, reserve enough sub-columns to hold them side by side
  // (capped) so they never overlap the figure or each other (multi-panel polish).
  // In gutter mode the callouts own the inner part of the right margin, so cap the
  // legend to a single column at the far right — it never grows back across the
  // callout band (the callouts already carry ring identity, so an overflowing key
  // dropping its tail is acceptable).
  const legendCols =
    legendItems.length > 0 && !legendBottom
      ? gutter
        ? 1
        : legendColumnCount(legendItems, spec.height)
      : 0;
  const legendW = legendCols * LEGEND_COL_WIDTH;
  const plotWidth = Math.max(120, spec.width - legendW);
  // When bottom, reserve a strip whose height holds the wrapped legend rows.
  const legendStripH = legendBottom
    ? bottomLegendStripHeight(legendItems, spec.width)
    : 0;
  const layoutHeight = spec.height - legendStripH;

  // Numbered column headers (Grant 2026-06-16): when 2+ colored columns sit in a
  // RECTANGULAR figure, their text titles collide above the narrow columns ("CLADE"
  // overdrawing "FCZ +2"). Replace those titles with a small numbered badge over each
  // column and prefix the matching legend key with the SAME badge, so each column
  // self-identifies through the legend instead of a cramped header. Circular layouts
  // pull names into gutter callouts instead, so this is rectangular-only. The number
  // is the column's position in the legend key order (the badge and the legend entry
  // share it, so they always agree).
  const numberedHeaders =
    !isCircular(spec.layout) && legendOn && legendItems.length >= 2;
  const legendNumber = new Map<string, number>();
  legendItems.forEach((e, i) => {
    if (!legendNumber.has(e.title)) legendNumber.set(e.title, i + 1);
  });
  const numberFor = (title?: string): number | undefined =>
    title ? legendNumber.get(title) : undefined;

  // Per-figure overlay-column gap (the advisor's spacing lever); absent = default.
  const columnGap = spec.columnGap ?? PANEL_GAP;
  const room = alignedRoom(aligned, columnGap);
  // Tilted tip labels project a narrower horizontal footprint (labelW * cos), so
  // they reserve less right-edge room; 0 tilt keeps the full horizontal reserve.
  const labelTilt = clampTilt(Number(labelsPanel?.options?.tilt) || 0);
  const labelTiltCos = Math.cos((Math.abs(labelTilt) * Math.PI) / 180);
  const labelReserve = hasLabels
    ? Math.max(12, longestLabelPx(root) * labelTiltCos)
    : 8;
  const labelRoom = labelReserve;

  const opts: LayoutOptions = {
    width: plotWidth,
    height: layoutHeight,
    rightInset:
      isCircular(spec.layout) ? 0 : room + labelRoom + 8,
    padding: 16,
    phylogram: spec.phylogram,
    circularRingRoom: isCircular(spec.layout) ? room + 4 : 0,
    // Reserve only the label room the figure draws (labelRoom is ~8 when labels are
    // off), so a label-less circular tree gets that radius back for the tree.
    circularLabelRoom: isCircular(spec.layout) ? labelRoom : undefined,
    sweepDegrees: sweepFor(spec.layout),
    circularGutter: gutter,
  };

  const parts: string[] = [];
  let axis: TipAxis;
  let panelStart: number; // x cursor (rect) / radius cursor (circular)
  // The circular layout's center/radius, hoisted so the post-loop callout pass can
  // place leaders + labels relative to the circle (only used in gutter mode).
  let circLayout: ReturnType<typeof layoutCircular> | null = null;

  if (isCircular(spec.layout)) {
    const layout = layoutCircular(root, opts);
    circLayout = layout;
    drawCircularTree(parts, root, layout, spec, panels, collapsed);
    axis = circularTipAxis(root, layout, layout.radius + 6);
    panelStart = axis.ringStartR;
  } else {
    const layout = layoutRectangular(root, opts);
    const { plotRight, decorRight } = drawRectTree(
      parts,
      root,
      layout,
      spec,
      panels,
      collapsed,
    );
    axis = rectTipAxis(root, layout, plotRight + 8);
    // Start the aligned panels / tip labels past any right-side decoration so a
    // strip / bracket / taxalink gets its own column instead of painting under
    // the labels (the ggtree per-geom offset). Math.max keeps the no-decoration
    // case identical to plotRight-based placement.
    panelStart = Math.max(axis.panelStartX, decorRight + 10);
  }

  // Layout-manifest emission (collision-aware advisor). v1 covers the rectangular
  // path, where crowding was reported; the y-extent of the tip band is shared by
  // every panel column + the labels.
  const wantManifest = !!outManifest && !isCircular(spec.layout);
  const tipYs = axis.tips.map((t) => t.y);
  const tipTop = tipYs.length ? Math.min(...tipYs) : 0;
  const tipBot = tipYs.length ? Math.max(...tipYs) : spec.height;
  const bandPad = axis.bandHeight / 2;
  const colY = tipTop - bandPad;
  const colH = tipBot - tipTop + axis.bandHeight;

  // Draw each aligned panel in order, advancing the cursor by its thickness plus
  // a spacing gap so stacked rings / columns stay visually distinct. A small panel
  // title sits above each panel (rectangular) so a reader knows what each column /
  // ring is, the multi-panel readability fix. In gutter mode the circular titles
  // are not drawn inline; their (name, radius band) is collected here and rendered
  // as pulled-out callouts after the loop.
  const callouts: { title: string; rInner: number; rOuter: number }[] = [];
  const recordCallout = (panel: AlignedPanel, rInner: number, thick: number) => {
    // A multi-column panel (e.g. a heat panel over FCZ / AMB / MCF) draws one
    // ring per column, so give each ring its own callout at its sub-band, matching
    // the per-track names in Grant's sketch. Single-column / msa panels get one.
    const cols = panel.columns;
    if (cols && cols.length > 1) {
      cols.forEach((col, i) => {
        if (!col) return;
        callouts.push({
          title: col,
          rInner: rInner + (i / cols.length) * thick,
          rOuter: rInner + ((i + 1) / cols.length) * thick,
        });
      });
      return;
    }
    const title = panelTitleText(panel, spec);
    if (title) callouts.push({ title, rInner, rOuter: rInner + thick });
  };
  let cursor = panelStart;
  for (const panel of aligned) {
    const localAxis: TipAxis =
      isCircular(spec.layout)
        ? { ...axis, ringStartR: cursor }
        : { ...axis, panelStartX: cursor };
    // A datahubPlot panel delegates its draw to the Data Hub renderPlot seam
    // (a self-contained fragment placed at the cursor), not the metadata path.
    if (panel.kind === "datahubPlot") {
      const drawn = renderDatahubPanel(panel, localAxis, spec);
      if (drawn) {
        if (gutter) recordCallout(panel, cursor, drawn.thickness);
        else if (numberedHeaders)
          parts.push(rectColumnBadges(panel, localAxis, spec, drawn.thickness, numberFor));
        else parts.push(panelTitle(panel, localAxis, spec, root, meta));
        parts.push(drawn.svg);
        if (wantManifest)
          outManifest!.push({
            id: panel.id,
            kind: "panel",
            x: cursor,
            y: colY,
            w: drawn.thickness,
            h: colH,
            label: panelTitleText(panel, spec) || undefined,
          });
        cursor += drawn.thickness + columnGap;
      }
      continue;
    }
    // The msa panel reads its per-tip residue rows from the alignment track on the
    // spec (not from the bound metadata); every other panel reads the metadata.
    const values: PanelValues =
      panel.kind === "msa"
        ? spec.msaTrack
          ? {
              msa: spec.msaTrack.rows,
              msaKind: spec.msaTrack.kind,
              msaNote: spec.msaTrack.note,
            }
          : {}
        : extractPanelValues(panel, root, meta);
    const scales = buildPanelScales(panel, root, meta, spec.categoryColors);
    const r = renderPanel(panel, localAxis, values, scales);
    if (r.thickness > 0) {
      if (gutter) recordCallout(panel, cursor, r.thickness);
      else if (numberedHeaders)
        parts.push(rectColumnBadges(panel, localAxis, spec, r.thickness, numberFor));
      else parts.push(panelTitle(panel, localAxis, spec, root, meta));
      parts.push(r.svg);
      if (wantManifest)
        outManifest!.push({
          id: panel.id,
          kind: "panel",
          x: cursor,
          y: colY,
          w: r.thickness,
          h: colH,
          label: panelTitleText(panel, spec) || undefined,
        });
      cursor += r.thickness + columnGap;
    }
  }

  // Tip labels (outermost), drawn past the last panel.
  if (labelsPanel) {
    drawLabels(parts, root, axis, spec, cursor, labelsPanel);
    if (wantManifest) {
      // The tip-label box is the ACTUAL oriented label ink: its natural horizontal
      // rectangle (width = the tip name's drawn width, height = the font size) plus
      // the tilt as a real rotation about the label's baseline anchor. The crowding
      // detector tests the true oriented rectangles (SAT), so BOTH reversible label
      // fixes measurably help: shrinking the font shrinks the box, and tilting turns
      // the labels into parallel diagonal strips that genuinely stop colliding. (The
      // old model spanned the full row band, so crowding was over-reported and no
      // reversible fix could ever clear it.)
      const labelFs = Number(labelsPanel.options?.fontSize) || 11;
      const nameById = new Map(leaves(root).map((l) => [l.id, l.name]));
      for (const t of axis.tips) {
        const name = nameById.get(t.id) ?? "";
        outManifest!.push({
          id: `tipLabel:${t.id}`,
          kind: "tipLabel",
          x: cursor,
          y: t.y - labelFs / 2,
          w: Math.max(2, name.length * labelFs * 0.6),
          h: labelFs,
          angle: labelTilt || undefined,
          label: name || undefined,
        });
      }
    }
  }

  // Pulled-out per-track callouts (gutter mode): each ring's name in the right
  // margin, connected to the ring by a thin leader through the fan's open gap. The
  // circle was left-anchored, so the band right of the left square is free for them
  // (and the single-column legend sits at the far right).
  if (gutter && circLayout && callouts.length > 0) {
    parts.push(
      drawCircularCallouts(callouts, circLayout, layoutHeight, plotWidth, spec),
    );
  }

  // Scale bar (rectangular phylogram only) is drawn inside drawRectTree.
  const legend =
    legendItems.length === 0
      ? ""
      : legendBottom
        ? renderPanelLegendRow(
            legendItems,
            spec.width,
            layoutHeight,
            legendStripH,
            numberedHeaders,
          )
        : renderPanelLegendColumn(
            legendItems,
            plotWidth,
            spec.height,
            legendCols,
            numberedHeaders,
          );
  if (wantManifest && legendItems.length > 0)
    outManifest!.push({
      id: "legend",
      kind: "legend",
      // Bottom strip spans the full width below the figure; right column sits past
      // the plot. The right column's ink starts at plotWidth + 12 (the 12px reserved
      // gap is NOT legend territory), so anchor the box there - otherwise tip labels
      // sitting in the right margin falsely register as legend overlaps.
      x: legendBottom ? 0 : plotWidth + 12,
      y: legendBottom ? layoutHeight : 0,
      w: legendBottom ? spec.width : legendW,
      h: legendBottom ? legendStripH : spec.height,
      label: `${legendItems.length} legend keys`,
    });

  return svgDocument(spec.width, spec.height, parts.join(""), legend);
}

/** A short human title for a panel, from its bound column(s) or its kind. */
function panelTitleText(
  panel: AlignedPanel,
  spec: RenderSpec,
): string {
  if (panel.kind === "msa") {
    return spec.msaTrack ? "Alignment" : "";
  }
  if (panel.columns && panel.columns.length > 0) {
    return panel.columns.length <= 2
      ? panel.columns.join(", ")
      : `${panel.columns[0]} +${panel.columns.length - 1}`;
  }
  return panel.column ?? "";
}

/**
 * A small per-panel title above the panel band so a reader knows what each
 * column / ring is (the multi-panel readability fix, especially for circular
 * where the rings are otherwise unlabeled). Rectangular sits the label just
 * above the topmost tip at the panel's left edge; circular sits it above the
 * ring's start radius. Returns empty when there is nothing meaningful to label.
 */
function panelTitle(
  panel: AlignedPanel,
  localAxis: TipAxis,
  spec: RenderSpec,
  root: TreeNode,
  meta: Map<number, Record<string, string>> | undefined,
): string {
  void root;
  void meta;
  const title = panelTitleText(panel, spec);
  if (!title) return "";
  if (localAxis.layout === "rectangular") {
    const top = localAxis.tips.length
      ? Math.min(...localAxis.tips.map((t) => t.y))
      : 0;
    const y = top - localAxis.bandHeight / 2 - 2;
    return `<text x="${localAxis.panelStartX}" y="${y}" font-size="8.5" font-weight="600" fill="${MUTED}">${esc(truncate(title, 18))}</text>`;
  }
  // Circular: a compact label just outside the ring start, at the top of the fan.
  const r = localAxis.ringStartR;
  const lx = localAxis.cx;
  const ly = localAxis.cy - r - 4;
  return `<text x="${lx}" y="${ly}" font-size="8.5" font-weight="600" fill="${MUTED}" text-anchor="middle">${esc(truncate(title, 18))}</text>`;
}

/** A small numbered marker: a white disc with a black ring + the number, used to tie
 *  a column header to its legend key (Grant's "1 surrounded in black"). */
function numberBadge(cx: number, cy: number, n: number): string {
  const r = 6.5;
  return (
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="#ffffff" stroke="#111111" stroke-width="1.3"/>` +
    `<text x="${cx.toFixed(1)}" y="${(cy + 2.7).toFixed(1)}" font-size="8.5" font-weight="700" fill="#111111" text-anchor="middle">${n}</text>`
  );
}

/**
 * Rectangular column headers as numbered badges (the multi-column readability fix):
 * one badge centered over each column (a multi-column heat panel gets one per
 * sub-column), keyed to the matching legend entry by number. Columns with no legend
 * key (so no number) draw nothing. Replaces the crowding text titles when 2+ columns
 * share the header band.
 */
function rectColumnBadges(
  panel: AlignedPanel,
  localAxis: TipAxis,
  spec: RenderSpec,
  thickness: number,
  numberFor: (title?: string) => number | undefined,
): string {
  const x0 = localAxis.panelStartX;
  const top = localAxis.tips.length
    ? Math.min(...localAxis.tips.map((t) => t.y))
    : 0;
  const cy = top - localAxis.bandHeight / 2 - 6;
  const out: string[] = [];
  const badgeAt = (frac: number, title?: string) => {
    const n = numberFor(title);
    if (n) out.push(numberBadge(x0 + frac * thickness, cy, n));
  };
  if (panel.kind === "heat" && panel.columns && panel.columns.length > 0) {
    const cols = panel.columns;
    cols.forEach((col, i) => badgeAt((i + 0.5) / cols.length, col));
  } else if (panel.kind === "msa") {
    if (spec.msaTrack) badgeAt(0.5, "Alignment");
  } else {
    badgeAt(
      0.5,
      panel.column ??
        panel.columns?.[0] ??
        (typeof panel.options?.title === "string"
          ? panel.options.title
          : undefined),
    );
  }
  return out.join("");
}

/**
 * Pulled-out per-track callouts for a left-anchored circular tree (gutter mode).
 * Each ring's name is stacked in the right margin and tied to its ring by a thin
 * leader that exits through the fan's open gap at 3 o'clock — so "CLADE / FCZ /
 * AMB / MCF" read straight off the figure instead of via the side legend (Grant's
 * pulled-out sketch). The circle sits in the left height-sized square, so the band
 * from there to the single-column legend is the callouts' room.
 */
function drawCircularCallouts(
  callouts: { title: string; rInner: number; rOuter: number }[],
  layout: { cx: number; cy: number; radius: number },
  layoutHeight: number,
  plotWidth: number,
  spec: RenderSpec,
): string {
  const { cx, cy } = layout;
  const outerMost = Math.max(...callouts.map((c) => c.rOuter));
  // Text column: just past the left square, and clear of the outermost ring's ink.
  // Hold it left of the legend column (plotWidth) so the two never collide.
  const labelX = Math.min(
    Math.max(layoutHeight + 14, cx + outerMost + 26),
    plotWidth - 6,
  );
  const railX = labelX - 14; // the leaders' vertical knee, just left of the text
  const gap = 15;
  const stackH = (callouts.length - 1) * gap;
  // Center the stack on the fan's open gap (3 o'clock = cy), clamped into canvas.
  const topY = Math.min(
    Math.max(cy - stackH / 2, 16),
    layoutHeight - stackH - 12,
  );
  const parts: string[] = [];
  callouts.forEach((c, i) => {
    const labelY = topY + i * gap;
    const rMid = (c.rInner + c.rOuter) / 2;
    // Anchor on the ring at the open gap (cartesian angle 0 -> straight right).
    const ax = cx + rMid;
    const ay = cy;
    // Orthogonal bracket leader: exit the ring horizontally through the open gap
    // at 3 o'clock (all anchors share y=cy so these stubs sit collinearly, reading
    // as one line, never crossing), then drop down the shared vertical rail to the
    // label's row, then a short tick. A single diagonal anchor->label segment used
    // to fan out and the diagonals crossed each other once 3+ rings stacked.
    parts.push(
      `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.6" fill="${MUTED}"/>`,
      `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${railX.toFixed(1)} ${ay.toFixed(1)} L${railX.toFixed(1)} ${labelY.toFixed(1)} L${(labelX - 4).toFixed(1)} ${labelY.toFixed(1)}" fill="none" stroke="${MUTED}" stroke-width="0.75"/>`,
      `<text x="${labelX.toFixed(1)}" y="${(labelY + 3).toFixed(1)}" font-size="9.5" font-weight="600" fill="${FG}">${esc(truncate(c.title, 16))}</text>`,
    );
  });
  void spec;
  return parts.join("");
}

/** The tip-marker shapes a points layer can map a categorical column onto
 *  (ggtree aes(shape = ...)). Order is the assignment order per distinct value. */
type TipShape = "circle" | "square" | "triangle" | "diamond";
const TIP_SHAPES: TipShape[] = ["circle", "square", "triangle", "diamond"];

/** One tip marker of a given shape, centered at (cx, cy) with "radius" r. */
function shapeMarker(
  cx: number,
  cy: number,
  r: number,
  shape: TipShape,
  fill: string,
): string {
  const x = cx.toFixed(1);
  const y = cy.toFixed(1);
  const rr = r.toFixed(2);
  switch (shape) {
    case "square":
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}" fill="${fill}"/>`;
    case "triangle":
      return `<path d="M${x} ${(cy - r).toFixed(1)} L${(cx + r).toFixed(1)} ${(cy + r).toFixed(1)} L${(cx - r).toFixed(1)} ${(cy + r).toFixed(1)} Z" fill="${fill}"/>`;
    case "diamond":
      return `<path d="M${x} ${(cy - r).toFixed(1)} L${(cx + r).toFixed(1)} ${y} L${x} ${(cy + r).toFixed(1)} L${(cx - r).toFixed(1)} ${y} Z" fill="${fill}"/>`;
    default:
      return `<circle cx="${x}" cy="${y}" r="${rr}" fill="${fill}"/>`;
  }
}

/** Resolve per-tip radius + shape for a points layer from its optional
 *  size-by-column (numeric, scaled to a radius range) and shape-by-column
 *  (categorical, mapped to the marker set). Absent options give the fixed
 *  default, so a points layer with no styling reads exactly as before. */
function pointStyling(
  panel: AlignedPanel,
  spec: RenderSpec,
  root: TreeNode,
  baseR: number,
  /** Upper bound on the marker radius, from the per-tip spacing, so dense trees
   *  draw distinct dots instead of one merged blob. Defaults to no cap. */
  maxR: number = Infinity,
): { radiusFor: (id: number) => number; shapeFor: (id: number) => TipShape } {
  const opts = panel.options ?? {};
  const sizeCol = typeof opts.sizeColumn === "string" ? opts.sizeColumn : "";
  const shapeCol = typeof opts.shapeColumn === "string" ? opts.shapeColumn : "";
  const meta = spec.metadata;
  // Clamp every marker to the spacing cap (and a small floor so it never vanishes).
  const clamp = (r: number) => Math.max(0.8, Math.min(r, maxR));
  let radiusFor = (_id: number) => clamp(baseR);
  if (sizeCol && meta) {
    const vals: number[] = [];
    for (const tip of leaves(root)) {
      const v = Number(meta.get(tip.id)?.[sizeCol]);
      if (Number.isFinite(v)) vals.push(v);
    }
    if (vals.length > 0) {
      const mn = Math.min(...vals);
      const span = Math.max(...vals) - mn || 1;
      radiusFor = (id: number) => {
        const v = Number(meta.get(id)?.[sizeCol]);
        if (!Number.isFinite(v)) return clamp(baseR * 0.7);
        return clamp(2.5 + ((v - mn) / span) * 5);
      };
    }
  }
  let shapeFor = (_id: number): TipShape => "circle";
  if (shapeCol && meta) {
    const map = new Map<string, TipShape>();
    for (const tip of leaves(root)) {
      const v = meta.get(tip.id)?.[shapeCol];
      if (v && !map.has(v)) map.set(v, TIP_SHAPES[map.size % TIP_SHAPES.length]);
    }
    shapeFor = (id: number): TipShape => {
      const v = meta.get(id)?.[shapeCol];
      return (v && map.get(v)) || "circle";
    };
  }
  return { radiusFor, shapeFor };
}

/** The smallest distance between two adjacent tip markers (in tip order). A dense
 *  tree caps its dot radius to ~half of this so the markers stay distinct instead
 *  of merging into one blob. Layout-agnostic (Euclidean): an arc gap for circular,
 *  a band gap for rectangular. Infinity when there are fewer than two tips. */
function tipMarkerSpacing(
  root: TreeNode,
  byId: ReadonlyMap<number, { x: number; y: number }>,
): number {
  const tips = leaves(root);
  let min = Infinity;
  for (let i = 1; i < tips.length; i++) {
    const a = byId.get(tips[i - 1].id);
    const b = byId.get(tips[i].id);
    if (a && b) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return min;
}

/** Left x of a clade highlight band: the MIDDLE of the clade MRCA's stem branch
 *  (conventional ggtree geom_hilight anchor), so the band hugs the clade from its
 *  branching point. The root clade has no stem (parentX null), so it falls back to
 *  the tree-base inset. Never left of x=12. */
function cladeRootLeft(cladeRoot: { x: number; parentX: number | null }): number {
  const stemMid =
    cladeRoot.parentX === null ? 12 : (cladeRoot.parentX + cladeRoot.x) / 2;
  return Math.max(12, stemMid);
}

/** Draw the rectangular tree spine + clade + support + points. Returns `plotRight`
 *  (the x of the deepest tip, where the tip axis starts) and `decorRight` (the
 *  rightmost x reached by any in-tree right-side decoration — clade brackets,
 *  span strips, taxalink bows, incl their labels). The caller starts the aligned
 *  panels / tip labels past `decorRight` so decorations get their own column and
 *  never paint under the labels (the ggtree per-geom `offset` idea). */
function drawRectTree(
  parts: string[],
  root: TreeNode,
  layout: RectLayout,
  spec: RenderSpec,
  panels: AlignedPanel[],
  collapsed: Map<number, CollapsedNode> = new Map(),
): { plotRight: number; decorRight: number } {
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
  const plotRight = Math.max(...layout.nodes.map((p) => p.x));
  // Rightmost extent of any right-side decoration; grows as brackets/strips/links
  // are placed so the caller can reserve a column for them. ~6px/char approximates
  // the 10px decoration-label glyph advance (matches the boxed-label heuristic).
  let decorRight = plotRight;
  const labelW = (s: string) => s.length * 6 + 4;
  const showSupport = panels.some((p) => p.visible && p.kind === "support");
  const pointsPanel = panels.find((p) => p.visible && p.kind === "points");

  for (const hl of resolveCladeHighlights(root, panels, spec)) {
    const cladeRoot = layout.nodes.find((p) => p.node.id === hl.nodeId);
    if (!cladeRoot) continue;
    const cl = leaves(cladeRoot.node).map((t) => byId.get(t.id)!);
    if (cl.length === 0) continue;
    const ys = cl.map((c) => c.y);
    if (hl.style === "label") {
      // A bracket spanning the clade's tips just past the tree edge, label
      // alongside (ggtree geom_cladelab).
      const ymin = Math.min(...ys);
      const ymax = Math.max(...ys);
      const bx = plotRight + 8;
      parts.push(
        `<path d="M${bx} ${ymin.toFixed(1)} L${bx + 4} ${ymin.toFixed(1)} L${bx + 4} ${ymax.toFixed(1)} L${bx} ${ymax.toFixed(1)}" fill="none" stroke="${hl.color}" stroke-width="1.5"/>`,
      );
      if (hl.label) {
        parts.push(
          `<text x="${bx + 8}" y="${((ymin + ymax) / 2 + 3).toFixed(1)}" font-size="10" font-weight="700" fill="${hl.color}">${esc(hl.label)}</text>`,
        );
      }
      decorRight = Math.max(decorRight, bx + 8 + (hl.label ? labelW(hl.label) : 0));
    } else {
      const y0 = Math.min(...ys) - 12;
      const y1 = Math.max(...ys) + 12;
      // Anchor the highlight's left edge at the MIDDLE of the clade MRCA's stem
      // branch (conventional geom_hilight placement), so the band hugs the clade
      // from its branching point rather than running to the tree base. The root
      // clade has no stem branch, so it falls back to the tree-base inset.
      const xLeft = cladeRootLeft(cladeRoot);
      parts.push(
        `<rect x="${xLeft.toFixed(1)}" y="${y0}" width="${(plotRight + 6 - xLeft).toFixed(1)}" height="${y1 - y0}" rx="6" fill="${hl.color}" opacity="0.10"/>`,
      );
      if (hl.label) {
        parts.push(
          `<text x="${(xLeft + 4).toFixed(1)}" y="${y0 + 12}" font-size="10" font-weight="700" fill="${hl.color}">${esc(hl.label)}</text>`,
        );
      }
    }
  }
  // Node-age range bars (ggtree geom_range): a horizontal bar through each node
  // spanning a parsed {lo,hi} annotation interval (e.g. height_95%_HPD), drawn in
  // branch-length / age coordinates so it reads against the time axis. Under the
  // spine so the branches + node points sit on top. Rectangular phylogram only.
  const rangePanel = panels.find((p) => p.visible && p.kind === "noderange");
  if (rangePanel && spec.phylogram && layout.unitsPerPx) {
    const upp = layout.unitsPerPx;
    const key =
      (typeof rangePanel.options?.rangeKey === "string" &&
        rangePanel.options.rangeKey) ||
      "height_95%_HPD";
    const color =
      (typeof rangePanel.options?.color === "string" &&
        rangePanel.options.color) ||
      "#2563EB";
    for (const p of layout.nodes) {
      const v = p.node.annotations?.[key];
      if (!Array.isArray(v) || v.length < 2) continue;
      // The interval width in px (age span / unitsPerPx). Anchor the bar ON its
      // node (centered at p.x) so the uncertainty always passes through the node
      // point — a phylogram plots nodes by branch-length-from-root, so an
      // absolute-age x only coincides with the node when the tree is ultrametric;
      // centering keeps the bar seated on the node for non-ultrametric trees too.
      const w = Math.abs(v[1] - v[0]) / upp;
      if (!(w > 0)) continue;
      const x0 = p.x - w / 2;
      parts.push(
        `<rect x="${x0.toFixed(1)}" y="${(p.y - 3).toFixed(1)}" width="${w.toFixed(1)}" height="6" rx="3" fill="${color}" opacity="0.35"/>`,
      );
    }
  }
  // A slanted cladogram draws a straight diagonal from parent to child; the
  // default rectangular tree draws the right-angle elbow (vertical then
  // horizontal). Node positions are identical, so panels / labels are unchanged.
  const slanted = spec.layout === "slanted";
  // Optional root edge: a short stub branch to the left of the root (geom_rootedge).
  if (spec.rootEdge) {
    const r = layout.nodes.find((p) => p.parentX === null);
    if (r) {
      parts.push(
        `<path d="M${(r.x - 16).toFixed(1)} ${r.y.toFixed(1)} L${r.x.toFixed(1)} ${r.y.toFixed(1)}" fill="none" stroke="${colorForBranch(spec, r.node.id)}" stroke-width="1.5"/>`,
      );
    }
  }
  for (const p of layout.nodes) {
    if (p.parentX === null || p.parentY === null) continue;
    const d = slanted
      ? `M${p.parentX} ${p.parentY} L${p.x} ${p.y}`
      : `M${p.parentX} ${p.parentY} V${p.y} H${p.x}`;
    parts.push(
      `<path d="${d}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.5"/>`,
    );
    if (showSupport && p.node.children.length > 0 && p.node.support !== null) {
      parts.push(
        `<text x="${p.parentX + 3}" y="${p.y - 3}" font-size="9" fill="${MUTED}">${p.node.support}</text>`,
      );
    }
  }
  // Node / root point glyphs (ggtree geom_nodepoint / geom_rootpoint), drawn on
  // the tree over the branches.
  const nodePointsPanel =
    panels.find((p) => p.visible && p.kind === "nodepoints") ?? null;
  if (nodePointsPanel) {
    const npo = nodePointsPanel.options ?? {};
    const r = Number(npo.size) || 3;
    const color =
      (typeof npo.color === "string" && npo.color) || "#374151";
    const showRoot = !!npo.showRoot;
    for (const p of layout.nodes) {
      const isRoot = p.parentX === null || p.parentY === null;
      if (isRoot) {
        if (showRoot)
          parts.push(
            `<circle cx="${p.x}" cy="${p.y}" r="${(r + 1).toFixed(1)}" fill="${color}" stroke="#ffffff" stroke-width="0.75"/>`,
          );
        continue;
      }
      if (p.node.children.length > 0)
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}"/>`);
    }
  }
  if (pointsPanel) {
    const scale =
      pointsPanel.column && spec.metadata
        ? buildColorScale(root, spec.metadata, pointsPanel.column, {
            paletteId: pointsPanel.scale?.paletteId,
            categoryColors: spec.categoryColors,
          })
        : null;
    const { radiusFor, shapeFor } = pointStyling(
      pointsPanel,
      spec,
      root,
      4,
      tipMarkerSpacing(root, byId) * 0.45,
    );
    for (const tip of leaves(root)) {
      if (collapsed.has(tip.id)) continue; // a collapsed clade shows a triangle
      const p = byId.get(tip.id)!;
      const fill = scale
        ? scale.colorFor(spec.metadata?.get(tip.id)?.[pointsPanel.column ?? ""])
        : MUTED;
      parts.push(
        shapeMarker(p.x + 6, p.y, radiusFor(tip.id), shapeFor(tip.id), fill),
      );
    }
  }
  for (const [id, info] of collapsed) {
    const ln = byId.get(id);
    if (ln) parts.push(collapsedTriangleRect(ln.x, ln.y, info));
  }
  // Node pies / stars (ggtree nodepie): a glyph at the MRCA of the named tips.
  for (const pie of resolveNodePies(root, panels)) {
    const np = byId.get(pie.nodeId);
    if (np) parts.push(nodePieSvg(np.x, np.y, pie));
  }
  // Tip-to-tip links (ggtree geom_taxalink): a curve between two named tips,
  // bowing to the right of the tree so it does not cross the spine.
  const links = resolveTaxaLinks(panels);
  if (links.length > 0) {
    const byName = new Map(leaves(root).map((t) => [t.name, byId.get(t.id)!]));
    for (const link of links) {
      const a = byName.get(link.from);
      const b = byName.get(link.to);
      if (!a || !b) continue;
      const x0 = Math.max(a.x, b.x);
      // Bow outward (right) proportional to how far apart the tips are.
      const bow = 24 + Math.abs(a.y - b.y) * 0.35;
      const cx = x0 + bow;
      const cy = (a.y + b.y) / 2;
      parts.push(
        `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${link.color || "#7C3AED"}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.9"/>`,
      );
      // A quadratic bow peaks at ~half the control offset, so the curve reaches
      // x0 + bow/2; reserve to there so labels clear the dashed link.
      decorRight = Math.max(decorRight, x0 + bow / 2 + 4);
    }
  }
  // Span strips (ggtree geom_strip): a solid bar just past the tree edge spanning
  // the range from one named tip to another, with an optional label.
  const strips = resolveTaxaStrips(panels);
  if (strips.length > 0) {
    const byName = new Map(leaves(root).map((t) => [t.name, byId.get(t.id)!]));
    const bx = plotRight + 10;
    for (const s of strips) {
      const a = byName.get(s.from);
      const b = byName.get(s.to);
      if (!a || !b) continue;
      const y0 = Math.min(a.y, b.y) - 5;
      const y1 = Math.max(a.y, b.y) + 5;
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${y0.toFixed(1)}" width="5" height="${(y1 - y0).toFixed(1)}" rx="2" fill="${s.color || "#1D9E75"}"/>`,
      );
      if (s.label) {
        parts.push(
          `<text x="${(bx + 9).toFixed(1)}" y="${((y0 + y1) / 2 + 3).toFixed(1)}" font-size="10" font-weight="700" fill="${s.color || "#1D9E75"}">${esc(s.label)}</text>`,
        );
      }
      decorRight = Math.max(decorRight, bx + (s.label ? 9 + labelW(s.label) : 5));
    }
  }
  // Time axis (ggtree theme_tree2): a full-width ruler in age-before-present, the
  // tips at age 0 and the root at the maximum depth. Replaces the compact scale
  // bar when on. Only meaningful for a rectangular phylogram.
  if (spec.phylogram && spec.timeAxis && layout.unitsPerPx) {
    const upp = layout.unitsPerPx;
    const rootNode = layout.nodes.find((p) => p.parentX === null);
    const rootX = rootNode ? rootNode.x : 16;
    const maxDepth = layout.maxDepth;
    const step = niceAxisStep(maxDepth / 5);
    const y = spec.height - 16;
    const xForAge = (age: number) => rootX + (maxDepth - age) / upp;
    const x0 = xForAge(maxDepth); // oldest (root end)
    const x1 = xForAge(0); // present (tip end)
    parts.push(
      `<line x1="${x0.toFixed(1)}" y1="${y}" x2="${x1.toFixed(1)}" y2="${y}" stroke="${MUTED}" stroke-width="1"/>`,
    );
    for (let age = 0; age <= maxDepth + 1e-9; age += step) {
      const x = xForAge(age);
      parts.push(
        `<line x1="${x.toFixed(1)}" y1="${(y - 3).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 3).toFixed(1)}" stroke="${MUTED}" stroke-width="1"/>`,
        `<text x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}" font-size="8.5" fill="${MUTED}" text-anchor="middle">${formatAxisTick(age)}</text>`,
      );
    }
  } else if (spec.phylogram && spec.scaleBar !== false && layout.unitsPerPx) {
    const tick = niceTick(layout.maxDepth);
    const px = tick / layout.unitsPerPx;
    const y = spec.height - 6;
    parts.push(
      `<line x1="16" y1="${y}" x2="${16 + px}" y2="${y}" stroke="${MUTED}" stroke-width="1.5"/>`,
      `<text x="16" y="${y - 4}" font-size="9" fill="${MUTED}">${tick}</text>`,
    );
  }
  return { plotRight, decorRight };
}

/** A 1/2/5 x 10^n "nice" step at or below the target, for axis ticks. */
function niceAxisStep(target: number): number {
  if (!(target > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const f = target / pow;
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nice * pow;
}

/** Trim a tick value to a short label (no trailing zeros). */
function formatAxisTick(v: number): string {
  if (Math.abs(v) < 1e-9) return "0";
  return Number(v.toFixed(4)).toString();
}

/** Draw the circular tree spine + points (clade / support are deferred in the
 *  circular layout for Phase 1, matching the Phase 0 circular renderer scope). */
function drawCircularTree(
  parts: string[],
  root: TreeNode,
  layout: CircularLayout,
  spec: RenderSpec,
  panels: AlignedPanel[],
  collapsed: Map<number, CollapsedNode> = new Map(),
): void {
  // Collapsed clades render as wedge triangles fanning out from the node.
  if (collapsed.size > 0) {
    const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
    for (const [id, info] of collapsed) {
      const ln = byId.get(id);
      if (!ln) continue;
      const r1 = ln.radius + 22;
      const dA = Math.min(0.14, 0.03 + info.tipCount * 0.004);
      const pt = (a: number): [number, number] => [
        layout.cx + r1 * Math.cos(a - Math.PI / 2),
        layout.cy + r1 * Math.sin(a - Math.PI / 2),
      ];
      const [b0x, b0y] = pt(ln.angle - dA);
      const [b1x, b1y] = pt(ln.angle + dA);
      parts.push(
        `<path d="M${ln.x.toFixed(1)} ${ln.y.toFixed(1)} L${b0x.toFixed(1)} ${b0y.toFixed(1)} L${b1x.toFixed(1)} ${b1y.toFixed(1)} Z" fill="${info.color}" opacity="0.45" stroke="${info.color}" stroke-width="0.6"/>`,
      );
    }
  }
  // Clade highlights as annulus bands, drawn under the spine. Circular clade
  // highlighting was deferred in Phase 1; it lands here with the multi-clade /
  // MRCA model so a named clade highlights in either layout.
  const highlights = resolveCladeHighlights(root, panels, spec);
  if (highlights.length > 0) {
    const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
    for (const hl of highlights) {
      const cladeRoot = byId.get(hl.nodeId);
      if (!cladeRoot) continue;
      const tips = leaves(cladeRoot.node).map((t) => byId.get(t.id)!);
      if (tips.length === 0) continue;
      const angles = tips.map((t) => t.angle);
      const a0 = Math.min(...angles);
      const a1 = Math.max(...angles);
      const pad = Math.max(0.02, (a1 - a0) * 0.04);
      const innerR = cladeRoot.radius;
      const outerR = Math.max(...tips.map((t) => t.radius)) + 10;
      if (hl.style === "label") {
        // A bracket arc just outside the tips (ggtree geom_cladelab).
        const r = outerR;
        const pt = (a: number): [number, number] => [
          layout.cx + r * Math.cos(a - Math.PI / 2),
          layout.cy + r * Math.sin(a - Math.PI / 2),
        ];
        const [sx, sy] = pt(a0 - pad);
        const [ex, ey] = pt(a1 + pad);
        const large = Math.abs(a1 + pad - (a0 - pad)) > Math.PI ? 1 : 0;
        parts.push(
          `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${hl.color}" stroke-width="1.6"/>`,
        );
      } else {
        parts.push(
          arcBand(layout.cx, layout.cy, innerR, outerR, a0 - pad, a1 + pad, hl.color),
        );
      }
      if (hl.label) {
        const mid = (a0 + a1) / 2;
        const lx = layout.cx + (outerR + 6) * Math.cos(mid - Math.PI / 2);
        const ly = layout.cy + (outerR + 6) * Math.sin(mid - Math.PI / 2);
        parts.push(
          `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" font-weight="700" fill="${hl.color}" text-anchor="middle">${esc(hl.label)}</text>`,
        );
      }
    }
  }
  // Optional root edge: a short radial stub from the root toward the center.
  if (spec.rootEdge) {
    const r = layout.nodes.find((p) => p.parentX === null);
    if (r) {
      const a = r.angle - Math.PI / 2;
      const er = Math.max(0, r.radius - 12);
      parts.push(
        `<path d="M${(layout.cx + r.radius * Math.cos(a)).toFixed(1)} ${(layout.cy + r.radius * Math.sin(a)).toFixed(1)} L${(layout.cx + er * Math.cos(a)).toFixed(1)} ${(layout.cy + er * Math.sin(a)).toFixed(1)}" fill="none" stroke="${colorForBranch(spec, r.node.id)}" stroke-width="1.4"/>`,
      );
    }
  }
  for (const p of layout.nodes) {
    if (
      p.parentX === null ||
      p.parentY === null ||
      p.parentRadius === null ||
      p.parentAngle === null
    )
      continue;
    const ax = layout.cx + p.parentRadius * Math.cos(p.angle - Math.PI / 2);
    const ay = layout.cy + p.parentRadius * Math.sin(p.angle - Math.PI / 2);
    const px = layout.cx + p.parentRadius * Math.cos(p.parentAngle - Math.PI / 2);
    const py = layout.cy + p.parentRadius * Math.sin(p.parentAngle - Math.PI / 2);
    const large = Math.abs(p.angle - p.parentAngle) > Math.PI ? 1 : 0;
    const sweep = p.angle > p.parentAngle ? 1 : 0;
    parts.push(
      `<path d="M${px} ${py} A ${p.parentRadius} ${p.parentRadius} 0 ${large} ${sweep} ${ax} ${ay} L ${p.x} ${p.y}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.4"/>`,
    );
  }
  // Node / root point glyphs (ggtree geom_nodepoint / geom_rootpoint).
  const nodePointsPanel =
    panels.find((p) => p.visible && p.kind === "nodepoints") ?? null;
  if (nodePointsPanel) {
    const npo = nodePointsPanel.options ?? {};
    const r = Number(npo.size) || 3;
    const color = (typeof npo.color === "string" && npo.color) || "#374151";
    const showRoot = !!npo.showRoot;
    for (const p of layout.nodes) {
      const isRoot = p.parentX === null || p.parentY === null;
      if (isRoot) {
        if (showRoot)
          parts.push(
            `<circle cx="${p.x}" cy="${p.y}" r="${(r + 1).toFixed(1)}" fill="${color}" stroke="#ffffff" stroke-width="0.75"/>`,
          );
        continue;
      }
      if (p.node.children.length > 0)
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}"/>`);
    }
  }
  const pointsPanel = panels.find((p) => p.visible && p.kind === "points");
  if (pointsPanel) {
    const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
    const scale =
      pointsPanel.column && spec.metadata
        ? buildColorScale(root, spec.metadata, pointsPanel.column, {
            paletteId: pointsPanel.scale?.paletteId,
            categoryColors: spec.categoryColors,
          })
        : null;
    const { radiusFor, shapeFor } = pointStyling(
      pointsPanel,
      spec,
      root,
      3.5,
      tipMarkerSpacing(root, byId) * 0.45,
    );
    for (const tip of leaves(root)) {
      if (collapsed.has(tip.id)) continue; // a collapsed clade shows a wedge
      const p = byId.get(tip.id)!;
      const fill = scale
        ? scale.colorFor(spec.metadata?.get(tip.id)?.[pointsPanel.column ?? ""])
        : MUTED;
      parts.push(
        shapeMarker(p.x, p.y, radiusFor(tip.id), shapeFor(tip.id), fill),
      );
    }
  }
  // Node pies / stars (ggtree nodepie): a glyph at the MRCA of the named tips.
  {
    const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
    for (const pie of resolveNodePies(root, panels)) {
      const np = byId.get(pie.nodeId);
      if (np) parts.push(nodePieSvg(np.x, np.y, pie));
    }
  }
  // Tip-to-tip links (ggtree geom_taxalink): a curve between two named tips,
  // bowing through the inside of the ring (control pulled toward the center).
  const links = resolveTaxaLinks(panels);
  if (links.length > 0) {
    const byName = new Map(
      layout.nodes
        .filter((p) => p.node.children.length === 0)
        .map((p) => [p.node.name, p]),
    );
    for (const link of links) {
      const a = byName.get(link.from);
      const b = byName.get(link.to);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const cx = mx + (layout.cx - mx) * 0.7;
      const cy = my + (layout.cy - my) * 0.7;
      parts.push(
        `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${link.color || "#7C3AED"}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.9"/>`,
      );
    }
  }
  // Span strips (ggtree geom_strip): an annulus band over the angle range of the
  // two named tips, just outside the ring, with an optional label.
  const strips = resolveTaxaStrips(panels);
  if (strips.length > 0) {
    const byName = new Map(
      layout.nodes
        .filter((p) => p.node.children.length === 0)
        .map((p) => [p.node.name, p]),
    );
    const maxR = Math.max(...layout.nodes.map((p) => p.radius));
    for (const s of strips) {
      const a = byName.get(s.from);
      const b = byName.get(s.to);
      if (!a || !b) continue;
      const a0 = Math.min(a.angle, b.angle) - 0.02;
      const a1 = Math.max(a.angle, b.angle) + 0.02;
      const r0 = maxR + 6;
      const r1 = maxR + 11;
      parts.push(arcBand(layout.cx, layout.cy, r0, r1, a0, a1, s.color || "#1D9E75"));
      if (s.label) {
        const mid = (a0 + a1) / 2;
        const lx = layout.cx + (r1 + 6) * Math.cos(mid - Math.PI / 2);
        const ly = layout.cy + (r1 + 6) * Math.sin(mid - Math.PI / 2);
        parts.push(
          `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" font-weight="700" fill="${s.color || "#1D9E75"}" text-anchor="middle">${esc(s.label)}</text>`,
        );
      }
    }
  }
}

/**
 * Draw tip labels at the outer edge for both layouts (panel path). Honors the
 * labels panel's options (ggtree geom_tiplab / geom_label parity):
 *   italic      -> font-style italic (default on)
 *   fontSize    -> label point size (default 11 rect / 10 circular)
 *   colorColumn -> color each label by a metadata column (aes(color=...))
 *   boxed       -> draw each label in a bordered box (geom = "label"), rect only
 */
function drawLabels(
  parts: string[],
  root: TreeNode,
  axis: TipAxis,
  spec: RenderSpec,
  cursor: number,
  panel: AlignedPanel,
): void {
  const opts = panel.options ?? {};
  const italic = (opts.italic ?? true) as boolean;
  const styleAttr = italic ? ' font-style="italic"' : "";
  const boxed = !!opts.boxed;
  const colorColumn =
    typeof opts.colorColumn === "string" ? opts.colorColumn : "";
  const scale =
    colorColumn && spec.metadata
      ? buildColorScale(root, spec.metadata, colorColumn, {
          categoryColors: spec.categoryColors,
        })
      : null;
  const fillFor = (id: number): string =>
    scale ? scale.colorFor(spec.metadata?.get(id)?.[colorColumn]) : FG;
  // align (default on): every label shares an outer x / radius, with a faint
  // dotted leader from each branch tip to its label (ggtree geom_tiplab
  // align=TRUE). Off: each label sits at its own branch tip (ragged, the ggtree
  // default look). Leaders only draw where there is a real gap (phylograms).
  const align = (opts.align ?? true) as boolean;
  const leader = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${MUTED}" stroke-width="0.5" stroke-dasharray="1 2" opacity="0.55"/>`;

  if (axis.layout === "rectangular") {
    const fs = Number(opts.fontSize) || 11;
    const boxPad = boxed ? 3 : 0;
    // Tilt (degrees): rotate each label around its anchor so long names need less
    // vertical room and stop colliding (the advisor's "tilt tip labels" fix).
    // 0 = horizontal (default, unchanged). Negative reads up-and-to-the-right.
    const tilt = clampTilt(Number(opts.tilt) || 0);
    for (const slot of axis.tips) {
      const fill = fillFor(slot.id);
      const baseX = align ? cursor : slot.x;
      const tx = baseX + 4 + boxPad;
      const ty = slot.y + fs * 0.36;
      const spin = tilt ? ` transform="rotate(${tilt} ${tx.toFixed(1)} ${slot.y.toFixed(1)})"` : "";
      if (align && baseX - slot.x > 4) {
        parts.push(leader(slot.x, slot.y, baseX + 2, slot.y));
      }
      if (boxed) {
        const w = Math.max(8, slot.name.length * fs * 0.6) + 8;
        parts.push(
          `<rect x="${(tx - 4).toFixed(1)}" y="${(slot.y - fs / 2 - 3).toFixed(1)}" width="${w.toFixed(1)}" height="${fs + 6}" rx="3" fill="#ffffff" stroke="${fill}" stroke-width="0.75"${spin}/>`,
        );
      }
      parts.push(
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${fs}"${styleAttr} fill="${fill}"${spin}>${esc(slot.name)}</text>`,
      );
    }
  } else {
    const fs = Number(opts.fontSize) || 10;
    for (const slot of axis.tips) {
      const baseR = align ? cursor : slot.radius;
      const lr = baseR + 4;
      const ca = Math.cos(slot.angle - Math.PI / 2);
      const sa = Math.sin(slot.angle - Math.PI / 2);
      const lx = axis.cx + lr * ca;
      const ly = axis.cy + lr * sa;
      if (align && baseR - slot.radius > 4) {
        parts.push(
          leader(
            axis.cx + slot.radius * ca,
            axis.cy + slot.radius * sa,
            axis.cx + (baseR + 2) * ca,
            axis.cy + (baseR + 2) * sa,
          ),
        );
      }
      const deg = ((slot.angle - Math.PI / 2) * 180) / Math.PI;
      // Inward-circular mirrors the reading direction so labels face the center
      // (still seated just outside the rim, the symmetric inverse of outward).
      const flip = labelsInward(spec.layout) ? ca >= 0 : ca < 0;
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${fs}"${styleAttr} fill="${fillFor(slot.id)}" transform="rotate(${(flip ? deg + 180 : deg).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="${flip ? "end" : "start"}">${esc(slot.name)}</text>`,
      );
    }
  }
}

/** Gather a legend entry per colored aligned panel that requests one. */
function collectPanelLegends(
  root: TreeNode,
  spec: RenderSpec,
  aligned: AlignedPanel[],
): LegendEntry[] {
  const out: LegendEntry[] = [];
  const meta = spec.metadata;
  for (const panel of aligned) {
    if (panel.legend === false) continue;
    // The msa panel's legend is the residue color key (no bound metadata needed),
    // so it is collected even when no metadata table is linked.
    if (panel.kind === "msa") {
      if (spec.msaTrack) {
        out.push({ title: "Alignment", residue: spec.msaTrack.kind });
      }
      continue;
    }
    // A datahubPlot panel's color key is its series (the renderPlot column
    // groups), read from the resolved figure, not from bound metadata. Like msa,
    // it is collected even when no metadata table is linked.
    if (panel.kind === "datahubPlot") {
      const series = datahubPanelLegend(panel, spec, root);
      if (series.length > 0) {
        const title = String(panel.options?.title ?? "Data Hub plot");
        const categoryColors: Record<string, string> = {};
        for (const s of series) categoryColors[s.name] = s.color;
        out.push({
          title,
          scale: {
            column: title,
            kind: "categorical",
            categories: series.map((s) => s.name),
            categoryColors,
            colorFor: (raw) =>
              (raw != null && categoryColors[raw]) || EMPTY_FILL,
          },
        });
      }
      continue;
    }
    if (!meta) continue;
    // Distribution geoms encode value by position with a fixed fill, so they have
    // no color scale. Their legend is a numeric scale-key reading the same domain
    // the geom maps against (critical in circular, where the value axis is only a
    // guide ring with no numbers). Honor the panel's axis-off opt-out.
    if (panel.kind === "violin" || panel.kind === "point" || panel.kind === "scatter") {
      if (panel.options?.axis === false) continue;
      const dom = distributionDomain(panel.kind, extractPanelValues(panel, root, meta));
      if (dom) {
        const title = panel.column ?? panel.columns?.[0] ?? panel.kind;
        out.push({ title, valueScale: { lo: dom.lo, hi: dom.hi } });
      }
      continue;
    }
    const sc: PanelScales = buildPanelScales(panel, root, meta, spec.categoryColors);
    if (panel.kind === "heat" && panel.columns && sc.multi) {
      panel.columns.forEach((col, i) => {
        const s = sc.multi![i];
        if (!s) return;
        if (s.kind === "numeric" || (s.categories?.length ?? 0) > 1) {
          out.push({ title: col, scale: s });
        }
      });
    } else if (sc.scale) {
      const s = sc.scale;
      const title = panel.column ?? "";
      if (!title) continue;
      if (panel.kind === "bars" || panel.kind === "dots") {
        if (s.kind === "numeric") out.push({ title, scale: s });
      } else if (s.kind === "numeric" || (s.categories?.length ?? 0) > 1) {
        out.push({ title, scale: s });
      }
    }
  }
  // Dedupe identical legend keys: one column bound to several geoms (e.g. MIC as
  // BOTH a heat and a bar overlay, which the smart-binding multi-add can produce)
  // otherwise draws the SAME colorbar two or three times, piling redundant keys
  // over the tip labels (the crowded-overlay report, 2026-06-15). Collapse to one
  // per distinct (column, representation) signature, keeping the first.
  const seen = new Set<string>();
  const deduped: LegendEntry[] = [];
  for (const e of out) {
    const sig = e.residue
      ? `r:${e.residue}`
      : e.valueScale
        ? `v:${e.title}:${e.valueScale.lo}:${e.valueScale.hi}`
        : e.scale
          ? `s:${e.title}:${e.scale.kind}:${(e.scale.categories ?? []).join(",")}`
          : `t:${e.title}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(e);
  }
  return deduped;
}

/** A single legend entry's markup + the height it consumed, at (x, y). The msa
 *  residue entry uses the residue-key renderer, every other entry the scale one. */
function renderOneLegend(
  entry: LegendEntry,
  x: number,
  y: number,
  maxY: number,
  num?: number,
): { svg: string; height: number } {
  // When numbered (rectangular numbered headers), draw the matching badge to the
  // left of the key and shift the key right so the title clears it. The badge sits
  // on the title baseline (the title is the first line each sub-renderer draws at y).
  const badgeW = num ? 18 : 0;
  const badge = num ? numberBadge(x + 6.5, y - 3.5, num) : "";
  const ex = x + badgeW;
  const inner = entry.residue
    ? renderMsaLegend(entry.title, entry.residue, ex, y, maxY)
    : entry.valueScale
      ? renderValueScaleLegend(
          entry.title,
          entry.valueScale.lo,
          entry.valueScale.hi,
          ex,
          y,
          maxY,
        )
      : entry.scale
        ? renderPanelLegend(entry.title, entry.scale, ex, y, maxY)
        : { svg: "", height: 0 };
  if (inner.height === 0) return inner;
  return { svg: badge + inner.svg, height: inner.height };
}

/** A cheap height estimate for one legend entry, used both to decide how many
 *  sub-columns to reserve and to wrap during layout (kept in step with the real
 *  renderers so the reserved width matches what draws). */
function estimateLegendHeight(entry: LegendEntry): number {
  const titleH = 14;
  if (entry.residue) {
    const rows = entry.residue === "nucleotide" ? 5 : 8;
    return titleH + rows * 16 + 8;
  }
  // Title (16) + a short ticked axis + tick labels (~24).
  if (entry.valueScale) return 16 + 24;
  if (entry.scale) {
    if (entry.scale.kind === "numeric") return titleH + 56 + 16;
    const cats = entry.scale.categories?.length ?? 1;
    return titleH + cats * 16 + 8;
  }
  return 0;
}

/**
 * How many side-by-side legend sub-columns the reserved area needs so the
 * stacked legends fit within the canvas height without overflow. One column
 * normally; more when the total legend height exceeds the usable height (the
 * multi-panel legend fix at 4+ legends), capped at LEGEND_MAX_COLS.
 */
function legendColumnCount(entries: LegendEntry[], height: number): number {
  const usable = Math.max(40, height - 34);
  let cols = 1;
  let y = 0;
  for (const e of entries) {
    const h = estimateLegendHeight(e);
    if (y > 0 && y + h > usable) {
      cols += 1;
      y = 0;
    }
    y += h;
  }
  return Math.min(LEGEND_MAX_COLS, cols);
}

/**
 * Render the stacked legends in the reserved right-edge area, columnizing across
 * `cols` sub-columns so they fit the canvas height without overlapping the figure
 * or each other (the multi-panel legend fix). Legends stack top to bottom; when
 * the next legend would run past the bottom, the next sub-column starts. A legend
 * that still cannot fit (beyond the last reserved column) is dropped cleanly
 * rather than drawn over the figure.
 */
function renderPanelLegendColumn(
  entries: LegendEntry[],
  plotWidth: number,
  height: number,
  cols: number,
  numbered = false,
): string {
  const startX = plotWidth + 12;
  const topY = 22;
  const maxY = height - 12;
  const parts: string[] = [];
  let col = 0;
  let y = topY;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const h = estimateLegendHeight(entry);
    if (y > topY && y + h > maxY) {
      if (col < cols - 1) {
        col += 1;
        y = topY;
      } else {
        break; // no reserved column left, stop cleanly
      }
    }
    const x = startX + col * LEGEND_COL_WIDTH;
    const r = renderOneLegend(entry, x, y, maxY, numbered ? i + 1 : undefined);
    if (r.height === 0) continue;
    parts.push(r.svg);
    y += r.height;
  }
  return parts.join("");
}

/** How many legend entries fit across the width in one bottom-strip row. */
function legendPerRow(width: number): number {
  return Math.max(1, Math.floor((width - 24) / LEGEND_COL_WIDTH));
}

/** Height (px) a bottom legend strip needs to hold all entries, wrapped across
 *  the width. The row height is the tallest single legend (capped), so a tall
 *  categorical key does not clip. */
function bottomLegendStripHeight(
  entries: LegendEntry[],
  width: number,
): number {
  if (entries.length === 0) return 0;
  const perRow = legendPerRow(width);
  const rows = Math.ceil(entries.length / perRow);
  const rowH = Math.min(
    96,
    Math.max(...entries.map((e) => estimateLegendHeight(e))),
  );
  return rows * rowH + 12;
}

/**
 * Render the legends in a horizontal strip below the figure (placement "bottom"),
 * wrapping left-to-right across the width into stacked rows. Frees the right edge
 * entirely, the cure when the right legend column overran the labels. Each entry
 * occupies one LEGEND_COL_WIDTH slot, the same renderer as the right column.
 */
function renderPanelLegendRow(
  entries: LegendEntry[],
  width: number,
  stripTop: number,
  stripH: number,
  numbered = false,
): string {
  const perRow = legendPerRow(width);
  const rows = Math.max(1, Math.ceil(entries.length / perRow));
  const rowH = stripH > 0 ? (stripH - 8) / rows : 0;
  const maxY = stripTop + stripH;
  const parts: string[] = [];
  entries.forEach((entry, i) => {
    const x = 12 + (i % perRow) * LEGEND_COL_WIDTH;
    const y = stripTop + 6 + Math.floor(i / perRow) * rowH;
    const r = renderOneLegend(entry, x, y, maxY, numbered ? i + 1 : undefined);
    if (r.height > 0) parts.push(r.svg);
  });
  return parts.join("");
}

/** Reserve horizontal room on the right for the active tracks + labels. */
function rightInsetFor(root: TreeNode, spec: RenderSpec): number {
  if (isCircular(spec.layout)) return 0;
  let inset = 16;
  if (spec.tracks.strip) inset += 16;
  if (spec.tracks.bars) inset += 78;
  if (spec.tracks.heat) inset += (spec.columns.heat?.length ?? 0) * 16 + 8;
  if (spec.tracks.labels) inset += longestLabelPx(root);
  return inset;
}

/** Radial room the circular ring tracks (strip / heat / bar) need outside the
 *  tip circle, so the layout shrinks the tree to keep the rings on canvas. */
function circularRingRoom(spec: RenderSpec): number {
  let room = RING_GAP;
  if (spec.tracks.strip) room += STRIP_RING + 2;
  const heatCount =
    spec.tracks.heat && spec.columns.heat ? spec.columns.heat.length : 0;
  if (heatCount > 0) room += heatCount * (HEAT_RING + 1) + 3;
  if (spec.tracks.bars && spec.columns.bar) room += BAR_RING + 3;
  return room;
}

function longestLabelPx(root: TreeNode): number {
  const max = Math.max(8, ...leaves(root).map((t) => t.name.length));
  return Math.min(220, 14 + max * 6.2);
}

/**
 * Return the UNCAPPED tip-label width for the longest leaf name (px). Used to
 * detect overflow: the capped version reserves at most 220 px inside the fixed
 * figure width, but very long accession strings (e.g. HPV58 with 40+ chars)
 * draw wider and clip at the canvas edge. The Studio widens the figure by the
 * excess so labels always render fully, matching the circular-gutter pattern.
 *
 * Character advance uses the same constant as `drawLabels` (fs * 0.6 at fs=11
 * = 6.6 px/char) plus a small leading gap (4 px), which is the actual SVG text
 * width that `drawLabels` places on the canvas. Exported so PhyloStudio.tsx
 * can widen the canvas before rendering.
 */
export function longestLabelPxUncapped(root: TreeNode): number {
  const max = Math.max(8, ...leaves(root).map((t) => t.name.length));
  return 4 + max * 6.6; // matches drawLabels tx offset + fs*0.6
}

/**
 * Extra pixel width a rectangular figure needs beyond FIG_W so tip labels are
 * never clipped at the right canvas edge. Zero when labels are off or when the
 * longest label fits within the 220 px already reserved inside FIG_W.
 * Exported for PhyloStudio to widen both the canvas and the SVG consistently.
 */
export function rectLabelGutterExtra(
  root: TreeNode,
  panels: AlignedPanel[],
): number {
  const hasLabels = panels.some((p) => p.visible && p.kind === "labels");
  if (!hasLabels) return 0;
  const uncapped = longestLabelPxUncapped(root);
  const capped = 220; // the cap inside longestLabelPx that the layout budget uses
  return Math.max(0, uncapped - capped);
}

function colorForBranch(
  spec: RenderSpec,
  nodeId: number,
): string {
  return spec.branchColors?.[nodeId] ?? FG;
}

/**
 * Resolve the clade layer's highlights to node ids. Each clade is named by tip
 * NAMES (resolved through the MRCA, the large-tree QOL) or an explicit node id.
 * An older figure that never set options.clades falls back to the legacy single
 * auto-highlight, so its render is unchanged.
 */
interface ResolvedClade {
  nodeId: number;
  color: string;
  label: string;
  style: "highlight" | "label";
}
function resolveCladeHighlights(
  root: TreeNode,
  panels: AlignedPanel[],
  spec: RenderSpec,
): ResolvedClade[] {
  // Aggregate clades across EVERY visible clade panel, not just the first. A
  // restored figure can carry a tracks-projected empty clade panel, and the user
  // then adds another; finding only the first would silently drop the populated
  // one (the ggtree exporter already walks all clade panels, so this matches it).
  const clades = panels
    .filter((p) => p.visible && p.kind === "clade")
    .flatMap((p) => (p.options?.clades as CladeAnnotation[] | undefined) ?? []);
  if (clades.length > 0) {
    const out: ResolvedClade[] = [];
    for (const c of clades) {
      if (c.collapsed) continue; // collapsed clades render as triangles, not bands
      const nodeId =
        typeof c.node === "number" ? c.node : mrca(root, c.tips ?? []);
      if (nodeId == null) continue;
      out.push({
        nodeId,
        color: c.color || "#1AA0E6",
        label: c.label ?? "",
        style: c.style === "label" ? "label" : "highlight",
      });
    }
    return out;
  }
  return spec.cladeHighlight
    ? [
        {
          nodeId: spec.cladeHighlight.nodeId,
          color: spec.cladeHighlight.color,
          label: spec.cladeHighlight.label,
          style: "highlight",
        },
      ]
    : [];
}

/** All tip-to-tip links across every visible taxalink layer (ggtree
 *  geom_taxalink). Links are stored by tip NAME on the loose options seam, so an
 *  older figure with no taxalink layer simply gets none. */
function resolveTaxaLinks(panels: AlignedPanel[]): TaxaLink[] {
  return panels
    .filter((p) => p.visible && p.kind === "taxalink")
    .flatMap((p) => (p.options?.links as TaxaLink[] | undefined) ?? [])
    .filter((l) => l && l.from && l.to);
}

/** All span strips across every visible taxastrip layer (ggtree geom_strip).
 *  Stored by tip NAME on the loose options seam, so an older figure gets none. */
function resolveTaxaStrips(panels: AlignedPanel[]): TaxaStrip[] {
  return panels
    .filter((p) => p.visible && p.kind === "taxastrip")
    .flatMap((p) => (p.options?.strips as TaxaStrip[] | undefined) ?? [])
    .filter((s) => s && s.from && s.to);
}

/** Each node pie / star resolved to its MRCA node id (ggtree nodepie). Stored by
 *  tip NAME so the target survives a re-layout without internal node labels. */
interface ResolvedNodePie {
  nodeId: number;
  slices: { label: string; value: number; color: string }[];
  style: "pie" | "star";
}
function resolveNodePies(
  root: TreeNode,
  panels: AlignedPanel[],
): ResolvedNodePie[] {
  const pies = panels
    .filter((p) => p.visible && p.kind === "nodepie")
    .flatMap((p) => (p.options?.pies as NodePie[] | undefined) ?? []);
  const out: ResolvedNodePie[] = [];
  for (const pie of pies) {
    if (!pie.tips || pie.tips.length === 0) continue;
    const nodeId = mrca(root, pie.tips);
    if (nodeId == null) continue;
    const slices = (pie.slices ?? []).filter((s) => Number(s.value) > 0);
    if (slices.length === 0) continue;
    out.push({ nodeId, slices, style: pie.style === "star" ? "star" : "pie" });
  }
  return out;
}

/** Draw a pie chart (or a star glyph in the dominant color) centered at (cx, cy).
 *  Shared by both layouts so a node pie reads the same in the rings + columns. */
function nodePieSvg(cx: number, cy: number, pie: ResolvedNodePie): string {
  const r = 9;
  if (pie.style === "star") {
    const top = pie.slices.reduce((a, b) => (b.value > a.value ? b : a));
    const pts: string[] = [];
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 === 0 ? r : r * 0.42;
      const a = (Math.PI / 5) * k - Math.PI / 2;
      pts.push(
        `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`,
      );
    }
    return `<polygon points="${pts.join(" ")}" fill="${top.color}" stroke="#ffffff" stroke-width="0.75"/>`;
  }
  const total = pie.slices.reduce((s, x) => s + x.value, 0) || 1;
  let acc = -Math.PI / 2; // start at 12 o'clock
  const parts: string[] = [
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 0.6).toFixed(1)}" fill="#ffffff"/>`,
  ];
  for (const s of pie.slices) {
    const a0 = acc;
    const a1 = acc + (s.value / total) * Math.PI * 2;
    acc = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    // A full single slice is a circle (an arc back to the same point is a no-op).
    if (pie.slices.length === 1) {
      parts.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${s.color}"/>`,
      );
      break;
    }
    parts.push(
      `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} L${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${s.color}"/>`,
    );
  }
  return parts.join("");
}

/** An annulus-sector band over an angular + radial span, for a circular clade
 *  highlight. Angles use the renderer's (angle - PI/2) screen convention. */
function arcBand(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  fill: string,
): string {
  const pt = (r: number, a: number): [number, number] => [
    cx + r * Math.cos(a - Math.PI / 2),
    cy + r * Math.sin(a - Math.PI / 2),
  ];
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const [ox0, oy0] = pt(r1, a0);
  const [ox1, oy1] = pt(r1, a1);
  const [ix1, iy1] = pt(r0, a1);
  const [ix0, iy0] = pt(r0, a0);
  return `<path d="M${ox0.toFixed(1)} ${oy0.toFixed(1)} A ${r1.toFixed(1)} ${r1.toFixed(1)} 0 ${large} 1 ${ox1.toFixed(1)} ${oy1.toFixed(1)} L ${ix1.toFixed(1)} ${iy1.toFixed(1)} A ${r0.toFixed(1)} ${r0.toFixed(1)} 0 ${large} 0 ${ix0.toFixed(1)} ${iy0.toFixed(1)} Z" fill="${fill}" opacity="0.12"/>`;
}

/** Per-collapsed-node draw info (the triangle's color + the subtree size). */
interface CollapsedNode {
  color: string;
  tipCount: number;
}

function findNodeById(n: TreeNode, id: number): TreeNode | null {
  if (n.id === id) return n;
  for (const c of n.children) {
    const r = findNodeById(c, id);
    if (r) return r;
  }
  return null;
}

/** Rename one node (immutable clone) so a collapsed clade's leaf shows the
 *  annotation label rather than its raw internal name / support value. */
function renameNode(n: TreeNode, id: number, name: string): TreeNode {
  if (n.id === id) return { ...n, name };
  return { ...n, children: n.children.map((c) => renameNode(c, id, name)) };
}

/**
 * Collapse any clade marked `collapsed` in the clade layer to a single leaf (the
 * existing collapseClade primitive), keeping the node id so the renderer can draw
 * a triangle in its place. The clade is resolved on the ORIGINAL tree (by MRCA of
 * its tip names) before the tree is reshaped. Returns the reshaped tree plus a
 * map of collapsed node id -> draw info.
 */
function applyCollapses(
  root: TreeNode,
  panels: AlignedPanel[],
): { root: TreeNode; collapsed: Map<number, CollapsedNode> } {
  // Same aggregation as resolveCladeHighlights: collapse settings can live on any
  // visible clade panel, not only the first one.
  const clades = panels
    .filter((p) => p.visible && p.kind === "clade")
    .flatMap((p) => (p.options?.clades as CladeAnnotation[] | undefined) ?? []);
  const toCollapse = clades.filter((c) => c.collapsed);
  if (toCollapse.length === 0) return { root, collapsed: new Map() };
  const collapsed = new Map<number, CollapsedNode>();
  let acc = root;
  for (const c of toCollapse) {
    const nodeId =
      typeof c.node === "number" ? c.node : mrca(root, c.tips ?? []);
    if (nodeId == null) continue;
    const sub = findNodeById(root, nodeId);
    if (!sub || sub.children.length === 0) continue;
    collapsed.set(nodeId, {
      color: c.color || "#1AA0E6",
      tipCount: leaves(sub).length,
    });
    acc = collapseClade(acc, nodeId);
    if (c.label) acc = renameNode(acc, nodeId, c.label);
  }
  return { root: acc, collapsed };
}

/** A collapsed-clade triangle (rectangular): apex at the node, fanning out by a
 *  fixed depth, its base height scaled to the collapsed tip count. */
function collapsedTriangleRect(
  x: number,
  y: number,
  info: CollapsedNode,
): string {
  const W = 24;
  const H = Math.min(30, 8 + Math.sqrt(info.tipCount) * 4);
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${(x + W).toFixed(1)} ${(y - H / 2).toFixed(1)} L${(x + W).toFixed(1)} ${(y + H / 2).toFixed(1)} Z" fill="${info.color}" opacity="0.45" stroke="${info.color}" stroke-width="0.6"/>`;
}

// ---------------------------------------------------------------------------
// Rectangular renderer.
// ---------------------------------------------------------------------------

function renderRectangular(
  root: TreeNode,
  layout: RectLayout,
  spec: RenderSpec,
  scales: ResolvedScales,
): string {
  const parts: string[] = [];
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
  const lv = leaves(root);
  const tips = lv.map((t) => byId.get(t.id)!);
  const plotRight = Math.max(...layout.nodes.map((p) => p.x));

  // Clade highlight band behind the edges.
  if (spec.tracks.clade && spec.cladeHighlight) {
    const cladeRoot = layout.nodes.find(
      (p) => p.node.id === spec.cladeHighlight!.nodeId,
    );
    if (cladeRoot) {
      const cl = leaves(cladeRoot.node).map((t) => byId.get(t.id)!);
      if (cl.length > 0) {
        const y0 = Math.min(...cl.map((c) => c.y)) - 12;
        const y1 = Math.max(...cl.map((c) => c.y)) + 12;
        // Left edge at the middle of the clade MRCA's stem branch (see the
        // multi-clade path above), not the tree base.
        const xLeft = cladeRootLeft(cladeRoot);
        parts.push(
          `<rect x="${xLeft.toFixed(1)}" y="${y0}" width="${(plotRight + 6 - xLeft).toFixed(1)}" height="${y1 - y0}" rx="6" fill="${spec.cladeHighlight.color}" opacity="0.10"/>`,
          `<text x="${(xLeft + 4).toFixed(1)}" y="${y0 + 12}" font-size="10" font-weight="700" fill="${spec.cladeHighlight.color}">${esc(spec.cladeHighlight.label)}</text>`,
        );
      }
    }
  }

  // Edges (elbow connectors, or straight diagonals for a slanted cladogram).
  const slantedEdges = spec.layout === "slanted";
  for (const p of layout.nodes) {
    if (p.parentX === null || p.parentY === null) continue;
    const d = slantedEdges
      ? `M${p.parentX} ${p.parentY} L${p.x} ${p.y}`
      : `M${p.parentX} ${p.parentY} V${p.y} H${p.x}`;
    parts.push(
      `<path d="${d}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.5"/>`,
    );
    // Support values on internal branches.
    if (
      spec.tracks.support &&
      p.node.children.length > 0 &&
      p.node.support !== null
    ) {
      parts.push(
        `<text x="${p.parentX + 3}" y="${p.y - 3}" font-size="9" fill="${MUTED}">${p.node.support}</text>`,
      );
    }
  }

  // Tip decorations, column by column.
  for (const tip of tips) {
    const y = tip.y;
    const meta = spec.metadata?.get(tip.node.id);
    // The category track (points + strip) colors by its scale: a numeric column
    // is a gradient, a categorical column its hue, an empty cell muted.
    const catColor = scales.category
      ? scales.category.colorFor(
          spec.columns.category ? meta?.[spec.columns.category] : undefined,
        )
      : MUTED;

    let cx = tip.x + 6;
    if (spec.tracks.points) {
      parts.push(`<circle cx="${cx}" cy="${y}" r="4" fill="${catColor}"/>`);
      cx += 10;
    }

    let tx = plotRight + 8;
    if (spec.tracks.strip) {
      parts.push(
        `<rect x="${tx}" y="${y - 9}" width="12" height="18" fill="${catColor}"/>`,
      );
      tx += 16;
    }
    if (spec.tracks.bars && spec.columns.bar) {
      const v = Number(meta?.[spec.columns.bar] ?? "0");
      const range = barRange(root, spec);
      const bw =
        range.max > range.min
          ? ((v - range.min) / (range.max - range.min)) * 64
          : 0;
      // Color the bar by its scale when the column is numeric (gradient by value),
      // else the brand accent, so a length-encoded bar also reads as a heat ramp.
      const barFill =
        scales.bar && scales.bar.kind === "numeric"
          ? scales.bar.colorFor(meta?.[spec.columns.bar])
          : ACCENT;
      parts.push(
        `<rect x="${tx}" y="${y - 7}" width="${Math.max(2, bw)}" height="14" rx="2" fill="${barFill}" opacity="0.9"/>`,
      );
      tx += 78;
    }
    if (spec.tracks.heat && spec.columns.heat) {
      spec.columns.heat.forEach((col, gi) => {
        const raw = meta?.[col] ?? "";
        const fill = heatCellFill(scales.heat[gi], raw);
        parts.push(
          `<rect x="${tx + gi * 16}" y="${y - 7}" width="14" height="14" rx="2" fill="${fill}" stroke="${BORDER}"/>`,
        );
      });
      tx += spec.columns.heat.length * 16 + 8;
    }
    if (spec.tracks.labels) {
      parts.push(
        `<text x="${tx}" y="${y + 4}" font-size="11"${spec.tracks.labelsItalic ? ' font-style="italic"' : ""} fill="${FG}">${esc(tip.node.name)}</text>`,
      );
    }
  }

  // Scale bar (phylogram only).
  if (spec.phylogram && spec.scaleBar !== false && layout.unitsPerPx) {
    const tick = niceTick(layout.maxDepth);
    const px = tick / layout.unitsPerPx;
    const y = spec.height - 6;
    parts.push(
      `<line x1="16" y1="${y}" x2="${16 + px}" y2="${y}" stroke="${MUTED}" stroke-width="1.5"/>`,
      `<text x="16" y="${y - 4}" font-size="9" fill="${MUTED}">${tick}</text>`,
    );
  }
  return parts.join("");
}

/** Range of the bar-chart numeric column across matched tips. */
function barRange(root: TreeNode, spec: RenderSpec): { min: number; max: number } {
  const col = spec.columns.bar;
  if (!col || !spec.metadata) return { min: 0, max: 1 };
  const vals: number[] = [];
  for (const tip of leaves(root)) {
    const v = Number(spec.metadata.get(tip.id)?.[col]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(0, ...vals), max: Math.max(...vals) };
}

/**
 * Fill for one heatmap cell, value-driven (Phase 0). A numeric heat column uses
 * its continuous gradient by value; a categorical column uses its categorical
 * color; a genuinely binary / presence string (yes / present / resistant / 1)
 * falls back to the accent-on / muted-off scheme so legacy presence data still
 * reads. A blank cell is the empty fill. Each heat column owns its own scale.
 */
function heatCellFill(scale: ColorScale | undefined, raw: string): string {
  if (raw.trim() === "") return EMPTY_FILL;
  if (scale && scale.kind === "numeric") return scale.colorFor(raw);
  // Categorical: when the scale split the column into more than one real
  // category, color by it. A single-category column (pure presence flags) reads
  // better as the binary on / off fallback than one flat hue.
  if (scale && scale.kind === "categorical" && (scale.categories?.length ?? 0) > 1) {
    return scale.colorFor(raw);
  }
  return isTruthy(raw) ? ACCENT : EMPTY_FILL;
}

function isTruthy(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return (
    v === "1" ||
    v === "yes" ||
    v === "true" ||
    v === "y" ||
    v === "present" ||
    v === "resistant"
  );
}

/** A round-ish scale-bar tick at roughly a quarter of the tree depth. */
function niceTick(maxDepth: number): number {
  const target = maxDepth / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(target || 1)));
  const candidates = [1, 2, 5, 10].map((m) => m * mag);
  return candidates.reduce((best, c) =>
    Math.abs(c - target) < Math.abs(best - target) ? c : best,
  );
}

// ---------------------------------------------------------------------------
// Circular renderer.
// ---------------------------------------------------------------------------

// Ring track radial thicknesses (circular layout), kept modest so several rings
// fit inside the canvas without overrunning the labels.
const RING_GAP = 6; // gap from the tip radius to the first ring
// Metadata color-wheel ring thicknesses. Kept thin so the rings read as a
// secondary outer band and the tree stays the main object (both the radius
// reservation in circularRingRoom and the drawn ink use these, so they agree).
const STRIP_RING = 5;
const HEAT_RING = 6;
const BAR_RING = 30; // max radial length of a bar in the bar ring

function renderCircular(
  root: TreeNode,
  layout: CircularLayout,
  spec: RenderSpec,
  scales: ResolvedScales,
): string {
  const parts: string[] = [];
  for (const p of layout.nodes) {
    if (
      p.parentX === null ||
      p.parentY === null ||
      p.parentRadius === null ||
      p.parentAngle === null
    )
      continue;
    // Radial step out from the parent radius at the child angle, then an arc.
    const ax = layout.cx + p.parentRadius * Math.cos(p.angle - Math.PI / 2);
    const ay = layout.cy + p.parentRadius * Math.sin(p.angle - Math.PI / 2);
    const px = layout.cx + p.parentRadius * Math.cos(p.parentAngle - Math.PI / 2);
    const py = layout.cy + p.parentRadius * Math.sin(p.parentAngle - Math.PI / 2);
    const large = Math.abs(p.angle - p.parentAngle) > Math.PI ? 1 : 0;
    const sweep = p.angle > p.parentAngle ? 1 : 0;
    parts.push(
      `<path d="M${px} ${py} A ${p.parentRadius} ${p.parentRadius} 0 ${large} ${sweep} ${ax} ${ay} L ${p.x} ${p.y}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.4"/>`,
    );
  }
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]));
  const tips = leaves(root);
  // Half the angular spacing between neighboring tips, the sector half-width a
  // ring wedge fills so wedges meet without overlap.
  const half =
    tips.length > 1
      ? Math.abs(
          (byId.get(tips[1].id)!.angle - byId.get(tips[0].id)!.angle) / 2,
        )
      : 0.05;

  // Radial bands for the rings, inner to outer: strip, heat columns, bars.
  const ringBase = layout.radius + RING_GAP;
  const stripOuter = spec.tracks.strip ? ringBase + STRIP_RING : ringBase;
  const heatInner = stripOuter + (spec.tracks.strip ? 2 : 0);
  const heatCount =
    spec.tracks.heat && spec.columns.heat ? spec.columns.heat.length : 0;
  const heatOuter = heatInner + heatCount * (HEAT_RING + 1);
  const barInner = heatOuter + (heatCount > 0 ? 3 : spec.tracks.strip ? 3 : 0);
  const barOuter = spec.tracks.bars ? barInner + BAR_RING : barInner;
  const labelBase = barOuter + 6;

  const barRng =
    spec.tracks.bars && spec.columns.bar ? barRange(root, spec) : null;

  for (const tip of tips) {
    const p = byId.get(tip.id)!;
    const meta = spec.metadata?.get(tip.id);
    const catColor = scales.category
      ? scales.category.colorFor(
          spec.columns.category ? meta?.[spec.columns.category] : undefined,
        )
      : MUTED;
    if (spec.tracks.points) {
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${catColor}"/>`);
    }
    if (spec.tracks.strip) {
      parts.push(
        annulusWedge(layout.cx, layout.cy, ringBase, stripOuter, p.angle, half, catColor),
      );
    }
    if (heatCount > 0 && spec.columns.heat) {
      spec.columns.heat.forEach((col, gi) => {
        const r0 = heatInner + gi * (HEAT_RING + 1);
        const fill = heatCellFill(scales.heat[gi], meta?.[col] ?? "");
        parts.push(
          annulusWedge(layout.cx, layout.cy, r0, r0 + HEAT_RING, p.angle, half, fill, BORDER),
        );
      });
    }
    if (barRng && spec.columns.bar) {
      const v = Number(meta?.[spec.columns.bar] ?? "0");
      const frac =
        barRng.max > barRng.min
          ? (v - barRng.min) / (barRng.max - barRng.min)
          : 0;
      const len = Math.max(1.5, frac * BAR_RING);
      const barFill =
        scales.bar && scales.bar.kind === "numeric"
          ? scales.bar.colorFor(meta?.[spec.columns.bar])
          : ACCENT;
      parts.push(
        annulusWedge(layout.cx, layout.cy, barInner, barInner + len, p.angle, half * 0.7, barFill),
      );
    }
    if (spec.tracks.labels) {
      const lr = labelBase;
      const lx = layout.cx + lr * Math.cos(p.angle - Math.PI / 2);
      const ly = layout.cy + lr * Math.sin(p.angle - Math.PI / 2);
      const deg = ((p.angle - Math.PI / 2) * 180) / Math.PI;
      const flip = Math.cos(p.angle - Math.PI / 2) < 0;
      parts.push(
        `<text x="${lx}" y="${ly}" font-size="10"${spec.tracks.labelsItalic ? ' font-style="italic"' : ""} fill="${FG}" transform="rotate(${flip ? deg + 180 : deg} ${lx} ${ly})" text-anchor="${flip ? "end" : "start"}">${esc(tip.name)}</text>`,
      );
    }
  }
  return parts.join("");
}

/**
 * One filled annulus-sector wedge for a circular ring cell, centered on a tip's
 * angle and spanning +/- halfAngle. r0 / r1 are the inner / outer radii. Built
 * from two arcs and two radial edges so adjacent tips' wedges tile the ring.
 */
function annulusWedge(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  angle: number,
  halfAngle: number,
  fill: string,
  stroke?: string,
): string {
  const a0 = angle - halfAngle - Math.PI / 2;
  const a1 = angle + halfAngle - Math.PI / 2;
  const x0o = cx + r1 * Math.cos(a0);
  const y0o = cy + r1 * Math.sin(a0);
  const x1o = cx + r1 * Math.cos(a1);
  const y1o = cy + r1 * Math.sin(a1);
  const x1i = cx + r0 * Math.cos(a1);
  const y1i = cy + r0 * Math.sin(a1);
  const x0i = cx + r0 * Math.cos(a0);
  const y0i = cy + r0 * Math.sin(a0);
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="0.5"` : "";
  return (
    `<path d="M${x0o} ${y0o} A ${r1} ${r1} 0 0 1 ${x1o} ${y1o} ` +
    `L ${x1i} ${y1i} A ${r0} ${r0} 0 0 0 ${x0i} ${y0i} Z" fill="${fill}"${strokeAttr}/>`
  );
}

// ---------------------------------------------------------------------------
// Legends. One entry per active colored track, laid out in a right-edge column.
// A categorical legend is labeled swatches; a continuous legend is a gradient
// bar with min / mid / max ticks. Cells and legend read the SAME scale, so the
// legend always matches what was drawn.
// ---------------------------------------------------------------------------

/**
 * One legend entry. Most are a colored-track ColorScale (categorical swatches or
 * a continuous gradient). An msa panel instead carries a residue legend (the
 * fixed nucleotide / amino-acid color key), so the entry is a small union: a
 * `residue` kind picks the residue-key renderer, the absence of it is a scale.
 */
interface LegendEntry {
  title: string;
  scale?: ColorScale;
  /** The residue alphabet, present only for an msa panel's residue-key legend. */
  residue?: AlignmentKind;
  /** The value range, present only for a distribution panel's numeric scale-key
   *  (violin / point / scatter), which encodes value by position not color. */
  valueScale?: { lo: number; hi: number };
}

/** Gather a legend entry for each active colored track, in draw order. */
function collectLegends(spec: RenderSpec, scales: ResolvedScales): LegendEntry[] {
  const out: LegendEntry[] = [];
  const t = spec.tracks;
  if ((t.points || t.strip) && scales.category && spec.columns.category) {
    out.push({ title: spec.columns.category, scale: scales.category });
  }
  if (t.bars && scales.bar && scales.bar.kind === "numeric" && spec.columns.bar) {
    out.push({ title: spec.columns.bar, scale: scales.bar });
  }
  if (t.heat && spec.columns.heat) {
    spec.columns.heat.forEach((col, gi) => {
      const sc = scales.heat[gi];
      // Skip a heat column that drew with the binary on / off fallback, it has no
      // meaningful scale legend (it is presence / absence, self-explanatory).
      if (!sc) return;
      if (sc.kind === "numeric") out.push({ title: col, scale: sc });
      else if ((sc.categories?.length ?? 0) > 1) out.push({ title: col, scale: sc });
    });
  }
  return out;
}

/** A short numeric tick label (drops trailing zeros, keeps it compact). */
function tickLabel(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const s =
    abs !== 0 && (abs >= 1e5 || abs < 1e-3)
      ? n.toExponential(1)
      : Number(n.toFixed(2)).toString();
  return s;
}

/** Render the legend column on the right edge of the canvas. */
function renderLegends(
  entries: LegendEntry[],
  plotWidth: number,
  height: number,
): string {
  const x = plotWidth + 12;
  const parts: string[] = [];
  let y = 22;
  const maxY = height - 12;

  for (const entry of entries) {
    if (y > maxY - 30) break; // out of room, stop cleanly rather than overflow
    // The Phase 0 track path only ever produces scale legends (no msa); guard so
    // the shared LegendEntry union narrows cleanly.
    if (!entry.scale) continue;
    const scale = entry.scale;
    parts.push(
      `<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="${FG}">${esc(truncate(entry.title, 16))}</text>`,
    );
    y += 14;

    if (scale.kind === "numeric" && scale.domain) {
      // A vertical gradient bar with min / mid / max ticks.
      const gradId = `lg-${sanitizeId(entry.title)}-${y}`;
      const barH = 56;
      const barW = 12;
      const dom = scale.domain;
      const mid = (dom.min + dom.max) / 2;
      // 5 stops bottom (min) to top (max).
      const stops = Array.from({ length: 6 }, (_, i) => {
        const frac = i / 5; // 0 at top
        const v = dom.max - frac * (dom.max - dom.min);
        return `<stop offset="${(frac * 100).toFixed(0)}%" stop-color="${scale.colorFor(String(v))}"/>`;
      });
      parts.push(
        `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${stops.join("")}</linearGradient></defs>`,
        `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="url(#${gradId})" stroke="${BORDER}" stroke-width="0.5"/>`,
        `<text x="${x + barW + 5}" y="${y + 8}" font-size="9" fill="${MUTED}">${esc(tickLabel(dom.max))}</text>`,
        `<text x="${x + barW + 5}" y="${y + barH / 2 + 3}" font-size="9" fill="${MUTED}">${esc(tickLabel(mid))}</text>`,
        `<text x="${x + barW + 5}" y="${y + barH}" font-size="9" fill="${MUTED}">${esc(tickLabel(dom.min))}</text>`,
      );
      y += barH + 16;
    } else {
      // Categorical: labeled swatches, one row each.
      const cats = scale.categories ?? [];
      for (const cat of cats) {
        if (y > maxY) break;
        parts.push(
          `<rect x="${x}" y="${y - 8}" width="11" height="11" rx="2" fill="${scale.colorFor(cat)}"/>`,
          `<text x="${x + 16}" y="${y + 1}" font-size="10" fill="${FG}">${esc(truncate(cat, 14))}</text>`,
        );
        y += 16;
      }
      y += 8;
    }
  }
  return parts.join("");
}

/** Truncate a label for the legend column with an ellipsis. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Make a string safe for an SVG id (gradient ids must be unique + valid). */
function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_") || "x";
}
