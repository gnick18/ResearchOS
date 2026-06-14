// Phylo Tree Studio, the aligned-panel renderer framework (phylo Phase 1).
//
// The geom_fruit core: every aligned panel (a column in the rectangular layout, a
// concentric ring in the circular layout) is drawn tip-for-tip against the shared
// TipAxis (layout.ts). ONE pure function, renderPanel, handles all v1 geoms in
// both layouts, so the strip / heat / bars that Phase 0 drew by hand are now one
// system rather than two parallel ones, and a stack of panels just calls this in
// draw order, advancing a cursor (panelStartX in rectangular, ringStartR in
// circular) by each panel's measured thickness.
//
// Color comes from lib/phylo/color-scale.ts (a ColorScale per data column) which
// itself reuses the Data Hub palettes, so we never reinvent color. The box geom
// reuses the Data Hub quantile helper (lib/datahub/engine/util.ts) so a per-tip
// distribution box matches what Data Hub would draw, the bridge to Phase 2.
//
// Pure SVG string out, no DOM, no React. render.ts composes these strings, and is
// still the single module the icon-guard baseline tracks.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { quantileSorted } from "@/lib/datahub/engine/util";
import { niceTicks } from "@/lib/datahub/plot-spec";
import type { AlignedPanel, AlignedPanelKind, PhyloErrorKind } from "./types";
import type { TipAxis, TipSlot } from "./layout";
import { EMPTY_FILL, type ColorScale } from "./color-scale";
import {
  residueColor,
  residueLegend,
  type AlignmentKind,
  type ResidueLegendItem,
} from "./msa";

const ACCENT = "#1AA0E6"; // brand-sky
const MUTED = "#64748b";
const BOX_WHISKER = "#94a3b8";
const BOX_MEDIAN = "#5B47D6";
const BORDER = "#e2e8f0";

/** Escape text bound for an SVG text node (labels are user data). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The per-tip data a panel draws, resolved once by the caller from the bound
 * metadata so the renderer stays pure of the join. `single` maps tip id -> the
 * raw cell of the panel's `column`; `matrix` maps tip id -> one raw cell per
 * `columns` entry (a heat matrix); `replicates` maps tip id -> the numeric
 * replicate values a box geom summarizes. A panel uses only the shape it needs.
 */
export interface PanelValues {
  single?: Map<number, string>;
  matrix?: Map<number, string[]>;
  replicates?: Map<number, number[]>;
  /**
   * Per-tip mean + error magnitude for the point (lollipop) geom, resolved by the
   * caller from either the replicate `columns[]` (mean / sd / sem) or a value
   * `column` + an explicit `errorColumn`. `error` is 0 when the panel's error kind
   * is "none" or no error source is bound.
   */
  pointStats?: Map<number, { mean: number; error: number }>;
  /**
   * The per-tip residue row for the msa geom: tip id -> the (already binned)
   * residue string, one character per drawn block. Resolved by the caller from
   * the matched alignment (lib/phylo/msa.ts matchAlignmentToTips), so the
   * renderer only places + colors cells. `msaKind` picks the residue palette and
   * `msaNote` carries the downsample note when the alignment was binned.
   */
  msa?: Map<number, string>;
  /** Residue alphabet for the msa palette (nucleotide vs amino-acid). */
  msaKind?: AlignmentKind;
  /** A short note drawn above a binned msa panel (empty when full resolution). */
  msaNote?: string;
}

/** The scales a panel reads, one per data column (matrix uses `multi`). */
export interface PanelScales {
  /** The single-column scale (strip / points / bars / dots / single heat). */
  scale?: ColorScale;
  /** One scale per matrix column, in column order (multi-column heat). */
  multi?: ColorScale[];
  /** Numeric domain for a length-encoded geom (bars / dots), across matched tips. */
  domain?: { min: number; max: number };
}

/** What a panel render returns: the markup plus the thickness it consumed, so the
 *  caller advances its cursor and the next panel sits flush against this one. */
export interface PanelRender {
  svg: string;
  /** Radial / horizontal thickness drawn, including the panel's own trailing gap. */
  thickness: number;
}

/** Default thickness (px) per geom when the panel does not pin its own `width`. */
const DEFAULT_THICKNESS: Record<AlignedPanelKind, number> = {
  labels: 0, // labels are sized by the longest name, handled by the caller
  points: 0, // points sit on the tips, no own band
  strip: 16,
  heat: 16,
  bars: 70,
  dots: 36,
  box: 40,
  violin: 40,
  point: 48,
  scatter: 40,
  clade: 0,
  support: 0,
  nodepoints: 0, // glyphs sit on the internal nodes, no own band
  msa: 0,
};

const GAP = 4; // trailing gap after each drawn panel

/** Thickness one column / matrix-column band occupies for a panel. */
export function panelBandThickness(panel: AlignedPanel): number {
  if (panel.width && panel.width > 0) return panel.width;
  return DEFAULT_THICKNESS[panel.kind] ?? 16;
}

/**
 * Render one aligned panel against the shared TipAxis. Returns the SVG plus the
 * thickness it drew so a stack advances cleanly. The panel kinds that are NOT
 * aligned columns (labels / points / clade / support) return empty here,
 * render.ts draws those on the tree itself; this function owns the geom_fruit
 * panels (strip, heat, bars, dots, box, violin, point, scatter) AND the msa
 * alignment matrix. Works in both layouts.
 */
export function renderPanel(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
  scales: PanelScales,
): PanelRender {
  if (!panel.visible) return { svg: "", thickness: 0 };
  switch (panel.kind) {
    case "strip":
      return renderStrip(panel, axis, values, scales);
    case "heat":
      return renderHeat(panel, axis, values, scales);
    case "bars":
      return renderBars(panel, axis, values, scales);
    case "dots":
      return renderDots(panel, axis, values, scales);
    case "box":
      return renderBox(panel, axis, values);
    case "violin":
      return renderViolin(panel, axis, values);
    case "point":
      return renderPoint(panel, axis, values);
    case "scatter":
      return renderScatter(panel, axis, values);
    case "msa":
      return renderMsa(panel, axis, values);
    default:
      return { svg: "", thickness: 0 };
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers shared by every aligned panel.
// ---------------------------------------------------------------------------

/**
 * One filled annulus-sector wedge for a circular ring cell, centered on a tip's
 * angle and spanning +/- halfAngle, between radii r0 and r1. Lifted from the
 * Phase 0 circular renderer so wedges tile the ring exactly as before.
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

/** A point on the circle at radius r along a tip's spoke angle (circular). */
function polarPoint(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): [number, number] {
  return [
    cx + r * Math.cos(angle - Math.PI / 2),
    cy + r * Math.sin(angle - Math.PI / 2),
  ];
}

/** The numeric value for a tip from the single map, or NaN when missing / blank. */
function numAt(values: PanelValues, id: number): number {
  const raw = values.single?.get(id);
  if (raw === undefined || raw.trim() === "") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Strip: one colored cell per tip (categorical band or continuous gradient).
// ---------------------------------------------------------------------------

function renderStrip(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
  scales: PanelScales,
): PanelRender {
  const thick = panelBandThickness(panel);
  const scale = scales.scale;
  const fillFor = (slot: TipSlot): string =>
    scale ? scale.colorFor(values.single?.get(slot.id)) : EMPTY_FILL;
  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const h = Math.min(axis.bandHeight, 18);
    for (const slot of axis.tips) {
      parts.push(
        `<rect x="${axis.panelStartX}" y="${slot.y - h / 2}" width="${thick}" height="${h}" fill="${fillFor(slot)}"/>`,
      );
    }
  } else {
    const r0 = axis.ringStartR;
    for (const slot of axis.tips) {
      parts.push(
        annulusWedge(axis.cx, axis.cy, r0, r0 + thick, slot.angle, axis.halfAngle, fillFor(slot)),
      );
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// Heat: a single value column or a multi-column matrix (gheatmap). Each column
// owns its scale; a numeric column is a gradient, a categorical column its hue.
// ---------------------------------------------------------------------------

function renderHeat(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
  scales: PanelScales,
): PanelRender {
  const cellW = panelBandThickness(panel); // per-column band thickness
  const cols = values.matrix
    ? scales.multi ?? []
    : scales.scale
      ? [scales.scale]
      : [];
  const ncol = values.matrix
    ? cols.length
    : scales.scale
      ? 1
      : 0;
  if (ncol === 0) return { svg: "", thickness: 0 };

  const cellFill = (sc: ColorScale | undefined, raw: string): string => {
    if (raw.trim() === "") return EMPTY_FILL;
    if (sc && sc.kind === "numeric") return sc.colorFor(raw);
    if (sc && sc.kind === "categorical" && (sc.categories?.length ?? 0) > 1) {
      return sc.colorFor(raw);
    }
    return isTruthy(raw) ? ACCENT : EMPTY_FILL;
  };
  const rawFor = (id: number, ci: number): string =>
    values.matrix
      ? values.matrix.get(id)?.[ci] ?? ""
      : values.single?.get(id) ?? "";

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const h = Math.min(axis.bandHeight, 16);
    for (const slot of axis.tips) {
      for (let ci = 0; ci < ncol; ci++) {
        const fill = cellFill(cols[ci], rawFor(slot.id, ci));
        parts.push(
          `<rect x="${axis.panelStartX + ci * (cellW + 1)}" y="${slot.y - h / 2}" width="${cellW}" height="${h}" rx="2" fill="${fill}" stroke="${BORDER}" stroke-width="0.5"/>`,
        );
      }
    }
  } else {
    for (const slot of axis.tips) {
      for (let ci = 0; ci < ncol; ci++) {
        const r0 = axis.ringStartR + ci * (cellW + 1);
        const fill = cellFill(cols[ci], rawFor(slot.id, ci));
        parts.push(
          annulusWedge(axis.cx, axis.cy, r0, r0 + cellW, slot.angle, axis.halfAngle, fill, BORDER),
        );
      }
    }
  }
  return { svg: parts.join(""), thickness: ncol * (cellW + 1) + GAP };
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

// ---------------------------------------------------------------------------
// Bars: a length-encoded aligned bar per tip, optionally colored by value.
// ---------------------------------------------------------------------------

function renderBars(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
  scales: PanelScales,
): PanelRender {
  const thick = panelBandThickness(panel);
  const dom = scales.domain ?? { min: 0, max: 1 };
  const span = dom.max - dom.min;
  const numericScale =
    scales.scale && scales.scale.kind === "numeric" ? scales.scale : null;
  const fracOf = (v: number): number =>
    span > 0 ? Math.max(0, Math.min(1, (v - dom.min) / span)) : 0;
  const fill = (id: number): string =>
    numericScale ? numericScale.colorFor(values.single?.get(id)) : ACCENT;

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const h = Math.min(axis.bandHeight * 0.7, 14);
    for (const slot of axis.tips) {
      const v = numAt(values, slot.id);
      if (Number.isNaN(v)) continue;
      const bw = Math.max(1.5, fracOf(v) * thick);
      parts.push(
        `<rect x="${axis.panelStartX}" y="${slot.y - h / 2}" width="${bw}" height="${h}" rx="2" fill="${fill(slot.id)}" opacity="0.9"/>`,
      );
    }
  } else {
    for (const slot of axis.tips) {
      const v = numAt(values, slot.id);
      if (Number.isNaN(v)) continue;
      const len = Math.max(1.5, fracOf(v) * thick);
      parts.push(
        annulusWedge(
          axis.cx,
          axis.cy,
          axis.ringStartR,
          axis.ringStartR + len,
          slot.angle,
          axis.halfAngle * 0.7,
          fill(slot.id),
        ),
      );
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// Dots: a numeric value as a point positioned (and colored) along the band, the
// lollipop / Cleveland-dot panel. A faint baseline anchors the eye.
// ---------------------------------------------------------------------------

function renderDots(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
  scales: PanelScales,
): PanelRender {
  const thick = panelBandThickness(panel);
  const dom = scales.domain ?? { min: 0, max: 1 };
  const span = dom.max - dom.min;
  const numericScale =
    scales.scale && scales.scale.kind === "numeric" ? scales.scale : null;
  const fracOf = (v: number): number =>
    span > 0 ? Math.max(0, Math.min(1, (v - dom.min) / span)) : 0.5;
  const fill = (id: number): string =>
    numericScale ? numericScale.colorFor(values.single?.get(id)) : ACCENT;

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    // Baseline at the panel's left edge.
    for (const slot of axis.tips) {
      const v = numAt(values, slot.id);
      if (Number.isNaN(v)) continue;
      const cx = axis.panelStartX + fracOf(v) * thick;
      parts.push(
        `<line x1="${axis.panelStartX}" y1="${slot.y}" x2="${cx}" y2="${slot.y}" stroke="${BORDER}" stroke-width="1"/>`,
        `<circle cx="${cx}" cy="${slot.y}" r="3.4" fill="${fill(slot.id)}"/>`,
      );
    }
  } else {
    for (const slot of axis.tips) {
      const v = numAt(values, slot.id);
      if (Number.isNaN(v)) continue;
      const r = axis.ringStartR + fracOf(v) * thick;
      const [bx, by] = polarPoint(axis.cx, axis.cy, axis.ringStartR, slot.angle);
      const [px, py] = polarPoint(axis.cx, axis.cy, r, slot.angle);
      parts.push(
        `<line x1="${bx}" y1="${by}" x2="${px}" y2="${py}" stroke="${BORDER}" stroke-width="1"/>`,
        `<circle cx="${px}" cy="${py}" r="3" fill="${fill(slot.id)}"/>`,
      );
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// Box: a per-tip distribution summarized from replicate columns (min / Q1 /
// median / Q3 / max), drawn radially / horizontally. The first panel that draws
// a real Data Hub primitive (the quantile helper), the bridge to Phase 2.
// ---------------------------------------------------------------------------

/** Five-number summary of a tip's replicates (sorted within). */
function fiveNumber(reps: number[]): {
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
} | null {
  const xs = reps.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  return {
    min: xs[0],
    q1: quantileSorted(xs, 0.25),
    med: quantileSorted(xs, 0.5),
    q3: quantileSorted(xs, 0.75),
    max: xs[xs.length - 1],
  };
}

function renderBox(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
): PanelRender {
  const thick = panelBandThickness(panel);
  const reps = values.replicates;
  if (!reps || reps.size === 0) return { svg: "", thickness: 0 };
  // Shared numeric domain across every tip's replicates, so boxes are comparable.
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of reps.values()) {
    for (const v of arr) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { svg: "", thickness: 0 };
  }
  const span = hi - lo;
  const frac = (v: number): number => (span > 0 ? (v - lo) / span : 0.5);

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const boxH = Math.min(axis.bandHeight * 0.6, 10);
    for (const slot of axis.tips) {
      const s = fiveNumber(reps.get(slot.id) ?? []);
      if (!s) continue;
      const x = (v: number) => axis.panelStartX + frac(v) * thick;
      const y = slot.y;
      parts.push(
        // Whisker line min -> max.
        `<line x1="${x(s.min)}" y1="${y}" x2="${x(s.max)}" y2="${y}" stroke="${BOX_WHISKER}" stroke-width="1.2"/>`,
        // The Q1..Q3 box.
        `<rect x="${x(s.q1)}" y="${y - boxH / 2}" width="${Math.max(1, x(s.q3) - x(s.q1))}" height="${boxH}" fill="${ACCENT}" opacity="0.25" stroke="${ACCENT}" stroke-width="0.8"/>`,
        // The median tick.
        `<circle cx="${x(s.med)}" cy="${y}" r="2.4" fill="${BOX_MEDIAN}"/>`,
      );
    }
  } else {
    for (const slot of axis.tips) {
      const s = fiveNumber(reps.get(slot.id) ?? []);
      if (!s) continue;
      const r = (v: number) => axis.ringStartR + frac(v) * thick;
      const [lx, ly] = polarPoint(axis.cx, axis.cy, r(s.min), slot.angle);
      const [hx, hy] = polarPoint(axis.cx, axis.cy, r(s.max), slot.angle);
      const [mx, my] = polarPoint(axis.cx, axis.cy, r(s.med), slot.angle);
      parts.push(
        `<line x1="${lx}" y1="${ly}" x2="${hx}" y2="${hy}" stroke="${BOX_WHISKER}" stroke-width="1.4"/>`,
        annulusWedge(
          axis.cx,
          axis.cy,
          r(s.q1),
          r(s.q3),
          slot.angle,
          axis.halfAngle * 0.6,
          ACCENT,
        ).replace('fill="', 'opacity="0.25" fill="'),
        `<circle cx="${mx}" cy="${my}" r="2.4" fill="${BOX_MEDIAN}"/>`,
      );
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// Shared helpers for the distribution / value-axis geoms (phylo Phase 2). These
// panels (violin / point+error / scatter) all map a numeric value to a position
// along the panel band against ONE domain shared across every tip, so the panels
// are comparable, and carry a readable value axis ticked by the Data Hub niceTicks
// primitive (reused read-only). The position math mirrors the box geom.
// ---------------------------------------------------------------------------

const AXIS_TICK = "#cbd5e1";

/** The combined [min, max] of every tip's replicate values, null when empty. */
function sharedDomain(
  reps: Map<number, number[]> | undefined,
): { lo: number; hi: number } | null {
  if (!reps || reps.size === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of reps.values()) {
    for (const v of arr) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { lo, hi };
}

/**
 * The shared value domain a distribution panel (violin / point / scatter) maps
 * against, computed the SAME way its renderer does so a legend scale-key reads
 * the identical range the geom draws. Violin / scatter span every replicate;
 * point spans each tip's mean +/- error. Null when there is nothing to scale.
 */
export function distributionDomain(
  kind: AlignedPanel["kind"],
  values: PanelValues,
): { lo: number; hi: number } | null {
  if (kind === "violin" || kind === "scatter") {
    return sharedDomain(values.replicates);
  }
  if (kind === "point") {
    const stats = values.pointStats;
    if (!stats || stats.size === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const { mean: m, error } of stats.values()) {
      if (!Number.isFinite(m)) continue;
      lo = Math.min(lo, m - error);
      hi = Math.max(hi, m + error);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo === hi) {
      hi += 1;
      lo -= 1;
    }
    return { lo, hi };
  }
  return null;
}

/** Mean of finite numbers, or NaN when none. */
function mean(xs: number[]): number {
  const f = xs.filter((n) => Number.isFinite(n));
  if (f.length === 0) return NaN;
  return f.reduce((s, v) => s + v, 0) / f.length;
}

/** Sample standard deviation of finite numbers (n - 1), or 0 when under two. */
function stddev(xs: number[]): number {
  const f = xs.filter((n) => Number.isFinite(n));
  if (f.length < 2) return 0;
  const m = mean(f);
  const ss = f.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (f.length - 1));
}

/**
 * Draw a faint value axis along the panel's leading edge: a tick label at each
 * niceTicks value, positioned by the same fraction the geom uses. Rectangular
 * lays the ticks under the panel; circular draws a single ring guide (an
 * uncluttered radial axis would overlap the wedges, so we keep it minimal).
 */
function valueAxis(
  axis: TipAxis,
  panelStart: number,
  thick: number,
  lo: number,
  hi: number,
): string {
  const { values } = niceTicks(lo, hi, 4);
  const span = hi - lo;
  const frac = (v: number): number => (span > 0 ? (v - lo) / span : 0.5);
  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const ys = axis.tips.map((t) => t.y);
    const yBottom = (ys.length ? Math.max(...ys) : 0) + axis.bandHeight * 0.6 + 4;
    for (const v of values) {
      if (v < lo - 1e-9 || v > hi + 1e-9) continue;
      const x = panelStart + frac(v) * thick;
      parts.push(
        `<line x1="${x}" y1="${yBottom - 3}" x2="${x}" y2="${yBottom}" stroke="${AXIS_TICK}" stroke-width="1"/>`,
        `<text x="${x}" y="${yBottom + 9}" font-size="7.5" fill="${MUTED}" text-anchor="middle">${esc(axisLabel(v))}</text>`,
      );
    }
  } else {
    // A single dashed guide ring at the panel's inner radius marks the axis start
    // (the value-by-radius scale is shared, so one labeled ring reads cleanly).
    parts.push(
      `<circle cx="${axis.cx}" cy="${axis.cy}" r="${panelStart}" fill="none" stroke="${AXIS_TICK}" stroke-width="0.5" stroke-dasharray="2 3"/>`,
    );
  }
  return parts.join("");
}

/** A compact axis tick label (shared formatting with the legend ticks). */
function axisLabel(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  return abs !== 0 && (abs >= 1e5 || abs < 1e-3)
    ? n.toExponential(1)
    : String(Number(n.toFixed(2)));
}

/** Whether a panel's options request the value axis (default ON). */
function axisOn(panel: AlignedPanel): boolean {
  return panel.options?.axis !== false;
}

/** The point geom's error kind from its options (default sd). */
function errorKindOf(panel: AlignedPanel): PhyloErrorKind {
  const k = panel.options?.errorKind;
  return k === "sem" || k === "none" ? k : "sd";
}

// ---------------------------------------------------------------------------
// Violin: a per-tip distribution drawn as a symmetric density silhouette around
// the tip row (rectangular) / spoke (circular), the box geom's sibling. Density
// is a light Gaussian-kernel estimate over the tip's replicates, sampled along
// the shared value domain so every tip's violin is comparable. Reuses the box's
// replicate binding (columns[]).
// ---------------------------------------------------------------------------

/** A small fixed-bandwidth kernel density estimate sampled at `steps` points
 *  spanning [lo, hi], returned as normalized heights in [0, 1]. */
function densityProfile(
  reps: number[],
  lo: number,
  hi: number,
  steps: number,
): number[] {
  const xs = reps.filter((n) => Number.isFinite(n));
  if (xs.length === 0) return new Array(steps).fill(0);
  const span = hi - lo || 1;
  // Silverman-ish bandwidth, floored so a tight cluster still shows a lobe.
  const sd = stddev(xs) || span * 0.08;
  const bw = Math.max(span * 0.04, 1.06 * sd * Math.pow(xs.length, -0.2));
  const out: number[] = [];
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    const x = lo + (i / (steps - 1)) * span;
    let d = 0;
    for (const v of xs) {
      const u = (x - v) / bw;
      d += Math.exp(-0.5 * u * u);
    }
    out.push(d);
    if (d > peak) peak = d;
  }
  return peak > 0 ? out.map((d) => d / peak) : out;
}

const VIOLIN_FILL = "#1AA0E6";
const DENSITY_STEPS = 24;

function renderViolin(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
): PanelRender {
  const thick = panelBandThickness(panel);
  const reps = values.replicates;
  const dom = sharedDomain(reps);
  if (!reps || !dom) return { svg: "", thickness: 0 };
  const { lo, hi } = dom;
  const span = hi - lo;
  const frac = (v: number): number => (span > 0 ? (v - lo) / span : 0.5);

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const halfH = Math.min(axis.bandHeight * 0.42, 9);
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.panelStartX, thick, lo, hi));
    for (const slot of axis.tips) {
      const prof = densityProfile(reps.get(slot.id) ?? [], lo, hi, DENSITY_STEPS);
      if (prof.every((d) => d === 0)) continue;
      const x = (i: number) =>
        axis.panelStartX + (i / (DENSITY_STEPS - 1)) * thick;
      const top: string[] = [];
      const bot: string[] = [];
      for (let i = 0; i < DENSITY_STEPS; i++) {
        const w = prof[i] * halfH;
        top.push(`${x(i)} ${slot.y - w}`);
        bot.push(`${x(i)} ${slot.y + w}`);
      }
      const d = `M${top.join(" L")} L${bot.reverse().join(" L")} Z`;
      parts.push(
        `<path d="${d}" fill="${VIOLIN_FILL}" opacity="0.35" stroke="${VIOLIN_FILL}" stroke-width="0.8"/>`,
      );
      // Median dot for a reading anchor.
      const xs = (reps.get(slot.id) ?? []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (xs.length > 0) {
        const med = quantileSorted(xs, 0.5);
        parts.push(
          `<circle cx="${axis.panelStartX + frac(med) * thick}" cy="${slot.y}" r="2" fill="${BOX_MEDIAN}"/>`,
        );
      }
    }
  } else {
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.ringStartR, thick, lo, hi));
    for (const slot of axis.tips) {
      const prof = densityProfile(reps.get(slot.id) ?? [], lo, hi, DENSITY_STEPS);
      if (prof.every((d) => d === 0)) continue;
      const r = (i: number) =>
        axis.ringStartR + (i / (DENSITY_STEPS - 1)) * thick;
      const upper: string[] = [];
      const lower: string[] = [];
      for (let i = 0; i < DENSITY_STEPS; i++) {
        const aw = prof[i] * axis.halfAngle * 0.85;
        const [ux, uy] = polarPointAng(axis.cx, axis.cy, r(i), slot.angle - aw);
        const [lx, ly] = polarPointAng(axis.cx, axis.cy, r(i), slot.angle + aw);
        upper.push(`${ux} ${uy}`);
        lower.push(`${lx} ${ly}`);
      }
      const d = `M${upper.join(" L")} L${lower.reverse().join(" L")} Z`;
      parts.push(
        `<path d="${d}" fill="${VIOLIN_FILL}" opacity="0.35" stroke="${VIOLIN_FILL}" stroke-width="0.8"/>`,
      );
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

/** A point at radius r along a tip's spoke at an explicit angle (violin edges). */
function polarPointAng(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): [number, number] {
  return [
    cx + r * Math.cos(angle - Math.PI / 2),
    cy + r * Math.sin(angle - Math.PI / 2),
  ];
}

// ---------------------------------------------------------------------------
// Point + error (lollipop): one point per tip at the mean with an SD / SEM
// whisker. The mean + error come pre-resolved on values.pointStats (from the
// replicate columns OR a value + error column pair), so the renderer only places
// them against the shared domain. Error kind "none" draws a bare point.
// ---------------------------------------------------------------------------

const POINT_FILL = "#1AA0E6";

function renderPoint(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
): PanelRender {
  const thick = panelBandThickness(panel);
  const stats = values.pointStats;
  if (!stats || stats.size === 0) return { svg: "", thickness: 0 };
  // Shared domain across every tip's mean +/- error, so points are comparable
  // (the legend scale-key reads this same range via distributionDomain).
  const dom = distributionDomain("point", values);
  if (!dom) return { svg: "", thickness: 0 };
  const { lo, hi } = dom;
  const span = hi - lo;
  const frac = (v: number): number => (span > 0 ? (v - lo) / span : 0.5);

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.panelStartX, thick, lo, hi));
    const cap = Math.min(axis.bandHeight * 0.3, 4);
    for (const slot of axis.tips) {
      const st = stats.get(slot.id);
      if (!st || !Number.isFinite(st.mean)) continue;
      const cx = axis.panelStartX + frac(st.mean) * thick;
      const y = slot.y;
      if (st.error > 0) {
        const x0 = axis.panelStartX + frac(st.mean - st.error) * thick;
        const x1 = axis.panelStartX + frac(st.mean + st.error) * thick;
        parts.push(
          `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${BOX_WHISKER}" stroke-width="1.2"/>`,
          `<line x1="${x0}" y1="${y - cap}" x2="${x0}" y2="${y + cap}" stroke="${BOX_WHISKER}" stroke-width="1.2"/>`,
          `<line x1="${x1}" y1="${y - cap}" x2="${x1}" y2="${y + cap}" stroke="${BOX_WHISKER}" stroke-width="1.2"/>`,
        );
      }
      parts.push(`<circle cx="${cx}" cy="${y}" r="3.4" fill="${POINT_FILL}"/>`);
    }
  } else {
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.ringStartR, thick, lo, hi));
    for (const slot of axis.tips) {
      const st = stats.get(slot.id);
      if (!st || !Number.isFinite(st.mean)) continue;
      const rMean = axis.ringStartR + frac(st.mean) * thick;
      const [px, py] = polarPoint(axis.cx, axis.cy, rMean, slot.angle);
      if (st.error > 0) {
        const r0 = axis.ringStartR + frac(st.mean - st.error) * thick;
        const r1 = axis.ringStartR + frac(st.mean + st.error) * thick;
        const [ax0, ay0] = polarPoint(axis.cx, axis.cy, r0, slot.angle);
        const [ax1, ay1] = polarPoint(axis.cx, axis.cy, r1, slot.angle);
        parts.push(
          `<line x1="${ax0}" y1="${ay0}" x2="${ax1}" y2="${ay1}" stroke="${BOX_WHISKER}" stroke-width="1.3"/>`,
        );
      }
      parts.push(`<circle cx="${px}" cy="${py}" r="3" fill="${POINT_FILL}"/>`);
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// Scatter (jitter strip): every individual replicate point per tip along the
// value band, optionally jittered across the band so overlapping replicates
// separate. The column-scatter analog. Reuses the box's replicate binding.
// ---------------------------------------------------------------------------

const SCATTER_FILL = "#1AA0E6";

/** A deterministic pseudo-jitter in [-0.5, 0.5] from a tip id + replicate index,
 *  so a re-render is stable (no Math.random churn in the SVG). */
function jitterFrac(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

function renderScatter(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
): PanelRender {
  const thick = panelBandThickness(panel);
  const reps = values.replicates;
  const dom = sharedDomain(reps);
  if (!reps || !dom) return { svg: "", thickness: 0 };
  const { lo, hi } = dom;
  const span = hi - lo;
  const frac = (v: number): number => (span > 0 ? (v - lo) / span : 0.5);
  const jitterOn = panel.options?.jitter !== false;

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.panelStartX, thick, lo, hi));
    const jitH = Math.min(axis.bandHeight * 0.34, 7);
    for (const slot of axis.tips) {
      const vals = (reps.get(slot.id) ?? []).filter((n) => Number.isFinite(n));
      vals.forEach((v, i) => {
        const cx = axis.panelStartX + frac(v) * thick;
        const cy = slot.y + (jitterOn ? jitterFrac(slot.id, i) * 2 * jitH : 0);
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="1.8" fill="${SCATTER_FILL}" opacity="0.7"/>`,
        );
      });
    }
  } else {
    if (axisOn(panel)) parts.push(valueAxis(axis, axis.ringStartR, thick, lo, hi));
    for (const slot of axis.tips) {
      const vals = (reps.get(slot.id) ?? []).filter((n) => Number.isFinite(n));
      vals.forEach((v, i) => {
        const r = axis.ringStartR + frac(v) * thick;
        const aw = jitterOn ? jitterFrac(slot.id, i) * axis.halfAngle * 1.4 : 0;
        const [px, py] = polarPointAng(axis.cx, axis.cy, r, slot.angle + aw);
        parts.push(
          `<circle cx="${px}" cy="${py}" r="1.7" fill="${SCATTER_FILL}" opacity="0.7"/>`,
        );
      });
    }
  }
  return { svg: parts.join(""), thickness: thick + GAP };
}

// ---------------------------------------------------------------------------
// MSA: an aligned residue matrix, one cell per drawn alignment block per tip,
// colored by residue. Rectangular draws a column block (cells march left to
// right across the band); circular draws an outer ring band (cells march out by
// radius along each tip spoke). The per-tip residue row is pre-binned by the
// caller (lib/phylo/msa.ts), so a wide alignment is already downsampled to a
// drawable block count; this only places + colors. A binned panel draws the
// downsample note above the matrix so the binning is never silent.
// ---------------------------------------------------------------------------

/** The widest an msa column block (rect) / ring depth (circular) ever grows. */
const MSA_MAX_THICKNESS = 320;
/** The narrowest a single residue cell shrinks to before the band just caps. */
const MSA_MIN_CELL = 0.6;

function renderMsa(
  panel: AlignedPanel,
  axis: TipAxis,
  values: PanelValues,
): PanelRender {
  const rows = values.msa;
  const kind = values.msaKind ?? "nucleotide";
  if (!rows || rows.size === 0) return { svg: "", thickness: 0 };
  // Block count = the residue-row length (every row is the same binned length).
  const blocks = Math.max(...Array.from(rows.values(), (r) => r.length), 0);
  if (blocks === 0) return { svg: "", thickness: 0 };

  // The band thickness: the panel's own width when pinned, else a sensible default
  // scaled to the block count but capped so a 600-block alignment still fits.
  const requested = panel.width && panel.width > 0 ? panel.width : 120;
  const thick = Math.min(MSA_MAX_THICKNESS, Math.max(40, requested));
  const cellW = Math.max(MSA_MIN_CELL, thick / blocks);
  const noteH = values.msaNote ? 11 : 0;

  const parts: string[] = [];
  if (axis.layout === "rectangular") {
    const h = Math.min(axis.bandHeight, 16);
    if (values.msaNote) {
      parts.push(
        `<text x="${axis.panelStartX}" y="${msaNoteY(axis) - 2}" font-size="8" fill="${MUTED}">${esc(values.msaNote)}</text>`,
      );
    }
    for (const slot of axis.tips) {
      const row = rows.get(slot.id);
      if (!row) continue;
      for (let b = 0; b < row.length; b++) {
        const fill = residueColor(row[b], kind);
        parts.push(
          `<rect x="${(axis.panelStartX + b * cellW).toFixed(2)}" y="${(slot.y - h / 2).toFixed(2)}" width="${cellW.toFixed(2)}" height="${h}" fill="${fill}"/>`,
        );
      }
    }
  } else {
    const ringDepth = Math.min(MSA_MAX_THICKNESS, Math.max(40, requested));
    const blockR = Math.max(MSA_MIN_CELL, ringDepth / blocks);
    if (values.msaNote) {
      parts.push(
        `<text x="${axis.cx}" y="${axis.cy - axis.ringStartR - 3}" font-size="8" fill="${MUTED}" text-anchor="middle">${esc(values.msaNote)}</text>`,
      );
    }
    for (const slot of axis.tips) {
      const row = rows.get(slot.id);
      if (!row) continue;
      for (let b = 0; b < row.length; b++) {
        const r0 = axis.ringStartR + b * blockR;
        const fill = residueColor(row[b], kind);
        parts.push(
          annulusWedge(axis.cx, axis.cy, r0, r0 + blockR, slot.angle, axis.halfAngle, fill),
        );
      }
    }
    return { svg: parts.join(""), thickness: ringDepth + GAP };
  }
  return { svg: parts.join(""), thickness: thick + noteH + GAP };
}

/** The y the rectangular msa downsample note sits at (just above the first row). */
function msaNoteY(axis: TipAxis): number {
  const top = axis.tips.length ? Math.min(...axis.tips.map((t) => t.y)) : 0;
  return top - axis.bandHeight / 2;
}

/**
 * The residue legend for an msa panel: labeled swatches for the residue key
 * (the nucleotide A/C/G/T scheme or the amino-acid property groups). Drawn in
 * the same right-edge column as the data-panel legends, so the caller stacks it
 * with renderPanelLegend's output. Returns the markup + consumed height.
 */
export function renderMsaLegend(
  title: string,
  kind: AlignmentKind,
  x: number,
  y: number,
  maxY: number,
): { svg: string; height: number } {
  const items: ResidueLegendItem[] = residueLegend(kind);
  const parts: string[] = [];
  let cur = y;
  parts.push(
    `<text x="${x}" y="${cur}" font-size="11" font-weight="700" fill="${FG}">${esc(truncate(title, 16))}</text>`,
  );
  cur += 14;
  for (const item of items) {
    if (cur > maxY) break;
    parts.push(
      `<rect x="${x}" y="${cur - 8}" width="11" height="11" rx="2" fill="${item.color}" stroke="${BORDER}" stroke-width="0.5"/>`,
      `<text x="${x + 16}" y="${cur + 1}" font-size="10" fill="${FG}">${esc(truncate(item.label, 14))}</text>`,
    );
    cur += 16;
  }
  cur += 8;
  return { svg: parts.join(""), height: cur - y };
}

// ---------------------------------------------------------------------------
// A small legend block for one panel, drawn at (x, y) in a right-edge column.
// Categorical = labeled swatches; continuous = a gradient bar with min/mid/max.
// Returns the markup plus the height it consumed so the caller stacks legends.
// ---------------------------------------------------------------------------

const FG = "#1f2937";

export function renderPanelLegend(
  title: string,
  scale: ColorScale,
  x: number,
  y: number,
  maxY: number,
): { svg: string; height: number } {
  const parts: string[] = [];
  let cur = y;
  parts.push(
    `<text x="${x}" y="${cur}" font-size="11" font-weight="700" fill="${FG}">${esc(truncate(title, 16))}</text>`,
  );
  cur += 14;
  if (scale.kind === "numeric" && scale.domain) {
    const barH = 56;
    const barW = 12;
    const dom = scale.domain;
    const mid = (dom.min + dom.max) / 2;
    const gradId = `pl-${sanitizeId(title)}-${Math.round(y)}`;
    const stops = Array.from({ length: 6 }, (_, i) => {
      const fr = i / 5;
      const v = dom.max - fr * (dom.max - dom.min);
      return `<stop offset="${(fr * 100).toFixed(0)}%" stop-color="${scale.colorFor(String(v))}"/>`;
    });
    parts.push(
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${stops.join("")}</linearGradient></defs>`,
      `<rect x="${x}" y="${cur}" width="${barW}" height="${barH}" fill="url(#${gradId})" stroke="${BORDER}" stroke-width="0.5"/>`,
      `<text x="${x + barW + 5}" y="${cur + 8}" font-size="9" fill="${MUTED}">${esc(tickLabel(dom.max))}</text>`,
      `<text x="${x + barW + 5}" y="${cur + barH / 2 + 3}" font-size="9" fill="${MUTED}">${esc(tickLabel(mid))}</text>`,
      `<text x="${x + barW + 5}" y="${cur + barH}" font-size="9" fill="${MUTED}">${esc(tickLabel(dom.min))}</text>`,
    );
    cur += barH + 16;
  } else {
    for (const cat of scale.categories ?? []) {
      if (cur > maxY) break;
      parts.push(
        `<rect x="${x}" y="${cur - 8}" width="11" height="11" rx="2" fill="${scale.colorFor(cat)}"/>`,
        `<text x="${x + 16}" y="${cur + 1}" font-size="10" fill="${FG}">${esc(truncate(cat, 14))}</text>`,
      );
      cur += 16;
    }
    cur += 8;
  }
  return { svg: parts.join(""), height: cur - y };
}

/**
 * A numeric scale-key for a distribution panel (violin / point / scatter). These
 * geoms encode value by position (rectangular: along the band; circular: by
 * radius) with a fixed fill, so they have no color legend. The circular value
 * axis is only a guide ring with no numbers, so without this key a reader can't
 * read the range. Drawn in the same right-edge legend column as every other
 * legend: a title over a short axis ticked min..max by the Data Hub niceTicks.
 */
export function renderValueScaleLegend(
  title: string,
  lo: number,
  hi: number,
  x: number,
  y: number,
  maxY: number,
): { svg: string; height: number } {
  const parts: string[] = [];
  let cur = y;
  parts.push(
    `<text x="${x}" y="${cur}" font-size="11" font-weight="700" fill="${FG}">${esc(truncate(title, 16))}</text>`,
  );
  cur += 16;
  if (cur > maxY) return { svg: parts.join(""), height: cur - y };
  const barW = 64;
  const axisY = cur + 2;
  const span = hi - lo;
  parts.push(
    `<line x1="${x}" y1="${axisY}" x2="${x + barW}" y2="${axisY}" stroke="${AXIS_TICK}" stroke-width="1"/>`,
  );
  const { values } = niceTicks(lo, hi, 3);
  for (const v of values) {
    if (v < lo - 1e-9 || v > hi + 1e-9) continue;
    const fr = span > 0 ? (v - lo) / span : 0.5;
    const tx = x + fr * barW;
    parts.push(
      `<line x1="${tx}" y1="${axisY}" x2="${tx}" y2="${axisY + 3}" stroke="${AXIS_TICK}" stroke-width="1"/>`,
      `<text x="${tx}" y="${axisY + 13}" font-size="9" fill="${MUTED}" text-anchor="middle">${esc(axisLabel(v))}</text>`,
    );
  }
  cur = axisY + 22;
  return { svg: parts.join(""), height: cur - y };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_") || "x";
}
function tickLabel(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const s =
    abs !== 0 && (abs >= 1e5 || abs < 1e-3)
      ? n.toExponential(1)
      : Number(n.toFixed(2)).toString();
  return s;
}
