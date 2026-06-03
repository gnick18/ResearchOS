// sequence Phase 2a bot — COORDINATE-SHIFT MODULE (the correctness core of the
// editor). Pure functions: given an insert or delete on a sequence, produce the
// new sequence string AND remap every feature/annotation/primer interval so the
// annotated regions still cover the same bases after the edit.
//
// This is where edit bugs live, so it is deliberately small, pure, and heavily
// unit-tested (coordinate-shift.test.ts). NO React, NO SeqViz, NO disk.
//
// COORDINATE MODEL
// ----------------
// We remap each interval as a pair of independent position coordinates and a
// length-driven boundary rule, which is correct regardless of whether a given
// consumer treats `end` as inclusive or exclusive. The only convention we fix
// is the INSERT BOUNDARY: an insert "at index i" places the new bases BEFORE the
// base currently at i (i.e. between base i-1 and base i), matching how a text
// caret at offset i inserts. A coordinate exactly at the caret (== i) is treated
// as a left edge that should move with downstream content, EXCEPT a feature's
// own `end` edge, which we want to keep pinned so typing immediately after a
// feature does NOT silently grow that feature. We encode that with the
// `boundary` parameter on the position mapper.

/**
 * The minimal interval shape this module shifts. Real callers (the GenBank
 * document model) pass features that also carry `locations` for multi-segment
 * (intron/exon) features; we shift those segments too via `shiftFeature`.
 */
export interface Interval {
  start: number;
  end: number;
  /** Optional multi-segment ranges (e.g. fungal intron/exon structure). */
  locations?: { start: number; end: number }[];
  // Pass-through of any other feature fields (name, type, strand, color, ...).
  [key: string]: unknown;
}

/**
 * Map a single coordinate position across an INSERT of `len` bases at `at`.
 *
 * @param boundary how to treat a coordinate that sits exactly on the insert
 *   point. "left" keeps it pinned (does not move) — used for a feature's END
 *   edge so text typed right after a feature is not absorbed into it. "right"
 *   shifts it — used for a feature's START edge so text typed right before a
 *   feature is not absorbed into it either, and for the caret itself.
 */
export function mapPositionOnInsert(
  pos: number,
  at: number,
  len: number,
  boundary: "left" | "right" = "right",
): number {
  if (pos < at) return pos;
  if (pos === at) return boundary === "left" ? pos : pos + len;
  return pos + len;
}

/**
 * Map a single coordinate position across a DELETE of the half-open range
 * [from, from+len). A coordinate inside the deleted span collapses onto `from`.
 */
export function mapPositionOnDelete(pos: number, from: number, len: number): number {
  const to = from + len; // exclusive end of the deleted span
  if (pos <= from) return pos;
  if (pos >= to) return pos - len;
  // Inside the deleted span: collapse to the cut point.
  return from;
}

/** Shift one interval's start/end (and any locations) across an insert. */
export function shiftIntervalOnInsert<T extends Interval>(feat: T, at: number, len: number): T {
  const shifted: Interval = {
    ...feat,
    start: mapPositionOnInsert(feat.start, at, len, "right"),
    end: mapPositionOnInsert(feat.end, at, len, "left"),
  };
  if (Array.isArray(feat.locations)) {
    shifted.locations = feat.locations.map((loc) => ({
      start: mapPositionOnInsert(loc.start, at, len, "right"),
      end: mapPositionOnInsert(loc.end, at, len, "left"),
    }));
  }
  return shifted as T;
}

/** Shift one interval's start/end (and any locations) across a delete. */
export function shiftIntervalOnDelete<T extends Interval>(feat: T, from: number, len: number): T {
  const shifted: Interval = {
    ...feat,
    start: mapPositionOnDelete(feat.start, from, len),
    end: mapPositionOnDelete(feat.end, from, len),
  };
  if (Array.isArray(feat.locations)) {
    shifted.locations = feat.locations.map((loc) => ({
      start: mapPositionOnDelete(loc.start, from, len),
      end: mapPositionOnDelete(loc.end, from, len),
    }));
  }
  return shifted as T;
}

/**
 * Shift a list of intervals across an insert. Returns a new array; inputs are
 * not mutated.
 */
export function shiftFeaturesOnInsert<T extends Interval>(feats: T[], at: number, len: number): T[] {
  if (len <= 0) return feats.map((f) => ({ ...f }));
  return feats.map((f) => shiftIntervalOnInsert(f, at, len));
}

/**
 * Shift a list of intervals across a delete. Intervals that are FULLY contained
 * in the deleted span collapse to a zero-length interval at the cut point; the
 * caller decides whether to drop them (see `dropCollapsed`).
 */
export function shiftFeaturesOnDelete<T extends Interval>(
  feats: T[],
  from: number,
  len: number,
  opts: { dropCollapsed?: boolean } = {},
): T[] {
  if (len <= 0) return feats.map((f) => ({ ...f }));
  const out = feats.map((f) => shiftIntervalOnDelete(f, from, len));
  if (opts.dropCollapsed) {
    return out.filter((f) => f.end > f.start);
  }
  return out;
}
