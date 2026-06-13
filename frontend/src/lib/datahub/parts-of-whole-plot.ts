// parts-of-whole-plot.ts
//
// The three Parts-of-whole figures for Data Hub: a pie, a donut (a pie with a
// center hole), and a single 100-percent stacked column. Each draws straight
// from the resolved category/value pairs (parts-of-whole-table.ts), one colored
// segment per category sized by its share of the total. There is NO statistic
// here (no test, no p-value), so the segment angles / heights are exact
// arithmetic (value / total), not a computed estimate, and the figures are
// covered by render smoke tests rather than a scipy oracle.
//
// Each segment is tagged with data-series (its category index) the same way the
// other renderers tag a series, so the existing PlotColorEditor right-click /
// double-click color menu and the palette studio recolor the slices too. The
// palette is sampled to the category count through the shared seriesColors, so
// one palette recolors the whole figure and a per-series override wins.
//
// Same portability contract as the rest of the plotting layer (a white ground,
// an inline font stack, no external CSS), so a parts-of-whole figure exports to
// SVG and rasterizes to PNG exactly like every other figure.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { partsOfWhole, type PartCategory } from "@/lib/datahub/parts-of-whole-table";
import {
  type PlotStyle,
  figureBox,
  seriesColors,
  esc,
  AXIS_COLOR,
  TICK_TEXT,
  LABEL_TEXT,
} from "@/lib/datahub/plot-spec";

/** True when a plot kind is one of the three parts-of-whole kinds. */
export function isPartsOfWholeKind(kind: string): boolean {
  return kind === "pie" || kind === "donut" || kind === "stackedBar";
}

/** One laid-out segment of a parts-of-whole figure. */
export interface PartSegment {
  /** The category index (the data-series tag, drives the color + override). */
  index: number;
  /** The category label. */
  label: string;
  /** The slice value (a positive number; only present categories are segments). */
  value: number;
  /** The fraction of the total this segment occupies, in [0, 1]. */
  fraction: number;
  /** The percent of the total (fraction * 100). */
  percent: number;
  /** The resolved fill color (palette sample or per-series override). */
  color: string;
}

/** The geometry shared by the pie / donut / stacked-bar figures (pure). */
export interface PartsOfWholeGeometry {
  kind: "pie" | "donut" | "stackedBar";
  width: number;
  height: number;
  /** Every drawable segment (only present, positive-value categories). */
  segments: PartSegment[];
  /** The sum of every present value (the whole). */
  total: number;
  /** A center point for the pie / donut. */
  cx: number;
  cy: number;
  /** The outer radius of the pie / donut. */
  radius: number;
  /** The donut hole radius (0 for a pie), in pixels. */
  innerRadius: number;
  /** The stacked-column box (x, top y, width, height), for the stacked bar. */
  bar: { x: number; y: number; width: number; height: number };
  /** An empty-state message when there is nothing to draw, else null. */
  emptyMessage: string | null;
}

/** The category index of the i-th DRAWN segment back into content.rows order, so
 *  a color override keyed by the category row index lands on the right slice. */
function drawableSegments(
  content: DataHubDocContent,
  style: PlotStyle,
): { segments: PartSegment[]; total: number } {
  const { categories, total } = partsOfWhole(content);
  // Color every CATEGORY (not just the drawn ones) so the per-series override
  // index matches the category's row index in the grid, which is what the color
  // editor writes. The palette is sampled to the full category count.
  const colors = seriesColors(style, Math.max(1, categories.length));
  const segments: PartSegment[] = [];
  categories.forEach((c: PartCategory, i) => {
    if (c.value === null || c.value <= 0 || total <= 0) return;
    const fraction = c.value / total;
    segments.push({
      index: i,
      label: c.label,
      value: c.value,
      fraction,
      percent: fraction * 100,
      color: colors[i] ?? colors[colors.length - 1] ?? "#000000",
    });
  });
  return { segments, total };
}

/**
 * Lay out a pie or donut figure. The center sits in the left two-thirds of the
 * box (leaving room for the legend on the right), the radius fills the available
 * height, and the donut hole radius is donutHoleRatio * radius (0 for a pie).
 * Pure.
 */
export function layoutPie(
  content: DataHubDocContent,
  style: PlotStyle,
  donut: boolean,
): PartsOfWholeGeometry {
  const { width, height, padT, padB } = figureBox(style);
  const { segments, total } = drawableSegments(content, style);
  // Reserve the right third for the legend; center the pie in the left part.
  const legendWidth = Math.min(150, width * 0.34);
  const plotW = width - legendWidth;
  const cx = plotW / 2;
  const titleGap = style.title.trim() !== "" ? 16 : 0;
  const top = padT + titleGap;
  const cy = (top + (height - padB)) / 2;
  const radius = Math.max(
    20,
    Math.min(plotW / 2 - 8, (height - padB - top) / 2 - 4),
  );
  const ratio =
    typeof style.donutHoleRatio === "number" &&
    style.donutHoleRatio >= 0 &&
    style.donutHoleRatio < 0.9
      ? style.donutHoleRatio
      : 0.6;
  const innerRadius = donut ? radius * ratio : 0;
  return {
    kind: donut ? "donut" : "pie",
    width,
    height,
    segments,
    total,
    cx,
    cy,
    radius,
    innerRadius,
    bar: { x: 0, y: 0, width: 0, height: 0 },
    emptyMessage:
      segments.length === 0
        ? "Enter a category label and a positive value per slice to draw the figure."
        : null,
  };
}

/**
 * Lay out a single 100-percent stacked column, one segment per category stacked
 * bottom to top, summing to the full bar height. The bar sits on the left with
 * the legend on the right. Pure.
 */
export function layoutStackedBar(
  content: DataHubDocContent,
  style: PlotStyle,
): PartsOfWholeGeometry {
  const { width, height, padL, padT, padB } = figureBox(style);
  const { segments, total } = drawableSegments(content, style);
  const titleGap = style.title.trim() !== "" ? 16 : 0;
  const top = padT + titleGap;
  const barTop = top;
  const barHeight = Math.max(20, height - padB - barTop);
  const barWidth = 72;
  const barX = padL;
  return {
    kind: "stackedBar",
    width,
    height,
    segments,
    total,
    cx: 0,
    cy: 0,
    radius: 0,
    innerRadius: 0,
    bar: { x: barX, y: barTop, width: barWidth, height: barHeight },
    emptyMessage:
      segments.length === 0
        ? "Enter a category label and a positive value per slice to draw the figure."
        : null,
  };
}

/** Dispatch the layout for whichever parts-of-whole kind the style carries. */
export function layoutPartsOfWhole(
  content: DataHubDocContent,
  style: PlotStyle,
): PartsOfWholeGeometry {
  if (style.kind === "stackedBar") return layoutStackedBar(content, style);
  return layoutPie(content, style, style.kind === "donut");
}

// ---------------------------------------------------------------------------
// SVG serialization (geometry -> a standalone SVG document string)
// ---------------------------------------------------------------------------

/** A point on the circle of radius r at angle a (radians, 0 at 12 o'clock, CW). */
function polar(cx: number, cy: number, r: number, a: number): { x: number; y: number } {
  // 0 at the top, clockwise (the convention a pie chart reads in).
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** The SVG path for one wedge (pie) or ring slice (donut) between two angles. */
function wedgePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, a0);
  const o1 = polar(cx, cy, rOuter, a1);
  if (rInner <= 0) {
    // A solid wedge: center, out to a0, arc to a1, back to center.
    return (
      `M${cx.toFixed(2)} ${cy.toFixed(2)} ` +
      `L${o0.x.toFixed(2)} ${o0.y.toFixed(2)} ` +
      `A${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)} Z`
    );
  }
  // A ring slice: outer arc forward, inner arc back.
  const i1 = polar(cx, cy, rInner, a1);
  const i0 = polar(cx, cy, rInner, a0);
  return (
    `M${o0.x.toFixed(2)} ${o0.y.toFixed(2)} ` +
    `A${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)} ` +
    `L${i1.x.toFixed(2)} ${i1.y.toFixed(2)} ` +
    `A${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)} Z`
  );
}

/** The shared SVG open + white ground + optional title. */
function svgOpen(geo: PartsOfWholeGeometry, style: PlotStyle): string[] {
  const parts: string[] = [];
  parts.push(
    `<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}" ` +
      `xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, Inter, system-ui, sans-serif">`,
  );
  parts.push(
    `<rect x="0" y="0" width="${geo.width}" height="${geo.height}" fill="#ffffff"/>`,
  );
  if (style.title.trim() !== "") {
    parts.push(
      `<text x="${geo.width / 2}" y="18" font-size="${style.fontSize + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }
  return parts;
}

/** An empty-state framed message so the figure never renders blank. */
function emptySvg(geo: PartsOfWholeGeometry, style: PlotStyle): string {
  const parts = svgOpen(geo, style);
  parts.push(
    `<text x="${geo.width / 2}" y="${geo.height / 2}" font-size="${style.fontSize}" ` +
      `fill="${TICK_TEXT}" text-anchor="middle">${esc(geo.emptyMessage ?? "")}</text>`,
  );
  parts.push(`</svg>`);
  return parts.join("");
}

/** The legend rows (a swatch + label + percent), drawn down the right edge. */
function legendSvg(geo: PartsOfWholeGeometry, style: PlotStyle): string[] {
  const parts: string[] = [];
  const f = Math.max(8, style.fontSize - 2);
  const x = geo.width - Math.min(150, geo.width * 0.34) + 6;
  const rowH = f + 8;
  const blockH = geo.segments.length * rowH;
  let y = Math.max(style.fontSize + 18, geo.height / 2 - blockH / 2) + f;
  for (const s of geo.segments) {
    parts.push(
      `<rect x="${x.toFixed(2)}" y="${(y - f + 2).toFixed(2)}" width="${f}" height="${f}" rx="2" fill="${s.color}"/>`,
    );
    parts.push(
      `<text x="${(x + f + 6).toFixed(2)}" y="${y.toFixed(2)}" font-size="${f}" fill="${LABEL_TEXT}">` +
        `${esc(s.label)} ${s.percent.toFixed(1)}%</text>`,
    );
    y += rowH;
  }
  return parts;
}

/** Serialize a laid-out pie or donut figure into a standalone SVG string. */
export function renderPieSvg(geo: PartsOfWholeGeometry, style: PlotStyle): string {
  if (geo.emptyMessage) return emptySvg(geo, style);
  const parts = svgOpen(geo, style);
  // Wedges, swept clockwise from 12 o'clock in category order.
  let a0 = 0;
  for (const s of geo.segments) {
    const a1 = a0 + s.fraction * Math.PI * 2;
    parts.push(
      `<path data-series="${s.index}" d="${wedgePath(geo.cx, geo.cy, geo.radius, geo.innerRadius, a0, a1)}" ` +
        `fill="${s.color}" stroke="#ffffff" stroke-width="1.5"/>`,
    );
    a0 = a1;
  }
  // The donut center carries the total so the ring reads as a whole.
  if (geo.kind === "donut" && geo.innerRadius > 14) {
    parts.push(
      `<text x="${geo.cx.toFixed(2)}" y="${(geo.cy - 2).toFixed(2)}" font-size="${style.fontSize + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(tidyTotal(geo.total))}</text>`,
    );
    parts.push(
      `<text x="${geo.cx.toFixed(2)}" y="${(geo.cy + 13).toFixed(2)}" font-size="${Math.max(8, style.fontSize - 3)}" ` +
        `fill="${TICK_TEXT}" text-anchor="middle">Total</text>`,
    );
  }
  parts.push(...legendSvg(geo, style));
  parts.push(`</svg>`);
  return parts.join("");
}

/** Serialize a laid-out 100-percent stacked column into a standalone SVG string. */
export function renderStackedBarSvg(
  geo: PartsOfWholeGeometry,
  style: PlotStyle,
): string {
  if (geo.emptyMessage) return emptySvg(geo, style);
  const parts = svgOpen(geo, style);
  const { x, y, width, height } = geo.bar;
  const f = Math.max(8, style.fontSize - 2);
  // Stack bottom to top in category order so the first category sits at the base.
  let yTop = y + height;
  for (const s of geo.segments) {
    const segH = s.fraction * height;
    const segTop = yTop - segH;
    parts.push(
      `<rect data-series="${s.index}" x="${x.toFixed(2)}" y="${segTop.toFixed(2)}" ` +
        `width="${width}" height="${segH.toFixed(2)}" fill="${s.color}" stroke="#ffffff" stroke-width="1"/>`,
    );
    // Label the segment in place when it is tall enough to hold the text.
    if (segH >= f + 4) {
      parts.push(
        `<text x="${(x + width / 2).toFixed(2)}" y="${(segTop + segH / 2 + f / 3).toFixed(2)}" ` +
          `font-size="${f}" fill="#ffffff" text-anchor="middle" font-weight="600">${s.percent.toFixed(0)}%</text>`,
      );
    }
    yTop = segTop;
  }
  // A baseline + a 100% axis tick so the column reads as a full whole.
  parts.push(
    `<line x1="${x.toFixed(2)}" y1="${(y + height).toFixed(2)}" x2="${(x + width).toFixed(2)}" ` +
      `y2="${(y + height).toFixed(2)}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${(x - 6).toFixed(2)}" y="${(y + f / 2).toFixed(2)}" font-size="${f}" ` +
      `fill="${TICK_TEXT}" text-anchor="end">100%</text>`,
  );
  parts.push(
    `<text x="${(x - 6).toFixed(2)}" y="${(y + height).toFixed(2)}" font-size="${f}" ` +
      `fill="${TICK_TEXT}" text-anchor="end">0%</text>`,
  );
  parts.push(...legendSvg(geo, style));
  parts.push(`</svg>`);
  return parts.join("");
}

/** Render whichever parts-of-whole kind the geometry carries. */
export function renderPartsOfWholeSvg(
  geo: PartsOfWholeGeometry,
  style: PlotStyle,
): string {
  if (geo.kind === "stackedBar") return renderStackedBarSvg(geo, style);
  return renderPieSvg(geo, style);
}

/** A tidy total for the donut center (no trailing-zero float noise). */
function tidyTotal(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}
