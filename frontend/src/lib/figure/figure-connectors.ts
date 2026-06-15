// Phase 2 geometry for smart connectors: resolve an element-anchored connector to
// concrete points + an SVG path. Pure (no React, no DOM), so it serves both the
// on-screen render and the exact SVG export, and is unit-testable. All inches.

import type { Connector, ConnectorShape, ConnectorSide, FigurePage } from "@/lib/figure/figure-page";
import { elementBox, type Box, type ElementRef } from "@/lib/figure/figure-arrange";

export interface Point {
  xIn: number;
  yIn: number;
}

/** The midpoint of one side of a box (where a connector end attaches). */
export function anchorPoint(box: Box, side: ConnectorSide): Point {
  switch (side) {
    case "top":
      return { xIn: box.xIn + box.wIn / 2, yIn: box.yIn };
    case "bottom":
      return { xIn: box.xIn + box.wIn / 2, yIn: box.yIn + box.hIn };
    case "left":
      return { xIn: box.xIn, yIn: box.yIn + box.hIn / 2 };
    case "right":
      return { xIn: box.xIn + box.wIn, yIn: box.yIn + box.hIn / 2 };
  }
}

/** The four side anchors of a box, for rendering hover nodes. */
export function elementAnchors(box: Box): { side: ConnectorSide; point: Point }[] {
  return (["top", "right", "bottom", "left"] as ConnectorSide[]).map((side) => ({
    side,
    point: anchorPoint(box, side),
  }));
}

/** Pick the side of `box` that best faces `toward` (for auto-choosing on draw). */
export function nearestSide(box: Box, toward: Point): ConnectorSide {
  const cx = box.xIn + box.wIn / 2;
  const cy = box.yIn + box.hIn / 2;
  const dx = toward.xIn - cx;
  const dy = toward.yIn - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Resolve a connector's two ends to live points from the current element boxes. */
export function connectorEndpoints(
  page: FigurePage,
  conn: Connector,
): { from: Point; to: Point } | null {
  const fromBox = elementBox(page, conn.from.ref as ElementRef);
  const toBox = elementBox(page, conn.to.ref as ElementRef);
  if (!fromBox || !toBox) return null;
  return {
    from: anchorPoint(fromBox, conn.from.side),
    to: anchorPoint(toBox, conn.to.side),
  };
}

/**
 * An SVG path `d` string between two points in the given shape. Points are passed
 * already in the target units (inches for export math, or px for on-screen), so
 * this stays unit-agnostic. Elbow = H/V/H through the midline; curve = a smooth
 * horizontal cubic.
 */
export function connectorPath(from: Point, to: Point, shape: ConnectorShape): string {
  const x1 = from.xIn;
  const y1 = from.yIn;
  const x2 = to.xIn;
  const y2 = to.yIn;
  if (shape === "straight") {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  if (shape === "elbow") {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
  }
  // curve: cubic bezier with horizontal control handles
  const cx1 = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx1} ${y2}, ${x2} ${y2}`;
}

/** The angle (radians) of the path arriving at `to`, for orienting an arrowhead. */
export function arrowAngle(from: Point, to: Point, shape: ConnectorShape): number {
  if (shape === "elbow") {
    // The last elbow segment is horizontal (into x2), so the head points along x.
    return to.xIn >= (from.xIn + to.xIn) / 2 ? 0 : Math.PI;
  }
  return Math.atan2(to.yIn - from.yIn, to.xIn - from.xIn);
}
