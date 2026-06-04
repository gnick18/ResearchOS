// map select bot — PURE selection helpers for the linear Map's SnapGene-style
// selection model. Kept framework-free + unit-tested so the interaction math
// (shift-click span, hover-card content, the selection band's bp -> x mapping)
// is verified without rendering. LinearMap + SequenceEditView import these.

import { nearestNeighborTm } from "@/lib/calculators/tm-nn";

/** A half-open-ish feature/selection range in bp (start <= end after normalize). */
export interface SelRange {
  start: number;
  end: number;
}

/** Normalize a range so start <= end (the editor stores start<end, but a
 *  reverse feature or a swapped pair could arrive either way). */
export function normalizeRange(r: SelRange): SelRange {
  return r.start <= r.end ? { start: r.start, end: r.end } : { start: r.end, end: r.start };
}

/**
 * SHIFT-CLICK SPAN. Given the ANCHOR feature (the first-selected feature whose
 * start anchors the span) and the SHIFT-clicked feature, return the union span
 * [min(anchor.start, clicked.start), max(anchor.end, clicked.end)]. This makes a
 * shift-click extend the selection to cover both features (SnapGene behavior),
 * regardless of which side of the anchor the second feature sits on.
 */
export function spanFromShiftClick(anchor: SelRange, clicked: SelRange): SelRange {
  const a = normalizeRange(anchor);
  const c = normalizeRange(clicked);
  return { start: Math.min(a.start, c.start), end: Math.max(a.end, c.end) };
}

/**
 * map drag bot — CLICK-DRAG range. On the linear Map a click-drag across the
 * bare track selects a bp RANGE. Given the bp under the drag ORIGIN and the bp
 * under the CURRENT pointer, return the normalized half-open span
 * [min, max]. A zero-length drag (origin === current) returns a degenerate
 * { start: bp, end: bp }; the caller treats that as "no range yet".
 */
export function dragSelectRange(originBp: number, currentBp: number): SelRange {
  return originBp <= currentBp
    ? { start: originBp, end: currentBp }
    : { start: currentBp, end: originBp };
}

/**
 * map drag bot — CLICK vs DRAG discriminator. A pointer-down followed by an
 * pointer-up that moved less than `thresholdPx` (Manhattan distance from the
 * down point) is a CLICK (e.g. empty-track click clears the selection); moving
 * at or past the threshold is a DRAG (a range select). Keeping the threshold a
 * pure helper makes the click/drag boundary unit-testable without a DOM. The
 * default 4 px matches the platform double-click / drag slop so a steady click
 * never registers as a 1-px drag.
 */
export function isDrag(dxPx: number, dyPx: number, thresholdPx = 4): boolean {
  return Math.abs(dxPx) + Math.abs(dyPx) >= thresholdPx;
}

/**
 * circular qol bot — CIRCULAR PREVIEW / SELECTION ARC LENGTH. On the ring a
 * selection is drawn CLOCKWISE (forward, increasing index) from `start` through
 * `end`. A span whose `end` precedes its `start` crosses the zero index (the
 * origin), so it wraps the long way around (seqLength - start + end). A zero-span
 * (start === end) over a whole-molecule feature covers the entire circle. This is
 * the SAME convention the vendored circular Selection uses; extracted here as a
 * pure, unit-tested helper so the circular hover preview arc's geometry is
 * verified without rendering SVG. Returns the arc length in bp (always > 0 for a
 * non-empty molecule), nudged just under a full circle since an SVG arc cannot
 * draw a complete 360 degrees.
 */
export function circularArcLength(start: number, end: number, seqLength: number): number {
  if (seqLength <= 0) return 0;
  let len = end >= start ? end - start : seqLength - start + end;
  if (len === 0) len = seqLength; // whole-molecule feature
  if (len === seqLength) len -= 0.1; // can't arc a full circle
  return len;
}

/** A coding feature (its translation length feeds the aa / kDa readout). */
function isCodingType(type?: string): boolean {
  const t = (type || "").toLowerCase();
  return t === "cds" || t === "gene";
}

/** Comma-group an integer (e.g. 10000 -> "10,000"). */
export function commaGroup(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** The feature shape the hover card needs (a subset of LinearMapFeature). */
export interface CardFeature {
  name: string;
  start: number;
  end: number;
  type?: string;
  /** /product or /note qualifier text, if present. */
  note?: string;
}

/** A line of the hover info card. `label` (when present) is a line-start
 *  terminator the renderer draws bold ("Product"); `value` is the body. */
export interface CardLine {
  label?: string;
  value: string;
}

/**
 * HOVER INFO-CARD CONTENT BUILDER. Mirrors SnapGene's feature tooltip:
 *   - the feature name (title),
 *   - the 1-based, comma-grouped coordinate range start..end,
 *   - the length in bp,
 *   - for a coding feature (cds / gene) the amino-acid count + approximate kDa
 *     (length / 3 residues, ~110 Da/residue),
 *   - the /product or /note qualifier when present.
 * The editor stores 0-based half-open [start, end); the card shows 1-based
 * inclusive coordinates (start + 1 .. end) the way a biologist reads them.
 */
export function buildFeatureCard(f: CardFeature): { title: string; lines: CardLine[] } {
  const lo = Math.min(f.start, f.end);
  const hi = Math.max(f.start, f.end);
  const lengthBp = Math.max(0, hi - lo);
  const lines: CardLine[] = [];
  lines.push({ value: `${commaGroup(lo + 1)} .. ${commaGroup(hi)}` });
  lines.push({ label: "Length", value: `${commaGroup(lengthBp)} bp` });
  if (isCodingType(f.type) && lengthBp >= 3) {
    const aa = Math.floor(lengthBp / 3);
    const kDa = (aa * 110) / 1000;
    // One decimal reads cleanly for a typical protein (e.g. "26.9 kDa").
    lines.push({ label: "Protein", value: `${commaGroup(aa)} aa, ~${kDa.toFixed(1)} kDa` });
  }
  const note = (f.note || "").trim();
  if (note) lines.push({ label: "Product", value: note });
  return { title: f.name || "feature", lines };
}

/**
 * HOVER INFO-CARD for a PRIMER. Same shape as the feature card but with the
 * primer-relevant stats a biologist reads off a click today: the 1-based binding
 * coordinates, the length, the %GC, and the nearest-neighbor Tm (the same model
 * the selection readout uses). `seq` is the whole template; the stats come from
 * the primer's annealed region seq[lo, hi). Tm is omitted when the region is
 * outside the model's valid oligo length (nearestNeighborTm returns null).
 */
export function buildPrimerCard(
  primer: { name: string; start: number; end: number },
  seq: string,
): { title: string; lines: CardLine[] } {
  const lo = Math.min(primer.start, primer.end);
  const hi = Math.max(primer.start, primer.end);
  const lengthBp = Math.max(0, hi - lo);
  const region = seq.slice(lo, hi).toUpperCase();
  const lines: CardLine[] = [];
  lines.push({ value: `${commaGroup(lo + 1)} .. ${commaGroup(hi)}` });
  lines.push({ label: "Length", value: `${commaGroup(lengthBp)} bp` });
  if (lengthBp > 0) {
    const gc = Math.round(((region.match(/[GC]/g)?.length ?? 0) / lengthBp) * 100);
    lines.push({ label: "GC", value: `${gc}%` });
  }
  const tm = nearestNeighborTm(region);
  if (tm) lines.push({ label: "Tm", value: `${tm.tm.toFixed(1)} °C` });
  return { title: primer.name || "primer", lines };
}

/**
 * SELECTION-BAND geometry. Map a selection range [start, end] (bp) to the band's
 * pixel span [x0, x1] CLIPPED to the visible window, using the same window-aware
 * bp -> x mapping the map draws with. Returns null when the selection is empty
 * (start === end, a bare caret has no band) or does not overlap the window.
 * `clamped` is true when the real selection extends past a window edge, so the
 * renderer can hint "selection continues off-screen".
 */
export function selectionBandRect(opts: {
  selStart: number;
  selEnd: number;
  winStart: number;
  winEnd: number;
  padX: number;
  trackWidth: number;
}): { x0: number; x1: number; clampedLeft: boolean; clampedRight: boolean } | null {
  const { selStart, selEnd, winStart, winEnd, padX, trackWidth } = opts;
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);
  if (hi <= lo) return null; // empty / caret -> no band
  const winSpan = Math.max(1, winEnd - winStart);
  if (hi <= winStart || lo >= winEnd) return null; // fully off-screen
  const clipLo = Math.max(lo, winStart);
  const clipHi = Math.min(hi, winEnd);
  const bpToX = (bp: number) => padX + ((bp - winStart) / winSpan) * trackWidth;
  return {
    x0: bpToX(clipLo),
    x1: bpToX(clipHi),
    clampedLeft: lo < winStart,
    clampedRight: hi > winEnd,
  };
}
