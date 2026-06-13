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
  layout: "rectangular" | "circular";
  phylogram: boolean;
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
}

const FG = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#1AA0E6"; // brand-sky
const PANEL_BG = "#ffffff";
const BORDER = "#e2e8f0";

/** Width reserved on the right edge for the legend column, when any legend draws. */
const LEGEND_WIDTH = 132;

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
export function renderTreeSvg(root: TreeNode, spec: RenderSpec): string {
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
    circularRingRoom:
      spec.layout === "circular" ? circularRingRoom(spec) : 0,
  };
  const body =
    spec.layout === "circular"
      ? renderCircular(root, layoutCircular(root, opts), spec, scales)
      : renderRectangular(root, layoutRectangular(root, opts), spec, scales);
  const legend =
    legendItems.length > 0
      ? renderLegends(legendItems, plotWidth, spec.height)
      : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}" font-family="system-ui, sans-serif">`,
    `<rect x="0" y="0" width="${spec.width}" height="${spec.height}" fill="${PANEL_BG}"/>`,
    body,
    legend,
    `</svg>`,
  ].join("");
}

/** Reserve horizontal room on the right for the active tracks + labels. */
function rightInsetFor(root: TreeNode, spec: RenderSpec): number {
  if (spec.layout === "circular") return 0;
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

function colorForBranch(
  spec: RenderSpec,
  nodeId: number,
): string {
  return spec.branchColors?.[nodeId] ?? FG;
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
        parts.push(
          `<rect x="12" y="${y0}" width="${plotRight + 6 - 12}" height="${y1 - y0}" rx="6" fill="${spec.cladeHighlight.color}" opacity="0.10"/>`,
          `<text x="16" y="${y0 + 12}" font-size="10" font-weight="700" fill="${spec.cladeHighlight.color}">${esc(spec.cladeHighlight.label)}</text>`,
        );
      }
    }
  }

  // Edges (elbow connectors).
  for (const p of layout.nodes) {
    if (p.parentX === null || p.parentY === null) continue;
    parts.push(
      `<path d="M${p.parentX} ${p.parentY} V${p.y} H${p.x}" fill="none" stroke="${colorForBranch(spec, p.node.id)}" stroke-width="1.5"/>`,
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
  if (spec.phylogram && layout.unitsPerPx) {
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
const STRIP_RING = 8;
const HEAT_RING = 10;
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

interface LegendEntry {
  title: string;
  scale: ColorScale;
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
    parts.push(
      `<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="${FG}">${esc(truncate(entry.title, 16))}</text>`,
    );
    y += 14;

    if (entry.scale.kind === "numeric" && entry.scale.domain) {
      // A vertical gradient bar with min / mid / max ticks.
      const gradId = `lg-${sanitizeId(entry.title)}-${y}`;
      const barH = 56;
      const barW = 12;
      const dom = entry.scale.domain;
      const mid = (dom.min + dom.max) / 2;
      // 5 stops bottom (min) to top (max).
      const stops = Array.from({ length: 6 }, (_, i) => {
        const frac = i / 5; // 0 at top
        const v = dom.max - frac * (dom.max - dom.min);
        return `<stop offset="${(frac * 100).toFixed(0)}%" stop-color="${entry.scale.colorFor(String(v))}"/>`;
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
      const cats = entry.scale.categories ?? [];
      for (const cat of cats) {
        if (y > maxY) break;
        parts.push(
          `<rect x="${x}" y="${y - 8}" width="11" height="11" rx="2" fill="${entry.scale.colorFor(cat)}"/>`,
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
