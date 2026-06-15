// Phase 1 of the BioRender-class figure builder: a unified element model over the
// three element kinds (panels, placed icons, annotations) plus the pure geometry
// that selection, smart guides, align/distribute, and z-order all build on. Kept
// free of React so it is unit-testable and the composer just calls into it.
//
// Everything is in real inches, matching figure-page.ts. No em-dashes, no emojis.

import type { Annotation, FigurePage, PlacedAsset } from "@/lib/figure/figure-page";
import { moveAnnotation, movePlacedAsset, pageAssets } from "@/lib/figure/figure-page";

export type ElementKind = "panel" | "asset" | "annotation";

/** A stable, kind-tagged reference to any element on the page. */
export interface ElementRef {
  kind: ElementKind;
  id: string;
}

/** An axis-aligned box in inches (top-left origin). */
export interface Box {
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
}

/** A guide line surfaced while dragging (a single x or y coordinate in inches). */
export interface SnapGuide {
  axis: "x" | "y";
  /** The coordinate (inches) the guide sits at. */
  atIn: number;
  /** The span the rendered line should cover (min..max on the other axis). */
  fromIn: number;
  toIn: number;
}

/** A flat string key for Sets / dedup. */
export function refKey(r: ElementRef): string {
  return `${r.kind}:${r.id}`;
}

export function sameRef(a: ElementRef, b: ElementRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Every element on the page, in render order (panels, then icons, then annotations). */
export function listElements(page: FigurePage): ElementRef[] {
  return [
    ...page.panels.map((p) => ({ kind: "panel" as const, id: p.panelId })),
    ...pageAssets(page).map((a) => ({ kind: "asset" as const, id: a.assetId })),
    ...page.annotations.map((a) => ({ kind: "annotation" as const, id: a.annId })),
  ];
}

/** Bracket / text geometry constants (kept in sync with the on-screen annBox). */
const TICK_IN = 0.06;

function annotationBox(a: Annotation): Box {
  if (a.kind === "text") {
    const hIn = (a.fontPt / 72) * 1.3;
    return {
      xIn: a.xIn,
      yIn: a.yIn - a.fontPt / 72,
      wIn: Math.max(0.4, a.text.length * (a.fontPt / 72) * 0.6),
      hIn: hIn,
    };
  }
  if (a.kind === "arrow") {
    return {
      xIn: Math.min(a.x1In, a.x2In),
      yIn: Math.min(a.y1In, a.y2In),
      wIn: Math.abs(a.x2In - a.x1In),
      hIn: Math.abs(a.y2In - a.y1In),
    };
  }
  // bracket
  return a.orientation === "horizontal"
    ? { xIn: a.xIn, yIn: a.yIn - TICK_IN, wIn: a.spanIn, hIn: TICK_IN * 2.5 }
    : { xIn: a.xIn - TICK_IN, yIn: a.yIn, wIn: TICK_IN * 2.5, hIn: a.spanIn };
}

/** The element's bounding box in inches, or null if the ref is stale. */
export function elementBox(page: FigurePage, ref: ElementRef): Box | null {
  if (ref.kind === "panel") {
    const p = page.panels.find((x) => x.panelId === ref.id);
    return p ? { xIn: p.xIn, yIn: p.yIn, wIn: p.wIn, hIn: p.hIn } : null;
  }
  if (ref.kind === "asset") {
    const a = pageAssets(page).find((x) => x.assetId === ref.id);
    return a ? { xIn: a.xIn, yIn: a.yIn, wIn: a.wIn, hIn: a.hIn } : null;
  }
  const an = page.annotations.find((x) => x.annId === ref.id);
  return an ? annotationBox(an) : null;
}

/** The union bounding box of several elements (null if none resolve). */
export function unionBox(page: FigurePage, refs: ElementRef[]): Box | null {
  const boxes = refs.map((r) => elementBox(page, r)).filter((b): b is Box => b !== null);
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.xIn));
  const minY = Math.min(...boxes.map((b) => b.yIn));
  const maxX = Math.max(...boxes.map((b) => b.xIn + b.wIn));
  const maxY = Math.max(...boxes.map((b) => b.yIn + b.hIn));
  return { xIn: minX, yIn: minY, wIn: maxX - minX, hIn: maxY - minY };
}

/** Translate any element by a delta in inches (clamped to the page origin). */
export function translateElement(
  page: FigurePage,
  ref: ElementRef,
  dxIn: number,
  dyIn: number,
): FigurePage {
  if (ref.kind === "asset") return movePlacedAsset(page, ref.id, dxIn, dyIn);
  if (ref.kind === "annotation") return moveAnnotation(page, ref.id, dxIn, dyIn);
  return {
    ...page,
    panels: page.panels.map((p) =>
      p.panelId !== ref.id
        ? p
        : { ...p, xIn: Math.max(0, p.xIn + dxIn), yIn: Math.max(0, p.yIn + dyIn) },
    ),
  };
}

/** Move an element so its bounding box top-left lands at (xIn, yIn). */
export function setElementTopLeft(
  page: FigurePage,
  ref: ElementRef,
  xIn: number,
  yIn: number,
): FigurePage {
  const b = elementBox(page, ref);
  if (!b) return page;
  return translateElement(page, ref, xIn - b.xIn, yIn - b.yIn);
}

export type AlignEdge = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

/** Align a multi-selection to the selection bounding box (BioRender semantics). */
export function alignElements(
  page: FigurePage,
  refs: ElementRef[],
  edge: AlignEdge,
): FigurePage {
  const u = unionBox(page, refs);
  if (!u || refs.length < 2) return page;
  let out = page;
  for (const r of refs) {
    const b = elementBox(out, r);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = u.xIn - b.xIn;
    else if (edge === "right") dx = u.xIn + u.wIn - (b.xIn + b.wIn);
    else if (edge === "centerX") dx = u.xIn + u.wIn / 2 - (b.xIn + b.wIn / 2);
    else if (edge === "top") dy = u.yIn - b.yIn;
    else if (edge === "bottom") dy = u.yIn + u.hIn - (b.yIn + b.hIn);
    else if (edge === "centerY") dy = u.yIn + u.hIn / 2 - (b.yIn + b.hIn / 2);
    if (dx !== 0 || dy !== 0) out = translateElement(out, r, dx, dy);
  }
  return out;
}

/** Distribute 3+ elements so the gaps between them are equal along one axis. */
export function distributeElements(
  page: FigurePage,
  refs: ElementRef[],
  axis: "horizontal" | "vertical",
): FigurePage {
  const withBox = refs
    .map((r) => ({ r, b: elementBox(page, r) }))
    .filter((x): x is { r: ElementRef; b: Box } => x.b !== null);
  if (withBox.length < 3) return page;

  const horiz = axis === "horizontal";
  const start = (b: Box) => (horiz ? b.xIn : b.yIn);
  const size = (b: Box) => (horiz ? b.wIn : b.hIn);
  const sorted = [...withBox].sort((a, b) => start(a.b) - start(b.b));

  const first = sorted[0].b;
  const last = sorted[sorted.length - 1].b;
  const span = start(last) + size(last) - start(first);
  const totalSize = sorted.reduce((s, x) => s + size(x.b), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  let out = page;
  let cursor = start(first);
  for (const { r, b } of sorted) {
    const target = cursor;
    const dx = horiz ? target - b.xIn : 0;
    const dy = horiz ? 0 : target - b.yIn;
    if (dx !== 0 || dy !== 0) out = translateElement(out, r, dx, dy);
    cursor += size(b) + gap;
  }
  return out;
}

/**
 * Smart-guide / snap solver. Given a moving element's PROPOSED box, compare its
 * snap lines (left/centerX/right + top/centerY/bottom) against every other
 * element plus the page center, and return the nearest snap within threshold on
 * each axis along with the guide lines to draw. Pure: the caller applies dx/dy.
 */
export function computeSnap(
  page: FigurePage,
  moving: ElementRef | ElementRef[],
  proposed: Box,
  opts?: { thresholdIn?: number; pageWIn?: number; pageHIn?: number },
): { dxIn: number; dyIn: number; guides: SnapGuide[] } {
  const threshold = opts?.thresholdIn ?? 0.05;
  const movingList = Array.isArray(moving) ? moving : [moving];
  const others = listElements(page)
    .filter((r) => !movingList.some((m) => sameRef(r, m)))
    .map((r) => elementBox(page, r))
    .filter((b): b is Box => b !== null);

  // Candidate target lines on each axis (other elements' edges + centers, page center).
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  for (const b of others) {
    xTargets.push(b.xIn, b.xIn + b.wIn / 2, b.xIn + b.wIn);
    yTargets.push(b.yIn, b.yIn + b.hIn / 2, b.yIn + b.hIn);
  }
  if (opts?.pageWIn) xTargets.push(opts.pageWIn / 2);
  if (opts?.pageHIn) yTargets.push(opts.pageHIn / 2);

  // The moving box's own snap lines.
  const xLines = [proposed.xIn, proposed.xIn + proposed.wIn / 2, proposed.xIn + proposed.wIn];
  const yLines = [proposed.yIn, proposed.yIn + proposed.hIn / 2, proposed.yIn + proposed.hIn];

  const best = (lines: number[], targets: number[]) => {
    let bestDelta = 0;
    let bestDist = threshold;
    let at: number | null = null;
    for (const line of lines) {
      for (const t of targets) {
        const d = t - line;
        if (Math.abs(d) <= bestDist) {
          bestDist = Math.abs(d);
          bestDelta = d;
          at = t;
        }
      }
    }
    return { delta: bestDelta, at };
  };

  const sx = best(xLines, xTargets);
  const sy = best(yLines, yTargets);

  const guides: SnapGuide[] = [];
  if (sx.at !== null) {
    guides.push({ axis: "x", atIn: sx.at, fromIn: proposed.yIn, toIn: proposed.yIn + proposed.hIn });
  }
  if (sy.at !== null) {
    guides.push({ axis: "y", atIn: sy.at, fromIn: proposed.xIn, toIn: proposed.xIn + proposed.wIn });
  }
  return { dxIn: sx.delta, dyIn: sy.delta, guides };
}

// ── Z-order ──────────────────────────────────────────────────────────────────
// Render order is per-array (panels, then assets, then annotations). For Phase 1,
// "arrange" reorders an element WITHIN its own layer (true cross-layer z-order is
// a later refinement that touches the compositor). Returns a new page.

type ArrayKey = "panels" | "assets" | "annotations";
function arrayFor(kind: ElementKind): ArrayKey {
  return kind === "panel" ? "panels" : kind === "asset" ? "assets" : "annotations";
}
function idOf(kind: ElementKind): "panelId" | "assetId" | "annId" {
  return kind === "panel" ? "panelId" : kind === "asset" ? "assetId" : "annId";
}

function reorder(page: FigurePage, ref: ElementRef, to: "front" | "back" | "forward" | "backward"): FigurePage {
  const key = arrayFor(ref.kind);
  const idField = idOf(ref.kind);
  const list = (key === "assets" ? pageAssets(page) : (page[key] as unknown[])) as Array<Record<string, unknown>>;
  const i = list.findIndex((el) => el[idField] === ref.id);
  if (i < 0) return page;
  const next = [...list];
  const [item] = next.splice(i, 1);
  let j = i;
  if (to === "front") j = next.length;
  else if (to === "back") j = 0;
  else if (to === "forward") j = Math.min(next.length, i + 1);
  else j = Math.max(0, i - 1);
  next.splice(j, 0, item);
  return { ...page, [key]: next };
}

export const bringToFront = (p: FigurePage, r: ElementRef) => reorder(p, r, "front");
export const sendToBack = (p: FigurePage, r: ElementRef) => reorder(p, r, "back");
export const bringForward = (p: FigurePage, r: ElementRef) => reorder(p, r, "forward");
export const sendBackward = (p: FigurePage, r: ElementRef) => reorder(p, r, "backward");

/** The topmost element whose box contains a point (for connector drop targets). */
export function elementAtPoint(page: FigurePage, xIn: number, yIn: number): ElementRef | null {
  const hits = listElements(page).filter((r) => {
    const b = elementBox(page, r);
    return b ? xIn >= b.xIn && xIn <= b.xIn + b.wIn && yIn >= b.yIn && yIn <= b.yIn + b.hIn : false;
  });
  return hits.length ? hits[hits.length - 1] : null;
}

/** Refs whose box intersects a marquee rectangle (for drag-select). */
export function elementsInRect(page: FigurePage, rect: Box): ElementRef[] {
  const hit = (b: Box) =>
    b.xIn < rect.xIn + rect.wIn &&
    b.xIn + b.wIn > rect.xIn &&
    b.yIn < rect.yIn + rect.hIn &&
    b.yIn + b.hIn > rect.yIn;
  return listElements(page).filter((r) => {
    const b = elementBox(page, r);
    return b ? hit(b) : false;
  });
}
