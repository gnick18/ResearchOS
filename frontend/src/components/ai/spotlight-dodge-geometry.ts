// BeakerSearch adaptive dodge geometry (ai adaptive-dodge bot, 2026-06-11).
//
// Pure, DOM-free helpers that decide (a) whether a surface would occlude a
// spotlight target, and (b) which viewport corner the surface should glide to.
// Because these contain no side effects, they are unit-testable with plain
// number inputs and exercised in __tests__/spotlight-dodge-geometry.test.ts.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

export type Rect = { left: number; top: number; width: number; height: number };
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Offset the surface should be positioned at when docked to a corner.
 *  EDGE_MARGIN is the gap from the viewport edge in px. */
const EDGE_MARGIN = 20;

/** The size we assume for the surface when it is in dodge mode. The surface
 *  retains its own CSS dimensions; this is used only to keep it inside the
 *  viewport when computing the translate. Using a safe fixed size avoids
 *  needing a synchronous layout measurement for a decision that runs in an
 *  effect. */
export const DODGE_SURFACE_W = 600;
export const DODGE_SURFACE_H = 440;

/** True when the surface rect (of given size, centered at its NORMAL centered
 *  position) would overlap the target rect, with an extra margin added around
 *  the target for breathing room. Both rects are in viewport coordinates. */
export function wouldOcclude(
  surfaceRect: Rect,
  targetRect: Rect,
  margin = 16,
): boolean {
  const expanded = {
    left: targetRect.left - margin,
    top: targetRect.top - margin,
    right: targetRect.left + targetRect.width + margin,
    bottom: targetRect.top + targetRect.height + margin,
  };
  const surfaceRight = surfaceRect.left + surfaceRect.width;
  const surfaceBottom = surfaceRect.top + surfaceRect.height;
  return (
    surfaceRect.left < expanded.right &&
    surfaceRight > expanded.left &&
    surfaceRect.top < expanded.bottom &&
    surfaceBottom > expanded.top
  );
}

/** Pick the viewport corner that is FARTHEST from the center of the target
 *  rect. Returns both the corner label and the top/left translate values the
 *  surface should animate to (with an EDGE_MARGIN gap from the viewport edges).
 *  The translate values are absolute viewport coords for the top-left of the
 *  surface, so the caller sets `position:fixed; left:<x>px; top:<y>px`
 *  (or an equivalent transform). */
export function farthestCorner(
  targetRect: Rect,
  viewport: { width: number; height: number },
  surfaceW = DODGE_SURFACE_W,
  surfaceH = DODGE_SURFACE_H,
): { corner: Corner; left: number; top: number } {
  const cx = targetRect.left + targetRect.width / 2;
  const cy = targetRect.top + targetRect.height / 2;

  // Distance from the target center to each viewport corner.
  const corners: { corner: Corner; vx: number; vy: number }[] = [
    { corner: "top-left",     vx: 0,              vy: 0 },
    { corner: "top-right",    vx: viewport.width,  vy: 0 },
    { corner: "bottom-left",  vx: 0,              vy: viewport.height },
    { corner: "bottom-right", vx: viewport.width,  vy: viewport.height },
  ];

  let best = corners[0];
  let bestDist = -1;
  for (const c of corners) {
    const d = Math.hypot(c.vx - cx, c.vy - cy);
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }

  // Convert the corner label to the top-left origin the surface should use,
  // clamped so the surface fits within the viewport with EDGE_MARGIN spacing.
  let left: number;
  let top: number;
  switch (best.corner) {
    case "top-left":
      left = EDGE_MARGIN;
      top  = EDGE_MARGIN;
      break;
    case "top-right":
      left = viewport.width - surfaceW - EDGE_MARGIN;
      top  = EDGE_MARGIN;
      break;
    case "bottom-left":
      left = EDGE_MARGIN;
      top  = viewport.height - surfaceH - EDGE_MARGIN;
      break;
    case "bottom-right":
    default:
      left = viewport.width - surfaceW - EDGE_MARGIN;
      top  = viewport.height - surfaceH - EDGE_MARGIN;
      break;
  }

  return { corner: best.corner, left, top };
}
