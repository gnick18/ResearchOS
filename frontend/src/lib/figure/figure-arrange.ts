// Phase 1 of the BioRender-class figure builder: a unified element model over the
// three element kinds (panels, placed icons, annotations) plus the pure geometry
// that selection, smart guides, align/distribute, and z-order all build on. Kept
// free of React so it is unit-testable and the composer just calls into it.
//
// Everything is in real inches, matching figure-page.ts. No em-dashes, no emojis.

import type { Annotation, FigurePage, FigureShape, PlacedAsset } from "@/lib/figure/figure-page";
import { moveAnnotation, movePlacedAsset, moveShape, pageAssets, pageShapes } from "@/lib/figure/figure-page";

export type ElementKind = "panel" | "asset" | "annotation" | "shape";

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
    ...pageShapes(page).map((s) => ({ kind: "shape" as const, id: s.shapeId })),
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
  if (ref.kind === "shape") {
    const s = pageShapes(page).find((x) => x.shapeId === ref.id);
    return s ? { xIn: s.xIn, yIn: s.yIn, wIn: s.wIn, hIn: s.hIn } : null;
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
  if (ref.kind === "shape") return moveShape(page, ref.id, dxIn, dyIn);
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

type ArrayKey = "panels" | "assets" | "annotations" | "shapes";
function arrayFor(kind: ElementKind): ArrayKey {
  return kind === "panel"
    ? "panels"
    : kind === "asset"
      ? "assets"
      : kind === "shape"
        ? "shapes"
        : "annotations";
}
function idOf(kind: ElementKind): "panelId" | "assetId" | "annId" | "shapeId" {
  return kind === "panel"
    ? "panelId"
    : kind === "asset"
      ? "assetId"
      : kind === "shape"
        ? "shapeId"
        : "annId";
}

function reorder(page: FigurePage, ref: ElementRef, to: "front" | "back" | "forward" | "backward"): FigurePage {
  const key = arrayFor(ref.kind);
  const idField = idOf(ref.kind);
  const list = (
    key === "assets" ? pageAssets(page) : key === "shapes" ? pageShapes(page) : (page[key] as unknown[])
  ) as Array<Record<string, unknown>>;
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

/** Refs whose box intersect a marquee rectangle (for drag-select). */
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

// ── QoL Tier-1 helpers ───────────────────────────────────────────────────────

/**
 * Assign a shared groupId to each of the given refs (replacing any prior
 * group on those elements). Pass null to ungroup (clear groupId). Pure.
 */
export function setGroupId(page: FigurePage, refs: ElementRef[], groupId: string | null): FigurePage {
  const ids = new Set(refs.map((r) => r.id));
  const val = groupId ?? undefined;
  return {
    ...page,
    panels: page.panels.map((p) => (ids.has(p.panelId) ? { ...p, groupId: val } : p)),
    assets: (page.assets ?? []).map((a) => (ids.has(a.assetId) ? { ...a, groupId: val } : a)),
    annotations: page.annotations.map((a) => (ids.has(a.annId) ? { ...a, groupId: val } : a)),
    shapes: (page.shapes ?? []).map((s) => (ids.has(s.shapeId) ? { ...s, groupId: val } : s)),
  };
}

/** Return all element refs that share the same groupId as the given element. */
export function groupMates(page: FigurePage, ref: ElementRef): ElementRef[] {
  const gid = getGroupId(page, ref);
  if (!gid) return [ref];
  return listElements(page).filter((r) => getGroupId(page, r) === gid);
}

function getGroupId(page: FigurePage, ref: ElementRef): string | undefined {
  if (ref.kind === "panel") return page.panels.find((p) => p.panelId === ref.id)?.groupId;
  if (ref.kind === "asset") return (page.assets ?? []).find((a) => a.assetId === ref.id)?.groupId;
  if (ref.kind === "shape") return (page.shapes ?? []).find((s) => s.shapeId === ref.id)?.groupId;
  return page.annotations.find((a) => a.annId === ref.id)?.groupId;
}

/**
 * Flip the given elements horizontally (flipX) or vertically (flipY) about
 * their collective union-box center. For non-resizable annotations the flip
 * bit is set but position is unchanged (the render path will mirror). Pure.
 */
export function flipElements(
  page: FigurePage,
  refs: ElementRef[],
  axis: "horizontal" | "vertical",
): FigurePage {
  const u = unionBox(page, refs);
  if (!u) return page;
  const centerX = u.xIn + u.wIn / 2;
  const centerY = u.yIn + u.hIn / 2;

  let next = page;
  for (const ref of refs) {
    const b = elementBox(page, ref);
    if (!b) continue;
    if (axis === "horizontal") {
      // Mirror the element's left edge: newX = 2 * centerX - (oldX + oldW)
      const newX = 2 * centerX - (b.xIn + b.wIn);
      next = _setFlipX(setElementTopLeft(next, ref, newX, b.yIn), ref, true);
    } else {
      const newY = 2 * centerY - (b.yIn + b.hIn);
      next = _setFlipY(setElementTopLeft(next, ref, b.xIn, newY), ref, true);
    }
  }
  return next;
}

function _setFlipX(page: FigurePage, ref: ElementRef, flipX: boolean): FigurePage {
  if (ref.kind === "panel")
    return { ...page, panels: page.panels.map((p) => (p.panelId === ref.id ? { ...p, flipX } : p)) };
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, flipX } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, flipX } : s)) };
  return { ...page, annotations: page.annotations.map((a) => (a.annId === ref.id ? { ...a, flipX } : a)) };
}

function _setFlipY(page: FigurePage, ref: ElementRef, flipY: boolean): FigurePage {
  if (ref.kind === "panel")
    return { ...page, panels: page.panels.map((p) => (p.panelId === ref.id ? { ...p, flipY } : p)) };
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, flipY } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, flipY } : s)) };
  return { ...page, annotations: page.annotations.map((a) => (a.annId === ref.id ? { ...a, flipY } : a)) };
}

/** Set locked state on an element. Locked elements ignore pointer events. */
export function setElementLocked(page: FigurePage, ref: ElementRef, locked: boolean): FigurePage {
  if (ref.kind === "panel")
    return { ...page, panels: page.panels.map((p) => (p.panelId === ref.id ? { ...p, locked } : p)) };
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, locked } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, locked } : s)) };
  return { ...page, annotations: page.annotations.map((a) => (a.annId === ref.id ? { ...a, locked } : a)) };
}

/** Set hidden state on an element. Hidden elements are not rendered or exported. */
export function setElementHidden(page: FigurePage, ref: ElementRef, hidden: boolean): FigurePage {
  if (ref.kind === "panel")
    return { ...page, panels: page.panels.map((p) => (p.panelId === ref.id ? { ...p, hidden } : p)) };
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, hidden } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, hidden } : s)) };
  return { ...page, annotations: page.annotations.map((a) => (a.annId === ref.id ? { ...a, hidden } : a)) };
}

/** Read the locked state of any element. */
export function isElementLocked(page: FigurePage, ref: ElementRef): boolean {
  if (ref.kind === "panel") return !!page.panels.find((p) => p.panelId === ref.id)?.locked;
  if (ref.kind === "asset") return !!(page.assets ?? []).find((a) => a.assetId === ref.id)?.locked;
  if (ref.kind === "shape") return !!(page.shapes ?? []).find((s) => s.shapeId === ref.id)?.locked;
  return !!page.annotations.find((a) => a.annId === ref.id)?.locked;
}

/** Read the hidden state of any element. */
export function isElementHidden(page: FigurePage, ref: ElementRef): boolean {
  if (ref.kind === "panel") return !!page.panels.find((p) => p.panelId === ref.id)?.hidden;
  if (ref.kind === "asset") return !!(page.assets ?? []).find((a) => a.assetId === ref.id)?.hidden;
  if (ref.kind === "shape") return !!(page.shapes ?? []).find((s) => s.shapeId === ref.id)?.hidden;
  return !!page.annotations.find((a) => a.annId === ref.id)?.hidden;
}

/**
 * Set the size (wIn, hIn) of a box-shaped element (panels, assets, shapes).
 * Annotations are not resizable this way and are returned unchanged.
 */
export function setElementSize(
  page: FigurePage,
  ref: ElementRef,
  wIn: number,
  hIn: number,
): FigurePage {
  const w = Math.max(0.1, wIn);
  const h = Math.max(0.1, hIn);
  if (ref.kind === "panel")
    return { ...page, panels: page.panels.map((p) => (p.panelId === ref.id ? { ...p, wIn: w, hIn: h } : p)) };
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, wIn: w, hIn: h } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, wIn: w, hIn: h } : s)) };
  return page;
}

/**
 * Set the rotation (degrees, clockwise) of an element. Only applies to
 * asset and shape elements (panels have no rotation field).
 */
export function setElementRotation(page: FigurePage, ref: ElementRef, deg: number): FigurePage {
  if (ref.kind === "asset")
    return { ...page, assets: (page.assets ?? []).map((a) => (a.assetId === ref.id ? { ...a, rotation: deg } : a)) };
  if (ref.kind === "shape")
    return { ...page, shapes: (page.shapes ?? []).map((s) => (s.shapeId === ref.id ? { ...s, rotation: deg } : s)) };
  return page;
}

/**
 * Deep-copy one or more elements, offset by (+offsetIn, +offsetIn), and
 * return the new page plus the new element refs (which become the new selection).
 * New ids are generated with a nanosecond-style stamp to avoid collision.
 */
export function duplicateElements(
  page: FigurePage,
  refs: ElementRef[],
  offsetIn = 0.15,
): { page: FigurePage; newRefs: ElementRef[] } {
  const stamp = Date.now().toString(36);
  let next = page;
  const newRefs: ElementRef[] = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const suffix = `${stamp}-${i}`;
    if (ref.kind === "panel") {
      const src = page.panels.find((p) => p.panelId === ref.id);
      if (!src) continue;
      const newId = `pc-${suffix}`;
      next = { ...next, panels: [...next.panels, { ...src, panelId: newId, xIn: src.xIn + offsetIn, yIn: src.yIn + offsetIn }] };
      newRefs.push({ kind: "panel", id: newId });
    } else if (ref.kind === "asset") {
      const src = (page.assets ?? []).find((a) => a.assetId === ref.id);
      if (!src) continue;
      const newId = `ac-${suffix}`;
      next = { ...next, assets: [...(next.assets ?? []), { ...src, assetId: newId, xIn: src.xIn + offsetIn, yIn: src.yIn + offsetIn }] };
      newRefs.push({ kind: "asset", id: newId });
    } else if (ref.kind === "shape") {
      const src = (page.shapes ?? []).find((s) => s.shapeId === ref.id);
      if (!src) continue;
      const newId = `sc-${suffix}`;
      next = { ...next, shapes: [...(next.shapes ?? []), { ...src, shapeId: newId, xIn: src.xIn + offsetIn, yIn: src.yIn + offsetIn }] };
      newRefs.push({ kind: "shape", id: newId });
    } else if (ref.kind === "annotation") {
      const src = page.annotations.find((a) => a.annId === ref.id);
      if (!src) continue;
      const newId = `annc-${suffix}`;
      if (src.kind === "arrow") {
        next = { ...next, annotations: [...next.annotations, { ...src, annId: newId, x1In: src.x1In + offsetIn, y1In: src.y1In + offsetIn, x2In: src.x2In + offsetIn, y2In: src.y2In + offsetIn }] };
      } else {
        next = { ...next, annotations: [...next.annotations, { ...src, annId: newId, xIn: src.xIn + offsetIn, yIn: src.yIn + offsetIn }] };
      }
      newRefs.push({ kind: "annotation", id: newId });
    }
  }
  return { page: next, newRefs };
}
