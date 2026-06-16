// Data Hub manifest emitter — the geometry SEAM that lets the shared collision
// advisor (lib/figure/layout-collision) reason about a Data Hub plot. renderPlot
// already lays out every element at exact pixel positions; this turns that laid-
// out geometry into the surface-agnostic LayoutManifest (boxes the advisor reads).
//
// One source of truth: the boxes are computed from the SAME geometry + layout
// constants the serializer draws from (e.g. GROUPED_LEGEND), so the advisor
// measures where the ink actually lands and never drifts (the false-positive bug
// the phylo advisor hit when a manifest box disagreed with the draw).
//
// v1 covers the GROUPED BAR (the motivating case: a legend drawn inside the plot
// piling onto tall bars, plus crowded category labels). Other plot kinds return
// an empty-box manifest for now (no detection, and crucially NO false positives);
// each kind lights up by emitting its own boxes here. See
// docs/proposals/2026-06-15-collision-aware-layout-advisor.md (Phase 5).
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  renderPlot,
  GROUPED_LEGEND,
  groupedLegendSwatchX,
  estimateLabelWidth,
  type PlotStyle,
} from "./plot-spec";
import type { LayoutManifest, PlacedBox } from "@/lib/figure/layout-manifest";

type PlotGeom = ReturnType<typeof renderPlot>["geometry"];

/** The x-axis category labels sit 16px below the bottom axis at the tick font
 *  (renderGroupedBarSvg). Centered on cluster.labelX (text-anchor middle). */
const X_LABEL_BASELINE_DROP = 16;

/** Push the legend block box. Grouped bar + survival both draw the legend with the
 *  GROUPED_LEGEND constants at geo.x1 / geo.y1 (inside top-right for "overlay", in
 *  the reserved gutter for "right"), so the box sits exactly where the ink lands.
 *  Left edge = swatch x; width = swatch-to-name gap + the widest name; height = one
 *  row per entry. */
function pushLegendBox(
  boxes: PlacedBox[],
  geo: { x1: number; y1: number; legend: { name: string }[] },
  style: PlotStyle,
  tickFont: number,
): void {
  if (geo.legend.length === 0) return;
  const maxNameW = geo.legend.reduce(
    (m, item) => Math.max(m, estimateLabelWidth(item.name, tickFont)),
    0,
  );
  boxes.push({
    id: "legend",
    kind: "legend",
    x: groupedLegendSwatchX(geo.x1, style.legendPlacement ?? "overlay"),
    y: geo.y1 + GROUPED_LEGEND.topPad,
    w:
      GROUPED_LEGEND.swatchInsetFromX1 - GROUPED_LEGEND.textInsetFromX1 + maxNameW,
    h: geo.legend.length * GROUPED_LEGEND.rowH,
    label: "legend",
  });
}

/**
 * Build the collision manifest for a laid-out plot. Pass renderPlot's geometry +
 * resolved style (so the numbers match the rendered SVG). Returns boxes for the
 * kinds covered so far; an unsupported kind returns an empty box list, which the
 * detector reads as "nothing to flag" (safe, never a false positive).
 */
export function plotLayoutManifest(
  geometry: PlotGeom,
  style: PlotStyle,
): LayoutManifest {
  const boxes: PlacedBox[] = [];
  const tickFont = Math.max(8, style.fontSize - 2);

  // Grouped bar: bar marks + the inside-plot legend + the category labels.
  if ("clusters" in geometry && "legend" in geometry) {
    const geo = geometry;

    // Each bar that is actually drawn (height > 0) is a data mark, so the legend
    // overlapping a tall bar is detected against the real ink, not the whole plot
    // rectangle (which would false-positive on every legend).
    geo.clusters.forEach((cluster, ci) => {
      cluster.bars.forEach((bar, bi) => {
        if (bar.height > 0) {
          boxes.push({
            id: `bar:${ci}:${bi}`,
            kind: "mark",
            x: bar.x,
            y: bar.y,
            w: bar.width,
            h: bar.height,
          });
        }
      });
    });

    // The x-axis category labels (centered on labelX), for horizontal crowding.
    geo.clusters.forEach((cluster, ci) => {
      const w = estimateLabelWidth(cluster.label, tickFont);
      boxes.push({
        id: `xlabel:${ci}`,
        kind: "axisLabel",
        x: cluster.labelX - w / 2,
        y: geo.y0 + X_LABEL_BASELINE_DROP - tickFont,
        w,
        h: tickFont + 3,
        label: cluster.label,
      });
    });

    // The legend block (top-right INSIDE the plot area, or the reserved gutter for
    // "right"), measured with the SAME constants the serializer draws from.
    pushLegendBox(boxes, geo, style, tickFont);

    return { width: geo.width, height: geo.height, plotRight: geo.x1, boxes };
  }

  // Survival curve: each step-curve segment is a thin mark + the inside-plot
  // legend. A legend over a high-staying curve (slow decline, top-right) is the
  // headline collision here, the same lever (relocate-legend) clears it.
  if ("curves" in geometry && "legend" in geometry) {
    const geo = geometry;
    geo.curves.forEach((curve, ci) => {
      for (let i = 1; i < curve.path.length; i++) {
        const a = curve.path[i - 1];
        const b = curve.path[i];
        boxes.push({
          id: `curve:${ci}:${i}`,
          kind: "mark",
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          // Pad a near-horizontal / near-vertical segment so a real (>2px both
          // ways) overlap with the legend registers against the 2px stroke.
          w: Math.max(3, Math.abs(b.x - a.x)),
          h: Math.max(3, Math.abs(b.y - a.y)),
        });
      }
    });
    pushLegendBox(boxes, geo, style, tickFont);
    return { width: geo.width, height: geo.height, plotRight: geo.x1, boxes };
  }

  // Other kinds: nothing emitted yet (no detection, and no false positives).
  // Carry the canvas size + plot-area right edge when the geometry exposes them.
  const width = "width" in geometry ? geometry.width : 0;
  const height = "height" in geometry ? geometry.height : 0;
  const plotRight = "x1" in geometry ? geometry.x1 : width;
  return { width, height, plotRight, boxes };
}
