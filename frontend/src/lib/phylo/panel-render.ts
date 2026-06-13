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
import type { AlignedPanel, AlignedPanelKind } from "./types";
import type { TipAxis, TipSlot } from "./layout";
import { EMPTY_FILL, type ColorScale } from "./color-scale";

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
  clade: 0,
  support: 0,
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
 * aligned columns (labels / points / clade / support / msa) return empty here,
 * render.ts draws those on the tree itself; this function owns the geom_fruit
 * panels: strip, heat (single + matrix), bars, dots, box. Works in both layouts.
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
